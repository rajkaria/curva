/**
 * HTML-string builders — the ONE place peer-derived strings become markup.
 *
 * Pure string functions (no DOM types), so they build in Node and render in
 * Pear identically, and the jsdom suite can instantiate the output and prove
 * hostile payloads stay inert. Rules, enforced here and tested:
 *  - every interpolated peer string goes through {@link esc} (text AND
 *    attribute contexts)
 *  - peer strings never become CSS class names — only the outcome allowlist
 *  - bar widths come from the VM's numeric `pct`, never a string
 */
import type { ChatLineVm, MarketVm, OutcomeVm } from "./vm.js";

/** Escape for both text and attribute contexts. */
export function esc(s: unknown): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Peer strings never become CSS class names — only this allowlist does. */
export const SAFE_CLASS: ReadonlySet<string> = new Set([
  "HOME",
  "AWAY",
  "DRAW",
  "YES",
  "NO",
  "OVER",
  "UNDER",
]);
export const outcomeClass = (k: string): string => (SAFE_CLASS.has(k) ? k : "");
export const barClass = (k: string): string => (SAFE_CLASS.has(k) ? "b" + k : "");

/** Market title + status pills. */
export function marketHeadHtml(vm: MarketVm): string {
  return `<div class="card stack">
    <h2>${esc(vm.title)}</h2>
    <div class="row"><span class="pill">${esc(vm.kind)}</span><span class="pill">${vm.statusLabel}</span><span class="pill">fee ${vm.feeBps}bps</span>${
      vm.closesLabel ? `<span class="pill">${esc(vm.closesLabel)}</span>` : ""
    }</div>
  </div>`;
}

/** One outcome: key, gross pool, odds, probability bar. */
export function outcomeRowHtml(o: OutcomeVm): string {
  return `<div>
    <div class="row"><span class="${outcomeClass(o.key)}">${esc(o.key)}</span><span class="muted">${esc(o.grossLabel)} USDt</span><span>${esc(o.oddsLabel)}</span></div>
    <div class="bar"><span class="${barClass(o.key)}" style="width:${o.pct}%"></span></div>
  </div>`;
}

/** One chat line: name + text (both peer-derived). */
export function chatLineHtml(l: ChatLineVm): string {
  return `<div class="line"><span class="muted">${esc(l.name)}</span> ${esc(l.text)}</div>`;
}

/** The full market card (head + every outcome row) as one string. */
export function renderCard(vm: MarketVm): string {
  return `<div class="stack">${marketHeadHtml(vm)}<div class="card stack"><h2>Pool odds</h2>${vm.outcomes
    .map(outcomeRowHtml)
    .join("")}</div></div>`;
}
