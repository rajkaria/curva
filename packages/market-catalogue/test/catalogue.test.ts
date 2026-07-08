import { describe, expect, test } from "vitest";
import {
  matchResult,
  totalGoalsLadder,
  goalInWindow,
  firstScorer,
  correctScore,
  customMarket,
  binaryMarket,
  CUSTOM_MARKET_LIMITS,
  scheduleMicroRounds,
  nextOpenRound,
  liveRound,
} from "../src/index.js";

describe("match result", () => {
  test("3-way HOME/DRAW/AWAY with team metadata", () => {
    const m = matchResult("France", "Brazil");
    expect(m.kind).toBe("match-result");
    expect(m.params.outcomes).toEqual(["HOME", "DRAW", "AWAY"]);
    expect(m.params.meta).toMatchObject({ homeTeam: "France", awayTeam: "Brazil" });
  });
});

describe("total-goals ladder", () => {
  test("produces one 2-way market per line, line stored as tenths (no floats)", () => {
    const ladder = totalGoalsLadder([0.5, 1.5, 2.5, 3.5]);
    expect(ladder).toHaveLength(4);
    expect(ladder[2]!.params.outcomes).toEqual(["OVER", "UNDER"]);
    expect(ladder[2]!.params.meta).toMatchObject({ lineTenths: 25 });
    expect(ladder[2]!.params.title).toContain("2.5");
  });
});

describe("goal-in-window micro-round", () => {
  test("YES/NO market carrying its round window", () => {
    const m = goalInWindow(3, 600_000, 1_200_000);
    expect(m.kind).toBe("goal-in-window");
    expect(m.params.outcomes).toEqual(["YES", "NO"]);
    expect(m.params.meta).toMatchObject({ round: 3, windowStart: 600_000, windowEnd: 1_200_000 });
  });
});

describe("first scorer", () => {
  test("N-way over the squad plus a NONE outcome", () => {
    const m = firstScorer(["Mbappe", "Vinicius", "Griezmann"]);
    expect(m.params.outcomes).toEqual(["Mbappe", "Vinicius", "Griezmann", "NONE"]);
  });

  test("rejects an empty squad", () => {
    expect(() => firstScorer([])).toThrow(/squad/);
  });
});

describe("correct score grid", () => {
  test("generates an (n+1)^2 grid of h-a outcomes", () => {
    const m = correctScore(2);
    expect(m.params.outcomes).toContain("0-0");
    expect(m.params.outcomes).toContain("2-2");
    expect(m.params.outcomes).toHaveLength(9); // 3x3
  });
});

describe("custom markets (the protocol, not football)", () => {
  test("builds a custom-kind market from a title and free-form outcomes", () => {
    const m = customMarket("Who ships the release?", ["Ana", "Bo", "Cai"]);
    expect(m.kind).toBe("custom");
    expect(m.params.title).toBe("Who ships the release?");
    expect(m.params.outcomes).toEqual(["Ana", "Bo", "Cai"]);
  });

  test("trims the title and every outcome, dropping blank outcomes", () => {
    const m = customMarket("  Ship Friday?  ", [" YES ", "NO", "  "]);
    expect(m.params.title).toBe("Ship Friday?");
    expect(m.params.outcomes).toEqual(["YES", "NO"]);
  });

  test("binaryMarket is the one-tap YES/NO case", () => {
    expect(binaryMarket("Rain tomorrow?").params.outcomes).toEqual(["YES", "NO"]);
  });

  test("rejects an empty title", () => {
    expect(() => customMarket("   ", ["YES", "NO"])).toThrow(/title/);
  });

  test("rejects fewer than two distinct outcomes", () => {
    expect(() => customMarket("Q", ["ONLY"])).toThrow(/at least/);
    expect(() => customMarket("Q", ["YES", "YES"])).toThrow(/unique/);
  });

  test("enforces the fold's caps so a built spec always survives apply", () => {
    expect(() => customMarket("x".repeat(CUSTOM_MARKET_LIMITS.titleMax + 1), ["YES", "NO"])).toThrow(/title/);
    expect(() => customMarket("Q", ["YES", "y".repeat(CUSTOM_MARKET_LIMITS.outcomeMax + 1)])).toThrow(/64/);
    const tooMany = Array.from({ length: CUSTOM_MARKET_LIMITS.maxOutcomes + 1 }, (_, i) => `o${i}`);
    expect(() => customMarket("Q", tooMany)).toThrow(/at most/);
  });
});

describe("recurring micro-round scheduler (the live-demo driver)", () => {
  const start = 1_000_000;
  const rounds = scheduleMicroRounds(start, { roundMs: 600_000, count: 9 });

  test("lays out contiguous 10-minute rounds", () => {
    expect(rounds).toHaveLength(9);
    expect(rounds[0]).toMatchObject({ round: 0, windowStart: start, cutoffAt: start, windowEnd: start + 600_000 });
    expect(rounds[1]!.windowStart).toBe(rounds[0]!.windowEnd); // contiguous
  });

  test("nextOpenRound returns the soonest round still bettable", () => {
    expect(nextOpenRound(start - 1, rounds)?.round).toBe(0);
    expect(nextOpenRound(start + 1, rounds)?.round).toBe(1); // round 0 has locked
    expect(nextOpenRound(start + 9 * 600_000, rounds)).toBeNull(); // match over
  });

  test("liveRound returns the round whose window contains now", () => {
    expect(liveRound(start + 650_000, rounds)?.round).toBe(1);
    expect(liveRound(start - 1, rounds)).toBeNull();
  });
});
