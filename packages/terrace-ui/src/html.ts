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
import {
  DEMO_BANNER,
  type ChatLineVm,
  type CustomDraftVm,
  type DraftOutcomeVm,
  type EscrowVm,
  type HeaderVm,
  type LeaderboardVm,
  type MarketVm,
  type OutcomeVm,
  type PnlVm,
  type PositionVm,
  type TallyVm,
} from "./vm.js";

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

/** Market title + status pills. The closes pill ticks live (see cdSpanHtml). */
export function marketHeadHtml(vm: MarketVm): string {
  return `<div class="card stack">
    <h2 class="mkt-title">${esc(vm.title)}</h2>
    <div class="row"><span class="pill">${esc(vm.kind)}</span><span class="pill">${vm.statusLabel}</span><span class="pill">fee ${vm.feeBps}bps</span>${
      vm.closesLabel && vm.closesAt !== null
        ? `<span class="pill">${cdSpanHtml(vm.closesAt, "closes in ", vm.closesLabel)}</span>`
        : ""
    }</div>
  </div>`;
}

/**
 * A countdown span the DOM shell re-derives every second by target timestamp,
 * touching only its text node — never a full re-render, so a live clock never
 * wipes a half-typed stake. `prefix`/`to` are numbers/fixed copy (no peer data);
 * `initial` is a VM-formatted string, escaped like everything else.
 */
export function cdSpanHtml(to: number, prefix: string, initial: string): string {
  return `<span class="cd" data-cd-to="${to}" data-cd-prefix="${esc(prefix)}">${esc(initial)}</span>`;
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

// ── S13 surfaces: banner, header widgets, money, tally ────────────────────────

/** The demo-mode honesty strip. Our copy — no peer strings, but still escaped
 *  in one place. The browser demo overrides the text to disclose its own fakes. */
export function demoBannerHtml(text: string = DEMO_BANNER): string {
  return `<div class="banner">${esc(text)}</div>`;
}

/** Header widgets: presence pill (amber at 0), balance, name, address. */
export function headerWidgetsHtml(vm: HeaderVm): string {
  return `<span class="pill ${vm.peer.ok ? "ok" : "warn"}" title="connected peers">⇄ ${esc(vm.peer.label)}</span>
    <span class="pill" title="your demo balance">${esc(vm.wallet.label)}</span>
    <div class="who"><div>${esc(vm.name)}</div><div class="mono">${esc(vm.addrShort)}</div></div>`;
}

/** Your stake per outcome + total at risk. Outcome keys stay text + allowlist class. */
export function positionHtml(vm: PositionVm): string {
  if (!vm.hasPosition) return `<div class="muted">You haven't bet on this market yet.</div>`;
  const rows = vm.byOutcome
    .map(
      (o) =>
        `<div class="row"><span class="${outcomeClass(o.key)}">${esc(o.key)}</span><span class="muted">${esc(o.stakeLabel)} USDt</span></div>`,
    )
    .join("");
  return `<div class="stack">${rows}<div class="row"><b>At risk</b><span>${esc(vm.totalLabel)} USDt</span></div></div>`;
}

/** "Returns ~23.40 if HOME" under the stake input. Number is VM-derived; key escaped. */
export function previewLineHtml(outcomeKey: string, returnLabel: string): string {
  return `<div class="muted preview">Returns ~${esc(returnLabel)} if <span class="${outcomeClass(outcomeKey)}">${esc(outcomeKey)}</span></div>`;
}

/** Post-settle P&L line ("You're up 13.40 ✓"). Class swings on the sign. */
export function pnlHtml(vm: PnlVm): string {
  return `<div class="pnl ${vm.won ? "square" : vm.net < 0n ? "warn" : "muted"}">${esc(vm.label)}</div>`;
}

// ── S14 surfaces: leaderboard, trust tiers ────────────────────────────────────

/** Realized-P&L table. Names are peer strings → escaped; net class swings on the sign. */
export function leaderboardHtml(vm: LeaderboardVm): string {
  if (!vm.hasResolved) {
    return `<div class="muted">No settled markets yet — the table fills in as markets resolve.</div>`;
  }
  const rows = vm.rows
    .map(
      (r) =>
        `<div class="row"><span>${esc(r.name)}</span><span class="muted">${r.markets} mkt</span><span class="${
          r.won ? "square" : r.net < 0n ? "warn" : "muted"
        }">${esc(r.netLabel)} USDt</span></div>`,
    )
    .join("");
  return `<div class="stack">${rows}</div>`;
}

/**
 * Read-only trust-tier card. Tier 1 (mates) is always active; Tier 2 shows the
 * elected steward names (peer strings → escaped) when the terrace is big enough.
 * Thresholds and counts are numbers, never peer data.
 */
export function escrowHtml(vm: EscrowVm): string {
  const tier1 = `<div class="row"><span class="pill ok">Tier 1 · Mates</span><span class="muted">direct settle — active</span></div>`;
  const tier2 = vm.tier2Available
    ? `<div class="stack"><div class="row"><span class="pill ok">Tier 2 · Escrow</span><span class="muted">${vm.threshold}-of-${vm.stewards.length} co-signers</span></div><div class="row wrap">${vm.stewards
        .map((s) => `<span class="pill">${esc(s.name)}</span>`)
        .join(" ")}</div></div>`
    : `<div class="row"><span class="pill">Tier 2 · Escrow</span><span class="muted">standby</span></div>`;
  return `<div class="stack">${tier1}${tier2}<div class="muted">${esc(vm.note)}</div></div>`;
}

// ── the composer: the market as it will look, before a byte is signed ─────────

/**
 * One editable outcome chip. The key is peer text (escaped in both the label and
 * the remove button's aria-label); the index is a number the shell reads back off
 * `data-i` to know which chip was dropped — peer strings never reach a handler.
 */
export function outcomeChipHtml(key: string, index: number): string {
  return `<span class="chip-out"><i class="${`dot ${barClass(key)}`.trim()}"></i><span class="${outcomeClass(key)}">${esc(key)}</span><button class="x" type="button" data-i="${index}" aria-label="Remove ${esc(key)}">✕</button></span>`;
}

/** One preview row: outcome, the pool it opens with (nothing), its even-money odds. */
function draftOutcomeRowHtml(o: DraftOutcomeVm): string {
  return `<div class="draft-row">
    <div class="row"><span class="${outcomeClass(o.key)}">${esc(o.key)}</span><span class="muted">0.00 USDt</span><span class="odds-x">${esc(o.oddsLabel)}</span></div>
    <div class="bar"><span class="${barClass(o.key)}" style="width:${o.pct}%"></span></div>
  </div>`;
}

/**
 * The live preview card — the exact market the terrace will see, rendered from
 * the same VM that decides whether the draft is signable. When the draft can't be
 * opened, the status line says why instead of the odds pretending otherwise.
 */
export function customDraftHtml(vm: CustomDraftVm): string {
  const title = vm.title.trim()
    ? `<div class="draft-title">${esc(vm.title.trim())}</div>`
    : `<div class="draft-title empty">Your question goes here…</div>`;
  const rows = vm.outcomes.length
    ? vm.outcomes.map(draftOutcomeRowHtml).join("")
    : `<div class="muted">Pick a template or add outcomes — two at least.</div>`;
  const status = vm.valid
    ? `<div class="draft-status ok">Even money at open · ${vm.outcomeCount} outcomes · settles by crowd attestation</div>`
    : `<div class="draft-status warn">${esc(vm.error ?? "Draft incomplete")}</div>`;
  return `<div class="draft">
    <div class="draft-head">
      <span class="pill">preview</span>
      <span class="pill">closes in ${esc(vm.closesLabel)}</span>
    </div>
    ${title}
    <div class="stack draft-odds">${rows}</div>
    ${status}
  </div>`;
}

/** Quorum progress: per-outcome thresholds + who attested what. All keys/names escaped. */
export function tallyHtml(vm: TallyVm): string {
  if (!vm.hasAttestations) {
    return `<div class="muted">No attestations yet — ${esc(vm.thresholdLabel)}.</div>`;
  }
  const rows = vm.outcomes
    .map(
      (o) => `<div class="stack tallyrow">
      <div class="row"><span class="${outcomeClass(o.key)}">${esc(o.key)}</span><span class="muted">${esc(o.label)}</span><span>${
        o.meetsQuorum ? '<span class="pill ok">quorum ✓</span>' : `<span class="pill">${o.writersOk ? "writers ✓" : "writers…"} · ${o.stakeOk ? "stake ✓" : "stake…"}</span>`
      }</span></div>
    </div>`,
    )
    .join("");
  const voters = vm.voters
    .map((v) => `<span class="pill">${esc(v.name)} → <span class="${outcomeClass(v.outcomeKey)}">${esc(v.outcomeKey)}</span></span>`)
    .join(" ");
  return `<div class="stack">${rows}<div class="muted">${esc(vm.thresholdLabel)}</div><div class="row wrap">${voters}</div></div>`;
}
