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
## S2 — terrace-base protocol — TODO
## S3 — swarm fuzzer — TODO
## S4 — Pear app — TODO
## S5 — wdk-vault settlement — TODO
## S6 — crowd oracle — TODO
## S7 — QVAC surfaces — TODO
## S8 — market catalogue — TODO
## S9 — steward escrow — TODO
## S10 — ship — TODO
