import { describe, expect, test } from "vitest";
import { extractScore, prefillAttestation, type ResultMarket } from "../src/extract.js";

const market: ResultMarket = {
  outcomes: ["HOME", "DRAW", "AWAY"],
  homeTeam: "France",
  awayTeam: "Brazil",
};

describe("extractScore — rule-based over the transcript", () => {
  test("reads a full-time score anchored on team names", () => {
    const s = extractScore("...and that's full time here. France 2, Brazil 1. What a match.", market);
    expect(s).toMatchObject({ home: 2, away: 1 });
    expect(s!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test("handles spoken number words", () => {
    const s = extractScore("Full time: France three, Brazil nil.", market);
    expect(s).toMatchObject({ home: 3, away: 0 });
  });

  test("falls back to a bare N-M score when names aren't found", () => {
    const s = extractScore("it finishes two one", market);
    expect(s).toMatchObject({ home: 2, away: 1 });
    expect(s!.confidence).toBeLessThan(0.8); // less certain without team anchoring
  });

  test("returns null on crowd noise with no score", () => {
    expect(extractScore("ohhh the crowd is going wild what an atmosphere", market)).toBeNull();
  });

  test("takes the final score, not an interim one", () => {
    const s = extractScore("France 1, Brazil 0 at the break … full time France 2, Brazil 2.", market);
    expect(s).toMatchObject({ home: 2, away: 2 });
  });
});

describe("prefillAttestation — maps a score to a signable, pre-filled attestation", () => {
  test("home win → HOME with a human-readable asrScore", () => {
    const a = prefillAttestation("Full time. France 2, Brazil 1.", market);
    expect(a).toMatchObject({ outcomeKey: "HOME", asrScore: "France 2-1 Brazil" });
    expect(a!.confidence).toBeGreaterThan(0);
  });

  test("draw → DRAW", () => {
    expect(prefillAttestation("Full time France 2, Brazil 2.", market)).toMatchObject({ outcomeKey: "DRAW" });
  });

  test("away win → AWAY", () => {
    expect(prefillAttestation("Full time France 0, Brazil 3.", market)).toMatchObject({ outcomeKey: "AWAY" });
  });

  test("no score → no attestation (nothing to pre-fill, human attests manually)", () => {
    expect(prefillAttestation("great save by the keeper!", market)).toBeNull();
  });
});
