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
updated: 2026-07-07  # S12 done (render layer + versioned loop); S13 next
---

# TIFO — build context

Serverless P2P football prediction market for the Tether Developers Cup
(Pears + QVAC + WDK). Concept/spec: [BUILD_SPEC.md](../BUILD_SPEC.md) ·
[SCOPE.md](../SCOPE.md). Sprint log: [SPRINTS.md](../SPRINTS.md).
Submission + judge review: [SUBMISSION.md](../SUBMISSION.md).

## Current state — what's working, deployed, broken

- **S0–S12 DONE.** S0–S10 on `main`. S11 (audit hardening) + S12 (render
  architecture) committed on the current worktree branch
  `claude/affectionate-montalcini-6f9448`, **not yet merged to `main`**
  (commits `b9e1f8e` S11, `806cfac` S12). Audit roadmap S13–S16 planned in
  [IMPROVEMENTS.md](../IMPROVEMENTS.md) + [docs/plans/](../plans/).
- **194 tests green** (property + fuzz + e2e + jsdom). Gates all pass:
  `npm run check` (typecheck + lint + test), `npm run build` (→ dist),
  `npm run demo` (full headless pipeline → converged/resolved/conserved/square).
  CI runs all three + e2e smoke. Note: `lint` now covers `apps` too.
- npm workspaces, strict TS. Packages under `packages/` (**10**) + `apps/terrace`
  (Pear app) — S12 added `@tifo/terrace-ui`, the app's tested render layer.
- **Working:** every pure/protocol layer, the swarm sim/fuzzer, the end-to-end
  demo, the render layer (VMs + formatters + jsdom escaping), all docs,
  dual-condition JS build.
- **Unverified (disclosed):** `apps/terrace/app.js` on-device behavior — needs the
  Pear runtime, not executable in CI. The render *logic* is now extracted into
  `@tifo/terrace-ui` and fully tested; only the DOM-shell wiring in `app.js`
  (node lifecycle, action handlers, the render-loop scheduler) is untested.
  Real WDK/QVAC adapters are wired against the verified SDK surfaces but
  CI/demo use FakeWallet + FakeAsr (labelled).

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
- `apps/terrace` S12: rewritten as a thin DOM shell over `terrace-ui`. Versioned
  render loop; serialize-and-defer-on-focus scheduler (single-flight + trailing
  re-run; DOM swap parked while an input is focused, values restored by stable
  id) so gossip can't wipe a half-typed stake. No money math / raw innerHTML left.
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

## Next steps — specific, actionable

**Next sprint: S13 — UX quick wins** ([plans/s13-ux.md](../plans/s13-ux.md)),
then S14–S16 per [IMPROVEMENTS.md](../IMPROVEMENTS.md). S13 scope (all sit on the
S12 VM layer — add fields to the VMs, render via the html helpers):
- **T1–T2:** in-UI demo-mode banner (closes the honesty gap: SUBMISSION.md
  claims demo-mode is "labelled in-UI" but no banner exists — audit U1) + a
  peer-count / connection indicator so the kill-the-host demo is visible (U2).
- **T3:** money surfaces — `walletVm` (balance), `positionVm` (per-market stake),
  `previewPayout`, post-settle P&L (U3). Route through market-kernel as usual.
- **T4–T6:** registered display names instead of pubkey hex + a name picker
  (U4), live countdowns, chat ergonomics + translation polish.
- **T7–T9:** attestation UX, visual polish, then gates + docs + commit.

**Before starting S13:** consider merging this branch to `main` (S11+S12 are
green and committed) so S13 forks from a clean base — or keep stacking on this
branch. No merge has happened yet.

Human-only submission items (see SUBMISSION.md):
1. Register on DoraHacks, select all three tracks.
2. Record the ≤3-min YouTube demo (script: [DEMO.md](../DEMO.md)).
3. Fund a testnet wallet (faucet USDt + gas) for a real settlement txid on camera.
4. Confirm the GitHub repo is public.
5. Pick team nation (🏴󠁧󠁢󠁥󠁮󠁧󠁿 or 🇮🇳).

Optional code polish if time: BlindPairing for frictionless invites; exercise the
Pear app on real devices; wire the real WDK/QVAC paths against a funded wallet + a
downloaded model.
