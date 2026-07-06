import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  quorumOutcome,
  resolveMarket,
  DEFAULT_QUORUM,
  type Attestation,
  type AttestationEvent,
} from "../src/quorum.js";

const USDT = 1_000_000n;

function tally(entries: Array<[string, string]>): Map<string, Attestation> {
  const m = new Map<string, Attestation>();
  for (const [writer, outcomeKey] of entries) m.set(writer, { outcomeKey, ts: 1000 });
  return m;
}
const ev = (writer: string, outcomeKey: string, ts: number): AttestationEvent => ({ writer, outcomeKey, ts });

describe("quorumOutcome — dual ⅔ threshold", () => {
  test("resolves when an outcome has ≥⅔ writers AND ≥⅔ stake AND ≥3 writers", () => {
    const stake = new Map([["a", 30n * USDT], ["b", 30n * USDT], ["c", 30n * USDT], ["d", 10n * USDT]]);
    expect(quorumOutcome(tally([["a", "HOME"], ["b", "HOME"], ["c", "HOME"], ["d", "AWAY"]]), stake, DEFAULT_QUORUM)).toBe("HOME");
  });

  test("fewer than 3 writers never reaches quorum (sock-puppet floor)", () => {
    const stake = new Map([["a", 100n * USDT], ["b", 100n * USDT]]);
    expect(quorumOutcome(tally([["a", "HOME"], ["b", "HOME"]]), stake, DEFAULT_QUORUM)).toBeNull();
  });

  test("a whale minority cannot force an outcome the writers reject (writer threshold)", () => {
    const stake = new Map([["whale", 1000n * USDT], ["a", 1n * USDT], ["b", 1n * USDT], ["c", 1n * USDT]]);
    // HOME: ¾ writers but 3/1003 stake → fails stake. AWAY: ¾ stake but ¼ writers → fails writers.
    expect(quorumOutcome(tally([["whale", "AWAY"], ["a", "HOME"], ["b", "HOME"], ["c", "HOME"]]), stake, DEFAULT_QUORUM)).toBeNull();
  });

  test("a sock-puppet writer swarm cannot force an outcome the stake rejects (stake threshold)", () => {
    const stake = new Map([["s1", 0n], ["s2", 0n], ["s3", 0n], ["s4", 0n], ["whale", 1000n * USDT]]);
    expect(quorumOutcome(tally([["s1", "AWAY"], ["s2", "AWAY"], ["s3", "AWAY"], ["s4", "AWAY"], ["whale", "HOME"]]), stake, DEFAULT_QUORUM)).toBeNull();
  });
});

describe("quorum safety (property) — two outcomes can never both reach quorum", () => {
  test("at most one outcome is above the dual threshold", () => {
    const arb = fc.array(
      fc.record({
        writer: fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h"),
        outcome: fc.constantFrom("HOME", "DRAW", "AWAY"),
        stake: fc.bigInt({ min: 0n, max: 1_000_000_000n }),
      }),
      { minLength: 0, maxLength: 8 },
    );
    fc.assert(
      fc.property(arb, (rows) => {
        const attestations = new Map<string, Attestation>();
        const stake = new Map<string, bigint>();
        for (const r of rows) {
          attestations.set(r.writer, { outcomeKey: r.outcome, ts: 1 });
          stake.set(r.writer, r.stake);
        }
        const winner = quorumOutcome(attestations, stake, DEFAULT_QUORUM);
        const above = ["HOME", "DRAW", "AWAY"].filter((o) => winner === o);
        expect(above.length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });
});

describe("resolveMarket — dispute window", () => {
  const stake = new Map([["a", 30n * USDT], ["b", 30n * USDT], ["c", 30n * USDT], ["d", 10n * USDT]]);
  const disputeWindowMs = 600_000; // 10 min

  test("open before any quorum", () => {
    const r = resolveMarket({ events: [ev("a", "HOME", 1000)], stakeByWriter: stake, now: 5000, disputeWindowMs });
    expect(r.status).toBe("open");
  });

  test("provisional immediately after quorum, resolved after the window", () => {
    const events = [ev("a", "HOME", 1000), ev("b", "HOME", 1000), ev("c", "HOME", 1000)];
    expect(resolveMarket({ events, stakeByWriter: stake, now: 1000, disputeWindowMs })).toMatchObject({
      status: "provisional",
      outcomeKey: "HOME",
      finalizesAt: 1000 + disputeWindowMs,
    });
    expect(resolveMarket({ events, stakeByWriter: stake, now: 1000 + disputeWindowMs, disputeWindowMs })).toMatchObject({
      status: "resolved",
      outcomeKey: "HOME",
    });
  });

  test("a counter-quorum inside the window voids the market → full refund", () => {
    const events = [
      ev("a", "HOME", 1000), ev("b", "HOME", 1000), ev("c", "HOME", 1000), // HOME quorum at 1000
      ev("a", "AWAY", 2000), ev("b", "AWAY", 2000), ev("c", "AWAY", 2000), ev("d", "AWAY", 2000), // flip
    ];
    const r = resolveMarket({ events, stakeByWriter: stake, now: 1000 + disputeWindowMs, disputeWindowMs });
    expect(r.status).toBe("voided");
  });

  test("strengthening the same outcome inside the window still resolves (no false void)", () => {
    const events = [
      ev("a", "HOME", 1000), ev("b", "HOME", 1000), ev("c", "HOME", 1000),
      ev("d", "HOME", 2000), // d piles on to HOME — not a counter-quorum
    ];
    expect(resolveMarket({ events, stakeByWriter: stake, now: 1000 + disputeWindowMs, disputeWindowMs })).toMatchObject({
      status: "resolved",
      outcomeKey: "HOME",
    });
  });
});
