import { describe, expect, test } from "vitest";
import {
  buildPools,
  impliedOdds,
  mergePools,
  type Bet,
} from "../src/index.js";

const USDT = 1_000_000n;

function bet(
  betId: string,
  bettorId: string,
  outcomeKey: string,
  stakeUsdt: bigint,
): Bet {
  return { betId, bettorId, outcomeKey, stake: stakeUsdt * USDT };
}

describe("buildPools", () => {
  test("sums gross, fee, and net per outcome (feeBps = 500)", () => {
    const pools = buildPools(
      [bet("b1", "ana", "HOME", 100n), bet("b2", "bo", "DRAW", 50n)],
      500,
    );

    expect(pools.feeBps).toBe(500);
    expect(pools.grossTotal).toBe(150n * USDT);
    expect(pools.feeTotal).toBe(7_500_000n); // 5% of 150 USDt
    expect(pools.netTotal).toBe(142_500_000n);
    expect(pools.outcomes["HOME"]).toEqual({
      gross: 100n * USDT,
      fee: 5_000_000n,
      net: 95_000_000n,
      betCount: 1,
    });
    expect(pools.outcomes["DRAW"]).toEqual({
      gross: 50n * USDT,
      fee: 2_500_000n,
      net: 47_500_000n,
      betCount: 1,
    });
    expect(pools.bettorIds).toEqual(["ana", "bo"]);
  });

  test("feeBps defaults to 0 — friends don't rake friends", () => {
    const pools = buildPools([bet("b1", "ana", "HOME", 10n)]);
    expect(pools.feeBps).toBe(0);
    expect(pools.feeTotal).toBe(0n);
    expect(pools.netTotal).toBe(pools.grossTotal);
  });

  test("per-bet fee is floored (no fee dust invented)", () => {
    const pools = buildPools(
      [{ betId: "b1", bettorId: "ana", outcomeKey: "HOME", stake: 3n }],
      1,
    );
    expect(pools.feeTotal).toBe(0n); // floor(3 * 1 / 10000) = 0
    expect(pools.netTotal).toBe(3n);
  });

  test("outcome keys are sorted ascending (deterministic iteration)", () => {
    const pools = buildPools([
      bet("b1", "ana", "HOME", 1n),
      bet("b2", "bo", "AWAY", 1n),
      bet("b3", "cai", "DRAW", 1n),
    ]);
    expect(Object.keys(pools.outcomes)).toEqual(["AWAY", "DRAW", "HOME"]);
  });

  test("rejects non-positive stakes", () => {
    expect(() =>
      buildPools([{ betId: "b1", bettorId: "ana", outcomeKey: "HOME", stake: 0n }]),
    ).toThrow(/stake/);
    expect(() =>
      buildPools([{ betId: "b1", bettorId: "ana", outcomeKey: "HOME", stake: -5n }]),
    ).toThrow(/stake/);
  });

  test("rejects duplicate betIds (dedup is terrace-base's job — a dupe here is a bug)", () => {
    expect(() =>
      buildPools([bet("b1", "ana", "HOME", 1n), bet("b1", "bo", "AWAY", 1n)]),
    ).toThrow(/betId/);
  });

  test("rejects out-of-range or fractional feeBps", () => {
    expect(() => buildPools([], -1)).toThrow(/feeBps/);
    expect(() => buildPools([], 10_001)).toThrow(/feeBps/);
    expect(() => buildPools([], 2.5)).toThrow(/feeBps/);
  });
});

describe("mergePools", () => {
  test("merging two partial folds equals folding the whole set", () => {
    const all = [
      bet("b1", "ana", "HOME", 100n),
      bet("b2", "bo", "DRAW", 50n),
      bet("b3", "ana", "AWAY", 25n),
      bet("b4", "cai", "HOME", 10n),
    ];
    const merged = mergePools(buildPools(all.slice(0, 2), 500), buildPools(all.slice(2), 500));
    expect(merged).toEqual(buildPools(all, 500));
  });

  test("rejects mismatched feeBps — one market, one fee schedule", () => {
    expect(() => mergePools(buildPools([], 0), buildPools([], 500))).toThrow(/feeBps/);
  });
});

describe("impliedOdds", () => {
  test("probability and decimal odds from net pools", () => {
    const odds = impliedOdds(
      buildPools([bet("b1", "ana", "HOME", 300n), bet("b2", "bo", "DRAW", 100n)]),
    );
    expect(odds["HOME"]?.probability).toBeCloseTo(0.75, 10);
    expect(odds["HOME"]?.decimalOdds).toBeCloseTo(4 / 3, 10);
    expect(odds["DRAW"]?.probability).toBeCloseTo(0.25, 10);
    expect(odds["DRAW"]?.decimalOdds).toBeCloseTo(4, 10);
  });

  test("empty market has no odds", () => {
    expect(impliedOdds(buildPools([]))).toEqual({});
  });
});
