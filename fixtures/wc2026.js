// Offline World Cup fixture bundle — ships with the app, no network.
// A full knockout bracket: Round of 16 → Quarters → Semis → 3rd place → Final.
// Winners advance consistently (the bracket is internally coherent), so the
// later rounds name real teams from the earlier ones. Squads are trimmed to the
// three danger men used for first-scorer markets + hunch suggestions.
//
// The two original fixtures keep their ids (`fra-bra`, `arg-eng`) and kickoffs
// so nothing built against them — the demo transcript below, deep links —
// breaks.
export const FIXTURES = [
  // ── Round of 16 ─────────────────────────────────────────────────────────────
  {
    id: "fra-bra",
    round: "R16",
    home: "France",
    away: "Brazil",
    kickoff: "2026-07-19T18:00:00Z",
    homeSquad: ["Mbappe", "Griezmann", "Dembele"],
    awaySquad: ["Vinicius", "Rodrygo", "Endrick"],
  },
  {
    id: "arg-eng",
    round: "R16",
    home: "Argentina",
    away: "England",
    kickoff: "2026-07-15T20:00:00Z",
    homeSquad: ["Messi", "Alvarez", "Martinez"],
    awaySquad: ["Kane", "Bellingham", "Foden"],
  },
  {
    id: "r16-esp-ger",
    round: "R16",
    home: "Spain",
    away: "Germany",
    kickoff: "2026-07-11T16:00:00Z",
    homeSquad: ["Yamal", "Pedri", "Morata"],
    awaySquad: ["Musiala", "Wirtz", "Havertz"],
  },
  {
    id: "r16-por-ned",
    round: "R16",
    home: "Portugal",
    away: "Netherlands",
    kickoff: "2026-07-11T20:00:00Z",
    homeSquad: ["Ronaldo", "Fernandes", "Leao"],
    awaySquad: ["Depay", "Gakpo", "Simons"],
  },
  {
    id: "r16-bel-cro",
    round: "R16",
    home: "Belgium",
    away: "Croatia",
    kickoff: "2026-07-12T16:00:00Z",
    homeSquad: ["DeBruyne", "Lukaku", "Doku"],
    awaySquad: ["Modric", "Kramaric", "Perisic"],
  },
  {
    id: "r16-ita-uru",
    round: "R16",
    home: "Italy",
    away: "Uruguay",
    kickoff: "2026-07-12T20:00:00Z",
    homeSquad: ["Chiesa", "Retegui", "Barella"],
    awaySquad: ["Nunez", "Valverde", "Pellistri"],
  },
  {
    id: "r16-usa-mex",
    round: "R16",
    home: "USA",
    away: "Mexico",
    kickoff: "2026-07-13T16:00:00Z",
    homeSquad: ["Pulisic", "Weah", "Reyna"],
    awaySquad: ["Lozano", "Jimenez", "Alvarado"],
  },
  {
    id: "r16-jpn-mar",
    round: "R16",
    home: "Japan",
    away: "Morocco",
    kickoff: "2026-07-13T20:00:00Z",
    homeSquad: ["Kubo", "Mitoma", "Kamada"],
    awaySquad: ["Hakimi", "Ziyech", "EnNesyri"],
  },
  // ── Quarter-finals (R16 winners: Spain, Portugal, Belgium, Italy, USA, Japan, Argentina, France) ──
  {
    id: "qf-esp-por",
    round: "QF",
    home: "Spain",
    away: "Portugal",
    kickoff: "2026-07-21T18:00:00Z",
    homeSquad: ["Yamal", "Pedri", "Morata"],
    awaySquad: ["Ronaldo", "Fernandes", "Leao"],
  },
  {
    id: "qf-bel-ita",
    round: "QF",
    home: "Belgium",
    away: "Italy",
    kickoff: "2026-07-21T21:00:00Z",
    homeSquad: ["DeBruyne", "Lukaku", "Doku"],
    awaySquad: ["Chiesa", "Retegui", "Barella"],
  },
  {
    id: "qf-usa-jpn",
    round: "QF",
    home: "USA",
    away: "Japan",
    kickoff: "2026-07-22T18:00:00Z",
    homeSquad: ["Pulisic", "Weah", "Reyna"],
    awaySquad: ["Kubo", "Mitoma", "Kamada"],
  },
  {
    id: "qf-arg-fra",
    round: "QF",
    home: "Argentina",
    away: "France",
    kickoff: "2026-07-22T21:00:00Z",
    homeSquad: ["Messi", "Alvarez", "Martinez"],
    awaySquad: ["Mbappe", "Griezmann", "Dembele"],
  },
  // ── Semi-finals (QF winners: Spain, Italy, USA, France) ─────────────────────
  {
    id: "sf-esp-ita",
    round: "SF",
    home: "Spain",
    away: "Italy",
    kickoff: "2026-07-24T19:00:00Z",
    homeSquad: ["Yamal", "Pedri", "Morata"],
    awaySquad: ["Chiesa", "Retegui", "Barella"],
  },
  {
    id: "sf-usa-fra",
    round: "SF",
    home: "USA",
    away: "France",
    kickoff: "2026-07-24T22:00:00Z",
    homeSquad: ["Pulisic", "Weah", "Reyna"],
    awaySquad: ["Mbappe", "Griezmann", "Dembele"],
  },
  // ── Third-place play-off (SF losers: Italy, USA) ────────────────────────────
  {
    id: "bronze-ita-usa",
    round: "3rd place",
    home: "Italy",
    away: "USA",
    kickoff: "2026-07-25T19:00:00Z",
    homeSquad: ["Chiesa", "Retegui", "Barella"],
    awaySquad: ["Pulisic", "Weah", "Reyna"],
  },
  // ── Final (SF winners: Spain, France) ───────────────────────────────────────
  {
    id: "final-esp-fra",
    round: "Final",
    home: "Spain",
    away: "France",
    kickoff: "2026-07-26T19:00:00Z",
    homeSquad: ["Yamal", "Pedri", "Morata"],
    awaySquad: ["Mbappe", "Griezmann", "Dembele"],
  },
];

// Team form for hunch suggestions (avg goals for/against) + two headline star
// players. Every team named in FIXTURES has a row, so a suggestion fires for
// any fixture in the bracket.
export const STATS_BUNDLE = {
  teams: [
    { name: "France", avgGoalsFor: 2.4, avgGoalsAgainst: 0.8, starPlayers: ["Mbappe", "Griezmann"] },
    { name: "Brazil", avgGoalsFor: 2.1, avgGoalsAgainst: 1.0, starPlayers: ["Vinicius", "Rodrygo"] },
    { name: "Argentina", avgGoalsFor: 2.2, avgGoalsAgainst: 0.9, starPlayers: ["Messi", "Alvarez"] },
    { name: "England", avgGoalsFor: 1.9, avgGoalsAgainst: 1.1, starPlayers: ["Kane", "Bellingham"] },
    { name: "Spain", avgGoalsFor: 2.0, avgGoalsAgainst: 0.9, starPlayers: ["Yamal", "Pedri"] },
    { name: "Germany", avgGoalsFor: 2.0, avgGoalsAgainst: 1.0, starPlayers: ["Musiala", "Wirtz"] },
    { name: "Portugal", avgGoalsFor: 2.1, avgGoalsAgainst: 1.0, starPlayers: ["Ronaldo", "Fernandes"] },
    { name: "Netherlands", avgGoalsFor: 1.9, avgGoalsAgainst: 1.0, starPlayers: ["Depay", "Gakpo"] },
    { name: "Belgium", avgGoalsFor: 1.8, avgGoalsAgainst: 1.1, starPlayers: ["DeBruyne", "Lukaku"] },
    { name: "Croatia", avgGoalsFor: 1.6, avgGoalsAgainst: 1.1, starPlayers: ["Modric", "Kramaric"] },
    { name: "Italy", avgGoalsFor: 1.7, avgGoalsAgainst: 0.9, starPlayers: ["Chiesa", "Barella"] },
    { name: "Uruguay", avgGoalsFor: 1.8, avgGoalsAgainst: 1.0, starPlayers: ["Nunez", "Valverde"] },
    { name: "USA", avgGoalsFor: 1.6, avgGoalsAgainst: 1.2, starPlayers: ["Pulisic", "Weah"] },
    { name: "Mexico", avgGoalsFor: 1.5, avgGoalsAgainst: 1.2, starPlayers: ["Lozano", "Jimenez"] },
    { name: "Japan", avgGoalsFor: 1.6, avgGoalsAgainst: 1.1, starPlayers: ["Kubo", "Mitoma"] },
    { name: "Morocco", avgGoalsFor: 1.5, avgGoalsAgainst: 1.0, starPlayers: ["Hakimi", "Ziyech"] },
  ],
};

// A canned full-time commentary clip transcript, for the offline ASR demo path.
// Ties to `fra-bra` (France 2, Brazil 1) — keep the score if you change teams.
export const DEMO_TRANSCRIPT = "And that is full time here in the final. France 2, Brazil 1. What a match.";
