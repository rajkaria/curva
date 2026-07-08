/**
 * Hunch suggestions — local reasoning over a bundled tournament stats pack to
 * suggest which markets to open. Fully offline and deterministic (the bundle
 * ships with the app); QVAC embeddings can enrich ranking later, but the base
 * suggester is pure rules so it always works with no model.
 */
import {
  firstScorer,
  matchResult,
  totalGoalsLadder,
  type MarketSpec,
} from "@curva/market-catalogue";

export interface TeamStats {
  readonly name: string;
  readonly avgGoalsFor: number;
  readonly avgGoalsAgainst: number;
  readonly starPlayers: readonly string[];
}

export interface StatsBundle {
  readonly teams: readonly TeamStats[];
}

export interface Suggestion {
  readonly spec: MarketSpec;
  readonly reason: string;
}

function team(bundle: StatsBundle, name: string): TeamStats | undefined {
  return bundle.teams.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

/** Nearest football line (x.5) to an expected-goals figure. */
function nearestHalfLine(expected: number): number {
  return Math.max(0.5, Math.round(expected - 0.5) + 0.5);
}

export function expectedGoals(home: TeamStats, away: TeamStats): number {
  const homeExp = (home.avgGoalsFor + away.avgGoalsAgainst) / 2;
  const awayExp = (away.avgGoalsFor + home.avgGoalsAgainst) / 2;
  return homeExp + awayExp;
}

export function suggestMarkets(homeTeam: string, awayTeam: string, bundle: StatsBundle): Suggestion[] {
  const suggestions: Suggestion[] = [
    { spec: matchResult(homeTeam, awayTeam), reason: "Every terrace opens on the result." },
  ];

  const home = team(bundle, homeTeam);
  const away = team(bundle, awayTeam);
  if (home && away) {
    const exp = expectedGoals(home, away);
    const line = nearestHalfLine(exp);
    const [ladder] = totalGoalsLadder([line]);
    suggestions.push({
      spec: ladder!,
      reason: `Combined form projects ~${exp.toFixed(1)} goals — line at ${line.toFixed(1)}.`,
    });

    const stars = [...home.starPlayers, ...away.starPlayers];
    if (stars.length > 0) {
      suggestions.push({
        spec: firstScorer(stars),
        reason: `Danger men: ${stars.slice(0, 3).join(", ")}.`,
      });
    }
  }
  return suggestions;
}

/** Deterministic keyword-overlap search over the bundle — the "local search" surface. */
export function searchStats(query: string, bundle: StatsBundle): Array<{ team: string; score: number }> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return bundle.teams
    .map((t) => {
      const hay = `${t.name} ${t.starPlayers.join(" ")}`.toLowerCase();
      const score = terms.reduce((s, term) => s + (hay.includes(term) ? 1 : 0), 0);
      return { team: t.name, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.team < b.team ? -1 : 1));
}
