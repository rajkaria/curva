---
feature: tifo-build
globs:
  - "packages/**"
  - "apps/**"
  - "fixtures/**"
  - "scripts/**"
  - "docs/**"
  - "package.json"
  - "tsconfig*.json"
  - "vitest.config.ts"
  - "eslint.config.js"
updated: 2026-07-07  # S13 done (UX quick wins); S14 next
---

# TIFO — build context

Serverless P2P football prediction market for the Tether Developers Cup
(Pears + QVAC + WDK). Concept/spec: [BUILD_SPEC.md](../BUILD_SPEC.md) ·
[SCOPE.md](../SCOPE.md). Sprint log: [SPRINTS.md](../SPRINTS.md).
Submission + judge review: [SUBMISSION.md](../SUBMISSION.md).

## Current state — what's working, deployed, broken

- **S0–S13 DONE.** S0–S10 on `main`. S11 (audit hardening) + S12 (render
  architecture) + S13 (UX quick wins) committed on the current worktree branch
  `claude/lucid-raman-07b8dd`, **not yet merged to `main`** (commits `b9e1f8e`
  S11, `806cfac` S12, and the S13 commit). Roadmap S14–S16 planned in
  [IMPROVEMENTS.md](../IMPROVEMENTS.md) + [docs/plans/](../plans/).
- **217 tests green** (property + fuzz + e2e + jsdom). Gates all pass:
  `npm run check` (typecheck + lint + test), `npm run build` (→ dist),
  `npm run demo` (full headless pipeline → converged/resolved/conserved/square).
  CI runs all three + e2e smoke on **Node 22**. Note: `lint` covers `apps` too.
- **Node floor:** the jsdom test path uses `require(esm)`, so gates need Node
  ≥20.19 / ≥22.12 / ≥24 — pinned in `.nvmrc` (22) and `engines`. An EOL Node 21
  will make `npm run check` fail to collect the jsdom file (not a code bug).
- npm workspaces, strict TS. Packages under `packages/` (**10**) + `apps/terrace`
  (Pear app) — S12 added `@tifo/terrace-ui`, the app's tested render layer.
- **Working:** every pure/protocol layer, the swarm sim/fuzzer, the end-to-end
  demo, the render layer (VMs + formatters + jsdom escaping), the S13 UX surfaces
  (demo banner, peer count, wallet/position/preview/P&L, names, live countdowns,
  chat+translate, quorum tally), all docs, dual-condition JS build.
- **Unverified (disclosed):** `apps/terrace/app.js` on-device behavior — needs the
  Pear runtime, not executable in CI. The render *logic* is extracted into
  `@tifo/terrace-ui` and fully tested; only the DOM-shell wiring in `app.js`
  (node lifecycle, action handlers, the render-loop scheduler) is untested —
  though a throwaway jsdom smoke confirms the module graph loads and the initial
  render + header/banner work. Real WDK/QVAC adapters are wired against the
  verified SDK surfaces but CI/demo use FakeWallet + FakeAsr (labelled in-UI).

## Recent changes — packages and why

- `market-kernel` — pure parimutuel (odds/payouts/refunds/void), exact conservation
  via largest-remainder dust. Ported from Hunch `computeMarketPayouts` (declared).
- `terrace-base` — signed msg protocol, deterministic `apply` fold, cutoff fence,
  `TerraceNode` Autobase/Hyperswarm runtime, append-only attestation log (`alog!`).
  S11: linearized index persisted in-view (`meta!seq`, restart/truncate-safe;
  `applyMessage(kv, msg)` — no seq param) + strict per-field message validation.
- `apps/terrace` S11: esc() on all peer strings, class allowlist, `busy()`
  single-flight buttons, emit writability guard, author-suffixed ids, stable
  per-terrace storage dirs.
- **`terrace-ui` (NEW, S12)** — the app's tested render layer.
  `vm.ts`: `(kv, uiState) → plain data` view-models (`terraceVm`, `marketVm`,
  `chatVm`, `gafferVm`, `settlementVm`); peer strings carried RAW, money/odds
  routed through market-kernel + crowd-oracle. `format.ts`: `usdt` (never
  rounds; property-tested inverse `parseUsdt`), `countdown`, `shortKey`.
  `html.ts`: the ONE place peer strings become markup — `esc` (text+attr),
  outcome-class allowlist, bar widths from numeric `pct`. 32 tests incl. a
  jsdom suite proving hostile payloads stay inert.
- `terrace-base` S12: `version()` on `MemoryKV` (mutation counter) and
  `TerraceNode` (Hyperbee core length) — the render loop's zero-work skip signal.
  S13: `TerraceNode.peerCount()` over a live-connection Set (add on `connection`,
  drop on conn `close`).
- **`terrace-ui` S13:** new VMs — `headerVm`/`walletVm`/`peerVm` (presence+money),
  `positionVm` (your at-risk), `previewPayout` (runs canonical `computePayouts`
  over bets+hypothetical → preview == manifest), `pnlVm` (post-settle P&L),
  `tallyVm` (quorum standings via oracle `tallyBreakdown`), `LANGS`, `DEMO_BANNER`,
  `closesAt`/`finalizesAt` on the market VMs; new html helpers
  (`demoBannerHtml`/`headerWidgetsHtml`/`positionHtml`/`previewLineHtml`/`pnlHtml`/
  `tallyHtml`/`cdSpanHtml`), each with a hostile-input jsdom test.
- **`crowd-oracle` S13:** `tallyBreakdown` (per-outcome writers/stake vs dual-⅔
  thresholds) refactored OUT of `quorumOutcome` — one source of truth the UI and
  resolver share; whale-only & sock-puppet-only shortfalls tested.
- `apps/terrace` S12→S13: thin DOM shell over `terrace-ui`. Versioned render loop;
  serialize-and-defer-on-focus scheduler (single-flight + trailing re-run; swap
  parked while an input is focused, values restored by stable id). S13 added a
  1s countdown/header ticker that touches ONLY `[data-cd-to]` text nodes + the
  header (never a full re-render), demo banner, header widgets, position/preview/
  P&L/tally cards, manual-attest, name+language pickers, Enter-to-send/autoscroll.
- `sim` — Lamport-ordered swarm model + fast-check fuzzer + `scenario.ts` runner.
- `wdk-vault` — seed→identity+wallet (BIP-39/44, matches S0b vector), min-transfer
  netting, settlement over WalletAdapter (`FakeWallet` / lazy `WdkWallet`),
  `randomVault`/`isValidMnemonic`.
- `crowd-oracle` — dual-⅔ quorum (safety proven), dispute→void (per-timestamp
  batch), rule-based ASR score extraction, QVAC ASR adapter.
- `qvac-surfaces` — Gaffer (LLM + fallback), translate, hunch suggestions; lazy LLM.
- `market-catalogue` — market factories + recurring micro-round scheduler.
- `steward-escrow` — Tier-2 2-of-3 election / deposit verify / co-signing.
- `e2e` + `scripts/demo.mjs` — full narrated pipeline (`npm run demo`).
- `apps/terrace` — Pear app (index.html + app.js) + `fixtures/wc2026.js`.
- Build system: `tsconfig.base.json`, per-package composite configs,
  `tsconfig.build.json`, dual export conditions (development→src, default→dist).

## Key decisions — choices and trade-offs

- **Identity = secp256k1 from the WDK seed (`…/0/1`), signed with noble**, not via
  WDK's signer → protocol stays pure/Bare-runnable; WDK load-bearing only for USDt.
- **Exact conservation** via deterministic largest-remainder dust (no treasury).
- **Quorum per-timestamp-batch, not per-event** — fixed a real order-dependence bug
  (partial tally latching quorum before a same-instant whale vote counted).
- **Heavy SDKs lazy-loaded behind adapters + fakes** so CI/demo stay pure/fast.
- **Dual export conditions** so tests run off TS source, app/runtime gets built JS.
- **Live-device pairing = paste-a-key** (spec fallback); BlindPairing = roadmap (S15).
- **S11: linearized index persisted as a view row (`meta!seq`)**, not a process
  counter — survives restarts, rolls back atomically on Autobase truncate;
  increments for dropped messages too (seq === position in the linearization).
- **S11: hostile-input validation lives in the fold** (silent deterministic
  drops, never throws); the app layer additionally escapes everything
  (`esc()` + CSS-class allowlist) — defense in depth, either alone suffices.
- **S12: render logic is a pure package, not in `app.js`.** VMs return plain
  data and carry peer strings RAW; escaping happens exactly once, in the `html`
  helpers, enforced by construction and proven by a jsdom suite. This makes the
  whole render layer testable in Node without Pear, and keeps the XSS surface to
  a single audited file rather than scattered across the DOM shell.
- **S12: render loop is version-gated + focus-safe.** Compare `node.version()`
  to skip work entirely when nothing changed; serialize async renders with a
  trailing re-run; defer the DOM swap while an input has focus. Directly fixes
  audit B2 (1s re-render wiped input; re-entrant render duplicated cards).
- **S13: time/presence surfaces tick WITHOUT a re-render.** Live countdowns +
  header (peer count / balance) change every second independent of the view
  version, so a 1s ticker rewrites only their text nodes (`[data-cd-to]` +
  `#head-widgets`/`#banner`, all outside `#app`) — no fragment swap, so a live
  clock can never wipe a half-typed input.
- **S13: demo mode is derived, not asserted** (`wallet instanceof FakeWallet`) →
  the banner is self-truthful and disappears in real mode; kills the honesty gap.
- **S13: preview/tally reuse the canonical engine, never a re-derivation.**
  `previewPayout` calls `computePayouts`; `tallyVm` reads the oracle's own
  `tallyBreakdown` — the numbers shown can't drift from what actually settles.
- **Node floor:** gates need `require(esm)` (Node ≥20.19/22.12/24) for the jsdom
  path — `.nvmrc`=22 (matches CI), `engines` tightened. Local default `node` is
  EOL v21.7.2 → run gates under Homebrew Node 25/20.20, else `check` mis-collects.

## Next steps — specific, actionable

**Next sprint: S14 — feature wiring** ([plans/s14-features.md](../plans/s14-features.md)),
then S15–S16 per [IMPROVEMENTS.md](../IMPROVEMENTS.md). S14 scope (F1–F8): every
catalogue market kind openable (total-goals ladder / first-scorer / correct-score,
not just match-result), wire the micro-round scheduler into the app, make hunch
suggestions tappable open-market actions, a PnL leaderboard from the view, a
steward-escrow UI surface, recent-terraces/rejoin persistence, the Gaffer's lazy
QVAC-LLM path, and bundle the full knockout bracket. Build on the S12/S13 VM layer.

**When you resume:** run gates with a supported Node —
`PATH="/opt/homebrew/Cellar/node/25.9.0_1/bin:$PATH" npm run check` (the default
`node` here is EOL 21.7.2 and mis-collects the jsdom test; `.nvmrc` pins 22).

**Branch:** S11–S13 committed on `claude/lucid-raman-07b8dd` (HEAD `806abd5`),
**still unmerged to `main`**. Decide whether to merge before S14 or keep stacking.

Human-only submission items (see SUBMISSION.md):
1. Register on DoraHacks, select all three tracks.
2. Record the ≤3-min YouTube demo (script: [DEMO.md](../DEMO.md)).
3. Fund a testnet wallet (faucet USDt + gas) for a real settlement txid on camera.
4. Confirm the GitHub repo is public.
5. Pick team nation (🏴󠁧󠁢󠁥󠁮󠁧󠁿 or 🇮🇳).

Optional code polish if time: BlindPairing for frictionless invites; exercise the
Pear app on real devices; wire the real WDK/QVAC paths against a funded wallet + a
downloaded model.
