/**
 * The CRDT claim, proven not asserted:
 *
 * 1. CONSERVATION — sum(payouts) + sum(fees) === sum(stakes), exactly, for
 *    arbitrary bet sets, fees, and resolutions. Money is never minted or lost.
 * 2. COMMUTATIVITY — any permutation of the same bet set produces identical
 *    pools, odds, and payout manifests; any partition of the set folds and
 *    merges to the same pools. Merge order doesn't matter → the market state
 *    is a CRDT and partitions heal for free.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  buildPools,
  computePayouts,
  impliedOdds,
  mergePools,
  type Bet,
  type Resolution,
} from "../src/index.js";

const OUTCOMES = ["HOME", "DRAW", "AWAY"] as const;

const betsArb: fc.Arbitrary<Bet[]> = fc
  .array(
    fc.record({
      bettorId: fc.constantFrom("ana", "bo", "cai", "dev", "eli", "fay"),
      outcomeKey: fc.constantFrom(...OUTCOMES),
      // 1 micro up to 1M USDt per bet — covers dust and whale in one sweep
      stake: fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
    }),
    { maxLength: 60 },
  )
  .map((partial) => partial.map((p, i) => ({ ...p, betId: `bet-${i}` })));

const feeBpsArb = fc.integer({ min: 0, max: 2_000 });

const resolutionArb: fc.Arbitrary<Resolution> = fc.oneof(
  fc.constantFrom(...OUTCOMES).map(
    (outcomeKey): Resolution => ({ kind: "outcome", outcomeKey }),
  ),
  fc.constant<Resolution>({ kind: "void" }),
);

const permutedArb = betsArb.chain((bets) =>
  fc.tuple(
    fc.constant(bets),
    fc.shuffledSubarray(bets, { minLength: bets.length, maxLength: bets.length }),
  ),
);

const sum = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe("conservation", () => {
  test("payouts + fees === stakes, exactly, for every bet set / fee / resolution", () => {
    fc.assert(
      fc.property(betsArb, feeBpsArb, resolutionArb, (bets, feeBps, resolution) => {
        const m = computePayouts({ bets, resolution, feeBps });
        const gross = sum(bets.map((b) => b.stake));
        expect(m.grossTotal).toBe(gross);
        expect(m.payoutTotal + m.feeTotal).toBe(gross);
        expect(sum(m.lines.map((l) => l.amount))).toBe(m.payoutTotal);
      }),
      { numRuns: 500 },
    );
  });

  test("a resolved market pays out the net pool to the last micro", () => {
    fc.assert(
      fc.property(betsArb, feeBpsArb, resolutionArb, (bets, feeBps, resolution) => {
        const m = computePayouts({ bets, resolution, feeBps });
        if (m.reason !== "resolved") return;
        expect(m.payoutTotal).toBe(buildPools(bets, feeBps).netTotal);
      }),
      { numRuns: 500 },
    );
  });

  test("at feeBps 0 no winner ever receives less than their winning stake", () => {
    fc.assert(
      fc.property(betsArb, resolutionArb, (bets, resolution) => {
        const m = computePayouts({ bets, resolution, feeBps: 0 });
        if (m.reason !== "resolved") return;
        for (const line of m.lines) {
          expect(line.amount >= line.stake).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  test("refund paths return every bettor exactly their gross total", () => {
    fc.assert(
      fc.property(betsArb, feeBpsArb, (bets, feeBps) => {
        const m = computePayouts({ bets, resolution: { kind: "void" }, feeBps });
        const grossByBettor = new Map<string, bigint>();
        for (const b of bets) {
          grossByBettor.set(b.bettorId, (grossByBettor.get(b.bettorId) ?? 0n) + b.stake);
        }
        expect(m.lines.length).toBe(grossByBettor.size);
        for (const line of m.lines) {
          expect(line.kind).toBe("refund");
          expect(line.amount).toBe(grossByBettor.get(line.bettorId));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("commutativity (the CRDT claim)", () => {
  test("any permutation of the bet set → identical pools, odds, and manifest", () => {
    fc.assert(
      fc.property(permutedArb, feeBpsArb, resolutionArb, ([bets, shuffled], feeBps, resolution) => {
        expect(buildPools(shuffled, feeBps)).toEqual(buildPools(bets, feeBps));
        expect(impliedOdds(buildPools(shuffled, feeBps))).toEqual(
          impliedOdds(buildPools(bets, feeBps)),
        );
        expect(computePayouts({ bets: shuffled, resolution, feeBps })).toEqual(
          computePayouts({ bets, resolution, feeBps }),
        );
      }),
      { numRuns: 300 },
    );
  });

  test("any partition of the bet set folds and merges to the same pools", () => {
    fc.assert(
      fc.property(
        betsArb.chain((bets) =>
          fc.tuple(fc.constant(bets), fc.array(fc.boolean(), { minLength: bets.length, maxLength: bets.length })),
        ),
        feeBpsArb,
        ([bets, mask], feeBps) => {
          const left = bets.filter((_, i) => mask[i]);
          const right = bets.filter((_, i) => !mask[i]);
          expect(mergePools(buildPools(left, feeBps), buildPools(right, feeBps))).toEqual(
            buildPools(bets, feeBps),
          );
          // merge is commutative too
          expect(mergePools(buildPools(right, feeBps), buildPools(left, feeBps))).toEqual(
            buildPools(bets, feeBps),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("odds sanity", () => {
  test("probabilities are in [0,1] and sum to 1 on any non-empty market", () => {
    fc.assert(
      fc.property(betsArb, feeBpsArb, (bets, feeBps) => {
        const pools = buildPools(bets, feeBps);
        if (pools.netTotal === 0n) return;
        const odds = Object.values(impliedOdds(pools));
        let total = 0;
        for (const o of odds) {
          expect(o.probability).toBeGreaterThanOrEqual(0);
          expect(o.probability).toBeLessThanOrEqual(1);
          total += o.probability;
        }
        expect(total).toBeCloseTo(1, 9);
      }),
      { numRuns: 300 },
    );
  });
});
