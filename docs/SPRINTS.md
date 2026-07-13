# Curva — Sprint Log

Scope: [SCOPE.md](./SCOPE.md) · Spec: [BUILD_SPEC.md](./BUILD_SPEC.md)

## S0 — Day-0 spikes (go/no-go per external SDK) — IN PROGRESS

Goal: prove or kill each external dependency before writing product code.

| Spike | Question | Verdict |
|---|---|---|
| S0a Autobase | 2 writers, deterministic Hyperbee view, convergence after replication? | **GO** — both peers converge to identical `pool!fra-bra!*` totals after replication; dynamic writer add via log message works (`spikes/spike-autobase.mjs`) |
| S0b WDK | SDK on npm? seed → address → (testnet USDt transfer path)? | **GO** — BIP-39 seed → BIP-44 `m/44'/60'/0'/0/n` derivation matches the canonical test vector exactly; offline message signing works (`spikes/spike-wdk.mjs`) |
| S0c QVAC | SDK publicly available? on-device ASR/LLM feasible? | **GO** — Llama-3.2-1B Q4_0 downloads + runs fully local via `loadModel`/`completion` token stream (`spikes/spike-qvac.mjs`) |

Pinned versions: `autobase@7.28.1` · `corestore@7.11.0` · `hyperbee@2.27.3` ·
`@tetherto/wdk-wallet-evm@1.0.0-beta.15` · `@qvac/sdk@0.14.1` · `@qvac/llm-llamacpp@0.31.2`

Gotchas recorded for later sprints:

- **QVAC dep weight:** `@qvac/sdk` hard-depends on ALL plugin packages (whisper,
  diffusion, tts, ocr, vla…) → ~5.2GB `node_modules`. For the Pear app use
  **`@qvac/bare-sdk`** + only `@qvac/llm-llamacpp` (same surface, no built-in
  plugin addons, designed for Pear/Bare consumers wiring their own worker entry).
- **Interrupted npm installs leave husk packages** (dir present, no
  `package.json`) → Bare worker dies with `MODULE_NOT_FOUND` + `SIGABRT` at RPC
  init. Fix = wipe `node_modules` + fresh install; verify every `@qvac/*` dir has
  a `package.json`.
- WDK: `account.sign(message)` (not `signMessage`); `getAccount(n)` is async.
- Autobase `apply` must be deterministic; writer add via `addWriter` log message.

## S1 — market-kernel port — DONE

Gate: conservation + commutativity green — **PASSED** (29 tests, `npm run check` green).

- `packages/market-kernel` — pure parimutuel core, zero I/O, bigint USDt micros:
  `buildPools` / `mergePools` / `impliedOdds` / `computePayouts`
- Ported from Hunch `computeMarketPayouts`, adapted for P2P (all deviations
  documented in the package README): N-way outcomes; **exact** conservation via
  largest-remainder dust distribution (no treasury to keep the dust); void /
  single-participant / no-winning-stake → full gross refund; lines sorted by
  bettorId for byte-identical manifests across peers.
- Property suite (fast-check): conservation (`Σ payouts + Σ fees === Σ stakes`,
  exact), permutation + partition/merge commutativity (the CRDT claim), winner
  no-loss at feeBps 0, refund exactness, odds sanity. TDD: full suite written
  first, watched 29/29 fail, then implemented.
- Repo is now an npm workspace (`packages/*`); `npm run check` =
  typecheck (strict TS) + eslint + vitest. `spikes/` stays out of the workspace
  (its 5GB QVAC node_modules must not hoist).
## S2 — terrace-base protocol — DONE
Gate: 3-peer sim convergence — **PASSED** (incl. partition/heal, fence-under-gossip).
Signed msg codec (secp256k1/keccak, recoverable sigs, canonical JSON), the
deterministic `apply` fold over a KV view, the cutoff fence (lock + 90s belt),
`@curva/sim` Lamport-ordered swarm, and the `TerraceNode` Autobase/Hyperswarm runtime.

## S3 — swarm fuzzer — DONE
Gate: invariants hold under fuzz — **PASSED**. 100 randomized runs (interleavings,
churn, partitions/heals, late bets, double-attests, whales) + targeted attacks →
convergence, no-inflation, conservation, dedup, fence.

## S4 — Pear app — DONE
Gate: full flow works — **PASSED** via the headless e2e (`npm run demo`, also in CI).
`apps/terrace` real Pear app wiring all packages; `@curva/e2e` narrated end-to-end
pipeline (derive → terrace → kill-host → lock → ASR attest → resolve → net → settle
→ receipts). Live-device pairing = paste-a-key (BlindPairing = roadmap).

## S5 — wdk-vault settlement — DONE
Gate: e2e settlement — **PASSED** (FakeWallet path in CI; WdkWallet real-mode ready).
Seed → identity + wallet (BIP-39/44, matches S0b vector 0x9858…), min-transfer
netting (property-proven), settlement over a WalletAdapter, receipts.

## S6 — crowd oracle — DONE
Gate: quorum-safety tests — **PASSED**. Dual ⅔ quorum (safety proven), dispute-window
void (batch-per-timestamp evaluation), rule-based ASR score extraction, QVAC ASR
adapter.

## S7 — QVAC surfaces — DONE
The Gaffer (pool-state LLM commentator + deterministic fallback), terrace translate
(routing over a Translator), hunch suggestions (stat-driven + keyword search). All
off the money path; lazy QVAC LLM adapter.

## S8 — market catalogue — DONE
Factories: match-result, total-goals ladder (integer tenths), goal-in-window
micro-rounds, first-scorer, correct-score. Recurring micro-round scheduler
(nextOpenRound/liveRound) — the live-demo driver.

## S9 — steward escrow — DONE
Tier-2 2-of-3: deterministic election, per-peer on-chain deposit verification,
threshold co-signing. FROST SwarmVault deferred to VISION (Tier 3).

## S10 — ship — DONE
JS build (dual export conditions, `npm run build`), CI = check + build + demo smoke,
docs (ARCHITECTURE/ORACLE/TRUST/DEMO/VISION), README + prior-work declaration,
judge-loop self-review ([SUBMISSION.md](./SUBMISSION.md)). 141 tests green.

## S11 — correctness & security hardening — DONE
Gate: fold-validation + seq-determinism tests green; check/build/demo green — **PASSED** (160 tests).
From the 2026-07-07 product audit ([IMPROVEMENTS.md](./IMPROVEMENTS.md), plan:
[plans/s11-hardening.md](./plans/s11-hardening.md)):
- **Fold:** linearized index now lives in the view (`meta!seq`) — survives app
  restarts and rolls back atomically on Autobase truncate (was a process-local
  counter → divergent view keys on device). Strict field validation (string
  types, length caps, kind whitelist, finite ts/cutoff, v===1) so hostile
  payloads die at the protocol layer, not in a renderer.
- **App:** all peer-derived strings escaped before `innerHTML`; outcome CSS
  classes via allowlist only (kills class injection); single-flight `busy()`
  guard on every async button (no double-click double-bets); stake validation;
  `emit()` writability guard + error toasts; author-suffixed marketIds/nonces
  (no same-ms collisions); stable per-terrace storage dirs (writer key survives
  restarts, no per-launch store leak).

## S12 — render architecture & tests — DONE
Gate: new `@curva/terrace-ui` suite green (VMs + formatters + jsdom escaping);
check/build/demo green — **PASSED** (194 tests). Addresses audit finding B2
(1s re-render wiped in-progress input; re-entrant async `render()` produced
duplicate/misordered cards). Plan: [plans/s12-render.md](./plans/s12-render.md).
- **New package `@curva/terrace-ui`:** the app's tested render layer. `vm.ts` —
  `(kv, uiState) → plain data` view-models (terrace / market / chat / gaffer /
  settlement), carrying peer strings RAW and routing every money/odds number
  through market-kernel + crowd-oracle. `format.ts` — exact display strings
  (`usdt` never rounds; property-tested inverse `parseUsdt`; `countdown`,
  `shortKey`). `html.ts` — the SINGLE place peer strings become markup: `esc`
  for text+attr, an outcome-class allowlist (no class injection), bar widths
  from numeric `pct` only. 32 new tests incl. a jsdom suite that instantiates
  the helpers' output and proves hostile payloads stay inert.
- **`version()` skip signal:** added to both `MemoryKV` (mutation counter) and
  the Autobase runtime (Hyperbee core length). The render loop compares it and
  does ZERO Hyperbee scans / DOM work while nothing has changed.
- **`app.js` → thin DOM shell:** consumes the VMs + html helpers only (no ad-hoc
  money math, no raw `innerHTML` of peer strings). Versioned render loop with a
  serialize-and-defer-on-focus scheduler: renders are single-flight with a
  trailing re-run, and the DOM swap is parked while an input has focus (values
  snapshotted/restored by stable id) so background gossip can't wipe a
  half-typed stake or message.
- **Housekeeping:** stopped tracking `*.tsbuildinfo` (gitignored).

## S13 — UX quick wins — DONE
Gate: demo banner + peer count + money surfaces render from view-models under
test — **PASSED** (217 tests). Closes audit findings U1–U7 + U9. Plan:
[plans/s13-ux.md](./plans/s13-ux.md).
- **Honesty (U1):** a persistent demo banner — `DEMO MODE — FakeWallet (demo
  funds) · bundled transcript ASR` — shown iff the active adapters are fakes
  (`wallet instanceof FakeWallet`), so it disappears by itself in real mode.
  SUBMISSION.md's "labelled in-UI" claim is now literally true.
- **Presence (U2):** `TerraceNode.peerCount()` tracks live Hyperswarm
  connections (add on `connection`, drop on `close`); a header pill shows
  `⇄ N peers`, amber at 0 — the "kill the host, the market lives" demo is now
  visible. `peerVm` tested with a fake count.
- **Money (U3):** `walletVm` (header balance), `positionVm` (your stake per
  outcome + at-risk), `previewPayout` (live "Returns ~X if HOME" under the stake
  input — runs the canonical `computePayouts` over current bets + your
  hypothetical one, so the preview equals what settlement pays, dust and all),
  and a post-settle `pnlVm` P&L line ("You're up 13.40 ✓"). Property test pins
  preview == manifest.
- **Names (U4):** first-launch name (default `fan-xxxx`), persisted, sent in
  `hello`, editable; chat, tally and header show registered names via the
  identities map (short-key fallback).
- **Countdowns (U5):** `closes in 12:04` / `finalizes in 9:31` tick live via
  `cdSpanHtml` data attributes — a 1s ticker rewrites only the countdown text
  nodes (and the header), never a full re-render, so a live clock can't wipe a
  half-typed stake.
- **Chat + translation (U6):** Enter-to-send, autoscroll (unless scrolled up),
  a persisted language picker (`LANGS`, 8 languages) that stamps each message —
  the 32-nation `renderForViewer` translate surface is now live in-app, not dead
  code.
- **Attestation UX (U7):** a manual-attest disclosure emitting the same signed
  `attest` message as the ASR path, and `tallyVm` — a quorum-progress card
  (writers/stake per outcome vs the dual-⅔ thresholds + who attested what),
  reading the resolver's own `tallyBreakdown` (refactored out of `quorumOutcome`
  so the card can never claim a quorum the rule wouldn't grant). VM/oracle tests
  cover the whale-only and sock-puppet-only shortfalls.
- **Polish (U9):** team-flag emoji on fixture buttons, an odds-bar CSS
  transition, and a one-shot celebration on a completed settle.
- **Build note:** the jsdom test path needs Node's `require(esm)` (Node
  ≥20.19 / ≥22.12 / ≥24) — pinned via `.nvmrc` (22, matching CI) and `engines`.
  Every new peer-string surface goes through the S11 escaping discipline
  (hostile-input jsdom tests added for each).

## S14 — feature wiring — DONE
Gate: every catalogue market kind openable from the UI; leaderboard read from
the view — **PASSED** (237 tests). Closes audit findings F1–F8. Plan:
[plans/s14-features.md](./plans/s14-features.md). No protocol change — this
sprint only signs existing message shapes from new UI entry points and reads
existing view rows into new view-models.
- **Market picker (F1):** `marketPickerVm(fixture)` returns every catalogue kind
  as a tappable option carrying the exact factory `{kind, params}` — Result,
  both total-goals lines (O/U 2.5 & 3.5), first scorer over the bundled danger
  men, and the 16-outcome correct-score grid. Cutoff comes from the fixture
  kickoff, not a hardcoded +90min. A VM test pins the specs to the factories
  (no drift); with the micro-round planner below, all five `MarketKind`s are
  openable.
- **Micro-rounds (F2):** `planMicroRounds(fixtureId, rounds, now)` is the pure
  "what should exist / be locked at time t" planner over
  `scheduleMicroRounds` — a market appears one round-length before its cutoff
  and locks when its window opens. The opener-side ticker diffs the plan against
  the view and emits only the missing `market`/`lock` messages; deterministic
  ids (`m-<fixtureId>-r<round>`) + first-market-wins make re-emits and two
  openers racing idempotent. Open rounds float to the top of the market list
  (`terraceVm` grouping) so the terrace never has dead air.
- **Tappable suggestions (F3):** each `suggestMarkets` hunch renders as a button
  that opens that exact market spec (top 2), not inert reason text.
- **Leaderboard (F4):** `leaderboardVm` folds every resolved market's realized
  P&L per bettor straight off the canonical `computePayouts` (same engine settle
  runs — no parallel payout logic) and `resolveMarket` (same rule the market
  screen uses), sorted by net with registered names. Tested against a
  three-market script; the board conserves to zero at feeBps 0.
- **Escrow panel (F5):** read-only `escrowVm` surfaces the two trust tiers —
  Tier 1 (Mates) active, Tier 2 the deterministic `electStewards` 2-of-3
  election (opener + top stakers) over the terrace's stakers. No money-flow
  change; links TRUST.md.
- **Recent terraces (F6):** `recentTerracesVm` + a `curva.terraces` localStorage
  list give the home screen one-tap rejoin (dedup by key, most-recent-first);
  the durable storage dirs from S11 make a host rejoin land on the same terrace.
- **Gaffer LLM (F7):** a "load model" button lazily attempts `QvacLlm.load`,
  with visible loading/failure states, and falls back to `fallbackQuip` — the
  🎩 (template) vs 🎩⚡ (live model) glyph is derived from which path actually
  spoke, so it never lies. `gafferPoolVm` gives the app one read both paths take.
- **Fixture bundle (F8):** the full 16-fixture knockout bracket (R16 → QF → SF →
  3rd place → Final) with staggered kickoffs, three danger men per team, and a
  `STATS_BUNDLE` row for every team so a hunch fires on any tie. The original
  `fra-bra`/`arg-eng` ids and the demo transcript are unchanged.
- **Escaping discipline:** the two new peer-string surfaces (leaderboard rows,
  steward names) go through `leaderboardHtml`/`escrowHtml` with hostile-input
  jsdom tests; all new buttons are single-flight via `busy()`.

## S15 — Pairing friction + zero-install browser demo (U8, T6) ✅

- **Copy + QR (U8):** 📋 copy buttons (clipboard API, inline ✓ feedback) on the
  invite and writer keys, plus a "Show invite QR" card. The QR encoder is the
  MIT `qrcode-generator`, **vendored** under `apps/terrace/vendor/qr.js`
  (offline, attributed); a jsdom suite proves the vendored copy is
  byte-identical to the npm original and that the SVG encodes the exact key.
- **One-tap pairing (U8):** a `curva/pair` protomux channel rides the existing
  replication stream (never the log). The joiner sends a **signed**
  `{t:"pair", writerKey, name}` request (same canonicalization as every log
  message); `validatePairRequest` (structural caps + the signature must
  recover to `author`; unit-tested against forged/tampered/hostile payloads)
  gates what the opener ever sees, and "Approve *name*?" one-taps the existing
  `addWriter`. Paste-a-key stays as the fallback; BlindPairing proper remains
  roadmap.
- **MemoryTerraceNode (T6):** the full TerraceNode surface over `MemoryKV` +
  the same `applyMessage` fold — no Autobase/Hyperswarm/disk. Digest-proven
  equal to `foldMessages` on the same script; `version()` moves per append
  (dropped messages included, like the device); scriptable peer presence.
- **Browser demo (T6):** `web/demo/` — a static page that imports the REAL
  `apps/terrace/app.js` (a `globalThis.CURVA_RUNTIME` injection point swaps
  `TerraceNode.open` for `MemoryTerraceNode.open` — ~10 lines in app.js).
  Three scripted co-fans (own identities, own FakeWallets, every action a
  signed message through the fold) bet, chat in three languages, attest the
  pool-leading outcome after the whistle, and pay their settlement debts.
  esbuild bundles the TS sources (`conditions: ["development"]`) into a
  committed `bundle.js` the git-only Vercel deploy serves as-is; a 20s
  dispute window (runtime-injected) lets a judge watch provisional → resolved
  in one sitting. Banner: "BROWSER DEMO — in-memory swarm + FakeWallet funds".
  Landing hero + closing band link it; CI builds the bundle as an artifact.
  Verified end-to-end in a real browser: open terrace → 3 bots join → custom
  market → bets both sides → lock → 4/4 attest quorum → 20s window → resolved
  → "You're up 6.47 ✓" → bots' receipts land unprompted.

## S16 — Trust hardening (T1, T2, T4) ✅

- **Verified receipts (T1):** `ReceiptVerifier` port in wdk-vault:
  `FakeVerifier` (ledger-backed double), `RpcVerifier`
  (`eth_getTransactionReceipt` + exact ERC-20 Transfer log decode against
  from/to/amount on the disclosed USDt contract; injectable fetch;
  canned-receipt tests, no live RPC in CI), the pure `squareStatus` fold
  (unpaid/claimed/verified/mismatch per manifest line) and `squareSummary`.
  App: the receipts line upgrades ✓ → ✓✓ in real mode only (`REAL_MODE`
  config); RPC-down/unmined degrade to "claimed", **never** a false
  "verified". Demo behavior bit-identical.
- **Events-count dispute window (T2):** `resolveMarket` gains
  `disputeWindow: {kind:"wallclock",ms} | {kind:"events",count}` — events mode
  finalizes after N further linearized attestation events with no
  counter-quorum, so author clocks can no longer rush or stall finalization; a
  batch straddling the window boundary ties toward the refund. Wallclock
  byte-identity is pinned by a 500-run fast-check regression property.
  Events-mode provisionals carry `finalizesAt: null` + `eventsRemaining`; the
  market VM labels them "finalizes after N more attestation(s)". TRUST.md
  documents when to use which.
- **Sealed vault (T4):** `sealVault`/`openVault`/`isSealedVault` in wdk-vault —
  scrypt (2^15, ~100 ms) + XChaCha20-Poly1305 (both noble), versioned blob
  `v1:scrypt:xchacha:<logN>:<salt>:<nonce>:<ct>`. Wrong passphrase and
  tampered blobs fail closed; fresh salt+nonce per seal; empty passphrase
  rejected. App: a Vault card (plaintext demo seed stays the labelled
  default; "Seal vault" opts in; sealed offers "Change" re-seal) and a launch
  unlock gate before any seed derivation.

---
**Totals:** 11 packages + app, 296 tests (property + fuzz + e2e + jsdom),
`npm run check` + `npm run build` + `npm run demo` + `npm run build:demo` all
green. Remaining human-only items are listed in [SUBMISSION.md](./SUBMISSION.md).
