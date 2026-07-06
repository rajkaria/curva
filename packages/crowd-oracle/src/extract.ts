/**
 * Score extraction — the "assist" half of the crowd oracle.
 *
 * A pure, rule-based pass over the on-device ASR transcript. It never resolves
 * anything: it produces a *pre-filled* attestation that a human confirms with
 * one tap and signs. Rule-based (not an LLM) on purpose — it must be robust and
 * deterministic over noisy pub audio, and the same rule runs identically on
 * every device. The LLM's job (the Gaffer) is banter, never the money path.
 */

export interface ScoreReading {
  readonly home: number;
  readonly away: number;
  /** 0..1 — how much to trust this parse (team-anchored + full-time cue = high). */
  readonly confidence: number;
}

export interface ResultMarket {
  readonly outcomes: readonly string[]; // ["HOME","DRAW","AWAY"]
  readonly homeTeam: string;
  readonly awayTeam: string;
}

export interface PrefilledAttestation {
  readonly outcomeKey: string;
  readonly confidence: number;
  /** Human-readable score for the confirm prompt, e.g. "France 2-1 Brazil". */
  readonly asrScore: string;
}

const NUMBER_WORDS: Record<string, number> = {
  nil: 0, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function digitize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(nil|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (w) => String(NUMBER_WORDS[w]));
}

/** The score reported immediately after `name`, if any (within a short window). */
function scoreAfter(text: string, name: string): number | null {
  const lname = name.toLowerCase();
  let result: number | null = null;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(lname, from);
    if (idx === -1) break;
    const window = text.slice(idx + lname.length, idx + lname.length + 15);
    const m = window.match(/\d+/);
    if (m) result = Number(m[0]); // keep the last occurrence → the final score
    from = idx + lname.length;
  }
  return result;
}

export function extractScore(transcript: string, market: ResultMarket): ScoreReading | null {
  const text = digitize(transcript);
  const fullTimeCue = /\bfull[\s-]?time\b|\bfinal\b|\bfinishes\b|\bfull time\b/.test(text);

  const home = scoreAfter(text, market.homeTeam);
  const away = scoreAfter(text, market.awayTeam);
  if (home !== null && away !== null) {
    return { home, away, confidence: fullTimeCue ? 0.9 : 0.75 };
  }

  // Fallback: a bare "N-M" / "N to M" score; take the last one mentioned.
  const matches = [...text.matchAll(/(\d+)\s*(?:[-–:]|to)\s*(\d+)/g)];
  const last = matches.at(-1);
  if (last) {
    return { home: Number(last[1]), away: Number(last[2]), confidence: fullTimeCue ? 0.6 : 0.45 };
  }

  // Last resort: two adjacent numbers ("finishes 2 1"), only with a full-time cue
  // so stray numbers in crowd noise don't get misread as a score.
  if (fullTimeCue) {
    const spaced = [...text.matchAll(/(\d+)\s+(\d+)/g)].at(-1);
    if (spaced) return { home: Number(spaced[1]), away: Number(spaced[2]), confidence: 0.45 };
  }
  return null;
}

export function prefillAttestation(transcript: string, market: ResultMarket): PrefilledAttestation | null {
  const score = extractScore(transcript, market);
  if (!score) return null;
  const outcomeKey = score.home > score.away ? "HOME" : score.home < score.away ? "AWAY" : "DRAW";
  return {
    outcomeKey,
    confidence: score.confidence,
    asrScore: `${market.homeTeam} ${score.home}-${score.away} ${market.awayTeam}`,
  };
}
