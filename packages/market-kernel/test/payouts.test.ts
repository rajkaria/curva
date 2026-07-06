import { describe, expect, test } from "vitest";
import { computePayouts, type Bet } from "../src/index.js";

const USDT = 1_000_000n;

function bet(
  betId: string,
  bettorId: string,
  outcomeKey: string,
  stakeUsdt: bigint,
): Bet {
  return { betId, bettorId, outcomeKey, stake: stakeUsdt * USDT };
}

const HOME = { kind: "outcome", outcomeKey: "HOME" } as const;
const VOID = { kind: "void" } as const;

describe("computePayouts — resolved", () => {
  test("sole winner takes the whole pool at feeBps 0", () => {
    const manifest = computePayouts({
      bets: [bet("b1", "ana", "HOME", 100n), bet("b2", "bo", "AWAY", 50n)],
      resolution: HOME,
    });

    expect(manifest.reason).toBe("resolved");
    expect(manifest.grossTotal).toBe(150n * USDT);
    expect(manifest.feeTotal).toBe(0n);
    expect(manifest.payoutTotal).toBe(150n * USDT);
    expect(manifest.lines).toEqual([
      { bettorId: "ana", kind: "winnings", stake: 100n * USDT, amount: 150n * USDT },
    ]);
  });

  test("winners split pro-rata; sub-micro dust goes by largest remainder, ties to lower bettorId", () => {
    // Pool = 201 micros, winning stakes ana 100 / bo 100.
    // floor shares: 100 + 100 = 200; the 1-micro remainder ties → ana (lower id).
    const manifest = computePayouts({
      bets: [
        { betId: "b1", bettorId: "ana", outcomeKey: "HOME", stake: 100n },
        { betId: "b2", bettorId: "bo", outcomeKey: "HOME", stake: 100n },
        { betId: "b3", bettorId: "cai", outcomeKey: "AWAY", stake: 1n },
      ],
      resolution: HOME,
    });

    expect(manifest.lines).toEqual([
      { bettorId: "ana", kind: "winnings", stake: 100n, amount: 101n },
      { bettorId: "bo", kind: "winnings", stake: 100n, amount: 100n },
    ]);
    expect(manifest.payoutTotal).toBe(201n); // pool exhausted exactly — no dust left
  });

  test("a bettor's multiple winning bets aggregate into one line", () => {
    const manifest = computePayouts({
      bets: [
        bet("b1", "ana", "HOME", 30n),
        bet("b2", "ana", "HOME", 70n),
        bet("b3", "bo", "AWAY", 100n),
      ],
      resolution: HOME,
    });
    expect(manifest.lines).toEqual([
      { bettorId: "ana", kind: "winnings", stake: 100n * USDT, amount: 200n * USDT },
    ]);
  });

  test("a bettor on both sides wins on the winning-side stake only", () => {
    const manifest = computePayouts({
      bets: [
        bet("b1", "ana", "HOME", 100n),
        bet("b2", "ana", "AWAY", 40n),
        bet("b3", "bo", "AWAY", 60n),
      ],
      resolution: HOME,
    });
    // ana's line covers her HOME stake; her AWAY 40 is in the pool she wins back.
    expect(manifest.lines).toEqual([
      { bettorId: "ana", kind: "winnings", stake: 100n * USDT, amount: 200n * USDT },
    ]);
  });

  test("fees are retained on resolution and the books still balance", () => {
    const manifest = computePayouts({
      bets: [bet("b1", "ana", "HOME", 100n), bet("b2", "bo", "AWAY", 100n)],
      resolution: HOME,
      feeBps: 500,
    });
    expect(manifest.feeTotal).toBe(10n * USDT); // 5% of 200
    expect(manifest.payoutTotal).toBe(190n * USDT); // net pool, exactly
    expect(manifest.payoutTotal + manifest.feeTotal).toBe(manifest.grossTotal);
    expect(manifest.lines).toEqual([
      { bettorId: "ana", kind: "winnings", stake: 100n * USDT, amount: 190n * USDT },
    ]);
  });

  test("lines are sorted by bettorId", () => {
    const manifest = computePayouts({
      bets: [
        bet("b1", "zed", "HOME", 10n),
        bet("b2", "ana", "HOME", 10n),
        bet("b3", "mia", "HOME", 10n),
        bet("b4", "bo", "AWAY", 30n),
      ],
      resolution: HOME,
    });
    expect(manifest.lines.map((l) => l.bettorId)).toEqual(["ana", "mia", "zed"]);
  });
});

describe("computePayouts — refund paths (all gross, feeTotal 0)", () => {
  test("void → every bettor gets their gross stakes back, fees included", () => {
    const manifest = computePayouts({
      bets: [
        bet("b1", "ana", "HOME", 100n),
        bet("b2", "ana", "AWAY", 20n),
        bet("b3", "bo", "DRAW", 50n),
      ],
      resolution: VOID,
      feeBps: 500,
    });
    expect(manifest.reason).toBe("voided");
    expect(manifest.feeTotal).toBe(0n);
    expect(manifest.payoutTotal).toBe(170n * USDT);
    expect(manifest.lines).toEqual([
      { bettorId: "ana", kind: "refund", stake: 120n * USDT, amount: 120n * USDT },
      { bettorId: "bo", kind: "refund", stake: 50n * USDT, amount: 50n * USDT },
    ]);
  });

  test("single participant → full refund (a market needs a counterparty)", () => {
    const manifest = computePayouts({
      bets: [bet("b1", "ana", "HOME", 100n), bet("b2", "ana", "AWAY", 50n)],
      resolution: HOME,
      feeBps: 500,
    });
    expect(manifest.reason).toBe("single-participant");
    expect(manifest.lines).toEqual([
      { bettorId: "ana", kind: "refund", stake: 150n * USDT, amount: 150n * USDT },
    ]);
  });

  test("nobody backed the winning outcome → full refund (no treasury to retain the pool)", () => {
    const manifest = computePayouts({
      bets: [bet("b1", "ana", "HOME", 100n), bet("b2", "bo", "AWAY", 50n)],
      resolution: { kind: "outcome", outcomeKey: "DRAW" },
    });
    expect(manifest.reason).toBe("no-winning-stake");
    expect(manifest.payoutTotal).toBe(150n * USDT);
    expect(manifest.lines.every((l) => l.kind === "refund")).toBe(true);
  });

  test("void takes precedence over single-participant", () => {
    const manifest = computePayouts({
      bets: [bet("b1", "ana", "HOME", 100n)],
      resolution: VOID,
    });
    expect(manifest.reason).toBe("voided");
  });

  test("empty market → empty manifest, zero totals", () => {
    const manifest = computePayouts({ bets: [], resolution: HOME });
    expect(manifest.lines).toEqual([]);
    expect(manifest.grossTotal).toBe(0n);
    expect(manifest.payoutTotal).toBe(0n);
    expect(manifest.feeTotal).toBe(0n);
  });
});
