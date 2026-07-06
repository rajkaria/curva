import { describe, expect, test } from "vitest";
import {
  buildGafferContext,
  fallbackQuip,
  gafferQuip,
  FakeLlm,
  needsTranslation,
  renderForViewer,
  FakeTranslator,
  suggestMarkets,
  searchStats,
  expectedGoals,
  type PoolSummary,
  type StatsBundle,
} from "../src/index.js";

const pool: PoolSummary = {
  title: "France vs Brazil — Result",
  score: "FRA 2-1 BRA",
  outcomes: [
    { key: "HOME", pct: 62 },
    { key: "DRAW", pct: 8 },
    { key: "AWAY", pct: 30 },
  ],
};

describe("the Gaffer", () => {
  test("builds a compact prompt from live pool state", () => {
    const ctx = buildGafferContext(pool);
    expect(ctx[0]!.role).toBe("system");
    expect(ctx[1]!.content).toContain("France vs Brazil");
    expect(ctx[1]!.content).toContain("HOME 62%");
    expect(ctx[1]!.content).toContain("FRA 2-1 BRA");
  });

  test("uses the LLM's quip when it produces one", async () => {
    const llm = new FakeLlm(() => "Two-one and a third of you backing the losers — bold.");
    expect(await gafferQuip(pool, llm)).toContain("bold");
  });

  test("falls back deterministically if the model errors or is empty", async () => {
    const empty = new FakeLlm(() => "");
    expect(await gafferQuip(pool, empty)).toBe(fallbackQuip(pool));
    const throwing = new FakeLlm(() => {
      throw new Error("model not loaded");
    });
    expect(await gafferQuip(pool, throwing)).toBe(fallbackQuip(pool));
  });

  test("the fallback names the majority side", () => {
    expect(fallbackQuip(pool)).toContain("HOME");
  });
});

describe("terrace translate", () => {
  test("only translates across a language boundary", () => {
    expect(needsTranslation({ text: "allez", lang: "fr" }, "en")).toBe(true);
    expect(needsTranslation({ text: "hello", lang: "en" }, "en")).toBe(false);
  });

  test("renders a foreign message in the viewer's language, passes own through", async () => {
    const t = new FakeTranslator();
    expect(await renderForViewer({ text: "allez les bleus", lang: "fr" }, "en", t)).toBe("[en] allez les bleus");
    expect(await renderForViewer({ text: "come on", lang: "en" }, "en", t)).toBe("come on");
  });
});

describe("hunch suggestions", () => {
  const bundle: StatsBundle = {
    teams: [
      { name: "France", avgGoalsFor: 2.4, avgGoalsAgainst: 0.8, starPlayers: ["Mbappe"] },
      { name: "Brazil", avgGoalsFor: 2.1, avgGoalsAgainst: 1.0, starPlayers: ["Vinicius", "Rodrygo"] },
    ],
  };

  test("always suggests the result, plus a stat-driven total-goals line and first scorer", () => {
    const s = suggestMarkets("France", "Brazil", bundle);
    expect(s[0]!.spec.kind).toBe("match-result");
    expect(s.some((x) => x.spec.kind === "total-goals")).toBe(true);
    const scorer = s.find((x) => x.spec.kind === "first-scorer");
    expect(scorer!.spec.params.outcomes).toContain("Mbappe");
    expect(scorer!.spec.params.outcomes).toContain("Vinicius");
  });

  test("expectedGoals combines both teams' form", () => {
    // (2.4+1.0)/2 + (2.1+0.8)/2 = 1.7 + 1.45 = 3.15
    expect(expectedGoals(bundle.teams[0]!, bundle.teams[1]!)).toBeCloseTo(3.15, 5);
  });

  test("searchStats ranks by keyword overlap, deterministically", () => {
    expect(searchStats("mbappe", bundle)).toEqual([{ team: "France", score: 1 }]);
    expect(searchStats("nobody here", bundle)).toEqual([]);
  });

  test("gracefully suggests just the result when teams aren't in the bundle", () => {
    const s = suggestMarkets("Narnia", "Atlantis", bundle);
    expect(s).toHaveLength(1);
    expect(s[0]!.spec.kind).toBe("match-result");
  });
});
