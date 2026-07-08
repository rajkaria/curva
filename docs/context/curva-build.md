---
feature: curva-build
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
  - "web/**"
updated: 2026-07-08  # renamed TIFO→Curva; landing+docs site live on Vercel; browser demo next
---

# Curva — build context

Serverless P2P football prediction market for the Tether Developers Cup
(Pears + QVAC + WDK). Concept/spec: [BUILD_SPEC.md](../BUILD_SPEC.md) ·
[SCOPE.md](../SCOPE.md). Sprint log: [SPRINTS.md](../SPRINTS.md).
Submission + judge review: [SUBMISSION.md](../SUBMISSION.md).

## Current state — what's working, deployed, broken

- **RENAMED TIFO → Curva (2026-07-08).** All packages `@curva/*`, root pkg + Pear
  app `curva`; context doc + README naming narrative rewritten (curva = the ultras'
  stand, NOT the tifo/choreographed display). Committed + pushed: `origin/main`
  @ `4afc639` (258 subs/69 files). Repo renamed to **github.com/rajkaria/curva**,
  git remote URL updated; repo public, MIT.
- **S0–S14 DONE and on `origin/main`** — 237 tests green. Roadmap S15–S16 in
  [IMPROVEMENTS.md](../IMPROVEMENTS.md) + [docs/plans/](../plans/). The former
  submission items "push to main" + "confirm repo public" are now DONE.
- **Landing + docs site LIVE.** `web/` = self-contained static (no build):
  `index.html` (landing) + `docs.html` (full protocol/architecture/oracle/trust
  docs) + `README.md` (deploy steps). Deployed via Vercel CLI from `web/` to
  project **`curva`** (scope `rajkaria67-1831s-projects`); public at
  **https://curva-rouge.vercel.app** (HTTP 200) + `/docs.html`. For git-auto-deploy,
  set Root Directory=`web` in the dashboard. TODO in `web/index.html`: the
  "Watch the demo" button `href="#"` awaits the YouTube URL.
- **237 tests green** (property + fuzz + e2e + jsdom; +20 in S14). Gates all
  pass: `npm run check` (typecheck + lint + test), `npm run build` (→ dist),
  `npm run demo` (full headless pipeline → converged/resolved/conserved/square).
  CI runs all three + e2e smoke on **Node 22**. Note: `lint` covers `apps` too.
- **Node floor:** the jsdom test path uses `require(esm)`, so gates need Node
  ≥20.19 / ≥22.12 / ≥24 — pinned in `.nvmrc` (22) and `engines`. An EOL Node 21
  will make `npm run check` fail to collect the jsdom file (not a code bug). The
  default `node` on this machine is EOL 21.7.2 — run gates via a Homebrew
  `node@20`/`node@25` on PATH.
- npm workspaces, strict TS. Packages under `packages/` (**10**) + `apps/terrace`
  (Pear app). `@curva/terrace-ui` (S12) is the app's tested render layer; S14 gave
  it deps on `@curva/market-catalogue` + `@curva/steward-escrow` (picker/planner,
  escrow election).
- **Working:** every pure/protocol layer, the swarm sim/fuzzer, the end-to-end
  demo, the render layer (VMs + formatters + jsdom escaping), the S13 UX surfaces
  (demo banner, peer count, wallet/position/preview/P&L, names, live countdowns,
  chat+translate, quorum tally), the S14 feature surfaces (market-type picker for
  every catalogue kind, opener-side micro-round scheduler, tappable hunches,
  realized-P&L leaderboard, trust-tier/steward panel, recent-terraces rejoin,
  lazy Gaffer-LLM toggle, full 16-fixture bracket), all docs, dual-condition JS
  build.
- **Unverified (disclosed):** `apps/terrace/app.js` on-device behavior — needs the
  Pear runtime, not executable in CI. The render *logic* is extracted into
  `@curva/terrace-ui` and fully tested; only the DOM-shell wiring in `app.js`
  (node lifecycle, action handlers, the render-loop scheduler) is untested —
  though a throwaway jsdom smoke confirms the module graph loads and the initial
  render + header/banner work. Real WDK/QVAC adapters are wired against the
  verified SDK surfaces but CI/demo use FakeWallet + FakeAsr (labelled in-UI).

## Recent changes — packages and why

- **`web/` (NEW, 2026-07-08)** — the public marketing site: `index.html` (landing),
  `docs.html` (10-section docs: overview/how-it-works/CRDT-insight/architecture/
  tracks/oracle/trust/proofs/run/FAQ), `README.md` (Vercel deploy steps). Vanilla
  self-contained HTML/CSS, no build, theme-matched to the app's `#0b0c1a` navy +
  `#34e39a` pitch-green. Verified: mobile no-overflow, a11y tree, live on Vercel.
- **Rename sweep (2026-07-08)** — `@tifo/*`→`@curva/*` across all packages/app/docs;
  `docs/context/tifo-build.md`→`curva-build.md`; `.nvmrc`/engines unchanged.
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
- **Rename TIFO → Curva (2026-07-08):** curva = the curved ultras' stand (the crowd
  as one), fits "the market is the crowd"; README etymology rewritten by hand (a
  curva is the stand, not the choreographed display) then a case-aware word-boundary
  sweep for the rest; gates re-verified green (237/build/demo).
- **Public face = a static `web/` site, NOT the app.** The Pear app can't run in a
  plain browser (Bare modules: autobase/hyperswarm) and "no server" is the thesis —
  so the subdomain serves a self-contained landing + docs page on Vercel; the app
  itself is never hosted. Browser-demo (fakes) is the exception, still to build.

## Next steps — specific, actionable

**Code — the clickable browser demo (roadmap S15/T6):** the unfinished half of the
site. A `web/demo/` esbuild bundle that replays the `npm run demo` scenario through
the REAL `@curva/terrace-ui` on `FakeWallet` + `FakeAsr` (drive `MemoryKV` directly,
no Pear/network — only `TerraceNode` is non-browser and a single-peer demo skips it),
linked from the landing demo CTA. Then S15 pairing (BlindPairing) + S16 trust
hardening per [IMPROVEMENTS.md](../IMPROVEMENTS.md).

**When you resume:** run gates with a supported Node (default `node` here is EOL
21.7.2 and mis-collects the jsdom test):
`PATH="/opt/homebrew/Cellar/node@20/20.20.2/bin:$PATH" npm run check`.

**Branch:** this session's work is on `origin/main` @ `4afc639`, pushed from worktree
branch `claude/goofy-poitras-fc8dcc`. Start next from a fresh worktree off `main`.

**Human-only (see SUBMISSION.md):**
1. Add the **subdomain** in Vercel → project `curva` → Settings → Domains.
2. Record the ≤3-min YouTube demo ([DEMO.md](../DEMO.md)); then set the "Watch the
   demo" `href` (search `TODO` in `web/index.html`) — it auto-redeploys on push.
3. Register on DoraHacks, select all three tracks; pick team nation (🏴 or 🇮🇳).
4. Fund a testnet wallet (faucet USDt + gas) for a real settlement txid on camera.

**Non-critical (S7 leftover):** the Gaffer QVAC-LLM model
(`apps/terrace/models/llama-3.2-1b-q4_0.gguf`, ~800 MB) is not downloaded; the app
falls back to templates honestly (🎩 vs 🎩⚡). Off the money path — only needed to
show a live on-device LLM in the video. Real WDK/QVAC adapter swap is a ~10-line
change in `app.js` + env config (rpcUrl/usdtAddress/modelSrc).
