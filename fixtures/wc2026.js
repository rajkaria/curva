// Offline World Cup fixture bundle — ships with the app, no network.
// Squads trimmed to the danger men used for first-scorer markets + hunch suggestions.
export const FIXTURES = [
  {
    id: "fra-bra",
    home: "France",
    away: "Brazil",
    kickoff: "2026-07-19T18:00:00Z",
    homeSquad: ["Mbappe", "Griezmann", "Dembele"],
    awaySquad: ["Vinicius", "Rodrygo", "Endrick"],
  },
  {
    id: "arg-eng",
    home: "Argentina",
    away: "England",
    kickoff: "2026-07-15T20:00:00Z",
    homeSquad: ["Messi", "Alvarez", "Martinez"],
    awaySquad: ["Kane", "Bellingham", "Foden"],
  },
];

export const STATS_BUNDLE = {
  teams: [
    { name: "France", avgGoalsFor: 2.4, avgGoalsAgainst: 0.8, starPlayers: ["Mbappe", "Griezmann"] },
    { name: "Brazil", avgGoalsFor: 2.1, avgGoalsAgainst: 1.0, starPlayers: ["Vinicius", "Rodrygo"] },
    { name: "Argentina", avgGoalsFor: 2.2, avgGoalsAgainst: 0.9, starPlayers: ["Messi", "Alvarez"] },
    { name: "England", avgGoalsFor: 1.9, avgGoalsAgainst: 1.1, starPlayers: ["Kane", "Bellingham"] },
  ],
};

// A canned full-time commentary clip transcript, for the offline ASR demo path.
export const DEMO_TRANSCRIPT = "And that is full time here in the final. France 2, Brazil 1. What a match.";
