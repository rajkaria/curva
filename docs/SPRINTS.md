# TIFO — Sprint Log

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
`@tifo/sim` Lamport-ordered swarm, and the `TerraceNode` Autobase/Hyperswarm runtime.

## S3 — swarm fuzzer — DONE
Gate: invariants hold under fuzz — **PASSED**. 100 randomized runs (interleavings,
churn, partitions/heals, late bets, double-attests, whales) + targeted attacks →
convergence, no-inflation, conservation, dedup, fence.

## S4 — Pear app — DONE
Gate: full flow works — **PASSED** via the headless e2e (`npm run demo`, also in CI).
`apps/terrace` real Pear app wiring all packages; `@tifo/e2e` narrated end-to-end
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

Roadmap for S12–S16 (render architecture/tests, UX quick wins, feature wiring,
pairing + browser demo, trust hardening): [IMPROVEMENTS.md](./IMPROVEMENTS.md).

---
**Totals:** 10 packages + app, 160 tests (property + fuzz + e2e), `npm run check`
+ `npm run build` + `npm run demo` all green. Remaining human-only items are listed
in [SUBMISSION.md](./SUBMISSION.md).
