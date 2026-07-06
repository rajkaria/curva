/**
 * The Gaffer — a local LLM commentator that banters about live pool state.
 *
 * The pool summary (title, score, outcome percentages) is derived from the
 * Hyperbee view and turned into a compact prompt here — pure and tested. The
 * LLM only writes the quip; if it fails or a model isn't loaded, the caller
 * falls back to a deterministic template so the Gaffer never blocks the UI.
 */
import type { LlmAdapter, ChatTurn } from "./llm.js";

export interface OutcomeSummary {
  readonly key: string;
  readonly pct: number; // 0..100
}

export interface PoolSummary {
  readonly title: string;
  readonly score?: string; // e.g. "FRA 2-1 BRA"
  readonly outcomes: readonly OutcomeSummary[];
}

const SYSTEM =
  "You are the TIFO terrace pundit. One punchy sentence, football-terrace tone, no hedging.";

export function buildGafferContext(pool: PoolSummary): ChatTurn[] {
  const book = pool.outcomes
    .map((o) => `${o.key} ${o.pct}%`)
    .join(" / ");
  const scorePart = pool.score ? `Score: ${pool.score}. ` : "";
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Market: ${pool.title}. ${scorePart}Pool: ${book}. Call it.` },
  ];
}

/** A deterministic quip when no model is loaded — the Gaffer always has something to say. */
export function fallbackQuip(pool: PoolSummary): string {
  const top = [...pool.outcomes].sort((a, b) => b.pct - a.pct)[0];
  if (!top) return "Nothing in the pool yet — someone break the ice.";
  return `${top.pct}% of the terrace is on ${top.key}. Brave, or daft?`;
}

export async function gafferQuip(pool: PoolSummary, llm: LlmAdapter): Promise<string> {
  try {
    const text = (await llm.complete(buildGafferContext(pool))).trim();
    return text.length > 0 ? text : fallbackQuip(pool);
  } catch {
    return fallbackQuip(pool);
  }
}
