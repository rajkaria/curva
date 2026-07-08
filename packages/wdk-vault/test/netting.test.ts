import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { computePayouts, type Bet } from "@curva/market-kernel";
import { computeDeltas, minTransfers, type Transfer } from "../src/netting.js";

const USDT = 1_000_000n;
const bet = (id: string, who: string, out: string, u: bigint): Bet => ({
  betId: id,
  bettorId: who,
  outcomeKey: out,
  stake: u * USDT,
});

function net(transfers: Transfer[], party: string): bigint {
  let d = 0n;
  for (const t of transfers) {
    if (t.to === party) d += t.amount;
    if (t.from === party) d -= t.amount;
  }
  return d;
}

describe("minTransfers", () => {
  test("settles a simple 1-loser 1-winner case in a single transfer", () => {
    const transfers = minTransfers(new Map([["winner", 10n], ["loser", -10n]]));
    expect(transfers).toEqual([{ from: "loser", to: "winner", amount: 10n }]);
  });

  test("nets a 3-way pool into at most n-1 transfers", () => {
    const deltas = new Map([["a", 30n], ["b", -20n], ["c", -10n]]);
    const transfers = minTransfers(deltas);
    expect(transfers.length).toBeLessThanOrEqual(2);
    expect(net(transfers, "a")).toBe(30n);
    expect(net(transfers, "b")).toBe(-20n);
    expect(net(transfers, "c")).toBe(-10n);
  });

  test("an all-zero ledger needs no transfers (void → everyone keeps their stake)", () => {
    expect(minTransfers(new Map([["a", 0n], ["b", 0n]]))).toEqual([]);
  });
});

describe("computeDeltas from a payout manifest", () => {
  test("losers owe their stake, winners are owed their net winnings", () => {
    const bets = [bet("1", "ana", "HOME", 100n), bet("2", "bo", "AWAY", 100n)];
    const manifest = computePayouts({ bets, resolution: { kind: "outcome", outcomeKey: "HOME" } });
    const stakes = new Map([["ana", 100n * USDT], ["bo", 100n * USDT]]);
    const deltas = computeDeltas(manifest, stakes);
    expect(deltas.get("ana")).toBe(100n * USDT); // won 100 net (got 200 back on a 100 stake)
    expect(deltas.get("bo")).toBe(-100n * USDT); // owes their whole stake
    // A settled ledger balances to zero.
    expect([...deltas.values()].reduce((a, b) => a + b, 0n)).toBe(0n);
  });

  test("void manifest yields all-zero deltas — no one owes anyone", () => {
    const bets = [bet("1", "ana", "HOME", 100n), bet("2", "bo", "AWAY", 50n)];
    const manifest = computePayouts({ bets, resolution: { kind: "void" } });
    const stakes = new Map([["ana", 100n * USDT], ["bo", 50n * USDT]]);
    const deltas = computeDeltas(manifest, stakes);
    expect([...deltas.values()].every((d) => d === 0n)).toBe(true);
  });

  test("a fee routes to the fee recipient so the ledger still balances", () => {
    const bets = [bet("1", "ana", "HOME", 100n), bet("2", "bo", "AWAY", 100n)];
    const manifest = computePayouts({ bets, resolution: { kind: "outcome", outcomeKey: "HOME" }, feeBps: 500 });
    const stakes = new Map([["ana", 100n * USDT], ["bo", 100n * USDT]]);
    const deltas = computeDeltas(manifest, stakes, { feeRecipient: "attesters" });
    expect(deltas.get("attesters")).toBe(manifest.feeTotal);
    expect([...deltas.values()].reduce((a, b) => a + b, 0n)).toBe(0n);
  });

  test("a fee with no recipient is rejected (would unbalance the ledger)", () => {
    const bets = [bet("1", "ana", "HOME", 100n), bet("2", "bo", "AWAY", 100n)];
    const manifest = computePayouts({ bets, resolution: { kind: "outcome", outcomeKey: "HOME" }, feeBps: 500 });
    const stakes = new Map([["ana", 100n * USDT], ["bo", 100n * USDT]]);
    expect(() => computeDeltas(manifest, stakes)).toThrow(/fee/);
  });
});

describe("netting soundness (property)", () => {
  const balancedDeltas: fc.Arbitrary<Map<string, bigint>> = fc
    .array(fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }), { minLength: 2, maxLength: 12 })
    .map((values) => {
      const map = new Map<string, bigint>();
      const sum = values.reduce((a, b) => a + b, 0n);
      values.forEach((v, i) => map.set(`p${i}`, i === 0 ? v - sum : v)); // force Σ = 0
      return map;
    });

  test("transfers settle every party exactly, with ≤ n-1 edges and positive amounts", () => {
    fc.assert(
      fc.property(balancedDeltas, (deltas) => {
        const transfers = minTransfers(deltas);
        const parties = [...deltas.keys()].filter((p) => deltas.get(p) !== 0n);
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, parties.length - 1));
        for (const t of transfers) {
          expect(t.amount > 0n).toBe(true);
          expect(t.from).not.toBe(t.to);
        }
        for (const [party, delta] of deltas) expect(net(transfers, party)).toBe(delta);
      }),
      { numRuns: 500 },
    );
  });

  test("end-to-end: manifest → deltas → transfers conserves money across the swarm", () => {
    const bettorArb = fc.array(
      fc.record({
        who: fc.constantFrom("ana", "bo", "cai", "dev", "eli"),
        out: fc.constantFrom("HOME", "AWAY"),
        u: fc.bigInt({ min: 1n, max: 100_000n }),
      }),
      { minLength: 2, maxLength: 20 },
    );
    fc.assert(
      fc.property(bettorArb, fc.constantFrom("HOME", "AWAY"), (raw, winner) => {
        const bets: Bet[] = raw.map((r, i) => ({
          betId: `b${i}`,
          bettorId: r.who,
          outcomeKey: r.out,
          stake: r.u * USDT,
        }));
        const manifest = computePayouts({ bets, resolution: { kind: "outcome", outcomeKey: winner } });
        const stakes = new Map<string, bigint>();
        for (const b of bets) stakes.set(b.bettorId, (stakes.get(b.bettorId) ?? 0n) + b.stake);
        const deltas = computeDeltas(manifest, stakes);
        const transfers = minTransfers(deltas);
        // Every party ends square.
        for (const [party, delta] of deltas) expect(net(transfers, party)).toBe(delta);
      }),
      { numRuns: 300 },
    );
  });
});
