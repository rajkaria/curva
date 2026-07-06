/**
 * @tifo/market-catalogue — football market factories + the recurring micro-round
 * scheduler.
 *
 * Pure: each factory returns a `{ kind, params }` the app signs into a `market`
 * message. The market DNA (N-way outcomes, ladders, recurring rounds) is the
 * Hunch lineage, football-shaped. Micro-rounds are the live-demo killer — a new
 * 10-minute pool every 10 minutes, so the terrace never runs out of something to
 * trade and the demo never has dead air.
 */
import type { MarketKind, MarketParams } from "@tifo/terrace-base";

export interface MarketSpec {
  readonly kind: MarketKind;
  readonly params: MarketParams;
}

export function matchResult(homeTeam: string, awayTeam: string): MarketSpec {
  return {
    kind: "match-result",
    params: {
      title: `${homeTeam} vs ${awayTeam} — Result`,
      outcomes: ["HOME", "DRAW", "AWAY"],
      meta: { homeTeam, awayTeam },
    },
  };
}

/** One over/under market per line. Lines are stored as integer tenths — no floats near markets. */
export function totalGoalsLadder(lines: readonly number[]): MarketSpec[] {
  return lines.map((line) => {
    const lineTenths = Math.round(line * 10);
    return {
      kind: "total-goals" as const,
      params: {
        title: `Total Goals — Over/Under ${(lineTenths / 10).toFixed(1)}`,
        outcomes: ["OVER", "UNDER"],
        meta: { lineTenths },
      },
    };
  });
}

export function goalInWindow(round: number, windowStart: number, windowEnd: number): MarketSpec {
  return {
    kind: "goal-in-window",
    params: {
      title: `Goal in round ${round + 1}?`,
      outcomes: ["YES", "NO"],
      meta: { round, windowStart, windowEnd },
    },
  };
}

export function firstScorer(squad: readonly string[]): MarketSpec {
  if (squad.length === 0) throw new Error("firstScorer: squad must not be empty");
  return {
    kind: "first-scorer",
    params: {
      title: "First goalscorer",
      outcomes: [...squad, "NONE"],
      meta: { squadSize: squad.length },
    },
  };
}

/** (maxGoals+1)² grid of "h-a" correct-score outcomes. */
export function correctScore(maxGoals: number): MarketSpec {
  const outcomes: string[] = [];
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) outcomes.push(`${h}-${a}`);
  }
  return {
    kind: "correct-score",
    params: { title: "Correct score", outcomes, meta: { maxGoals } },
  };
}

// ── Recurring micro-round scheduler ──────────────────────────────────────────

export interface MicroRound {
  readonly round: number;
  readonly windowStart: number;
  readonly windowEnd: number;
  /** Betting closes when the window opens — you bet on the round before it starts. */
  readonly cutoffAt: number;
}

export interface MicroRoundConfig {
  readonly roundMs: number;
  readonly count: number;
}

export function scheduleMicroRounds(matchStart: number, config: MicroRoundConfig): MicroRound[] {
  const rounds: MicroRound[] = [];
  for (let i = 0; i < config.count; i++) {
    const windowStart = matchStart + i * config.roundMs;
    rounds.push({
      round: i,
      windowStart,
      windowEnd: windowStart + config.roundMs,
      cutoffAt: windowStart,
    });
  }
  return rounds;
}

/** The soonest round still open for betting (cutoff in the future), or null once the match is over. */
export function nextOpenRound(now: number, rounds: readonly MicroRound[]): MicroRound | null {
  return rounds.find((r) => now < r.cutoffAt) ?? null;
}

/** The round currently in play (its window contains `now`), or null. */
export function liveRound(now: number, rounds: readonly MicroRound[]): MicroRound | null {
  return rounds.find((r) => now >= r.windowStart && now < r.windowEnd) ?? null;
}
