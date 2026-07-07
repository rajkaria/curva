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
updated: 2026-07-07
---

# TIFO — build context

Serverless P2P football prediction market for the Tether Developers Cup
(Pears + QVAC + WDK). Concept/spec: [BUILD_SPEC.md](../BUILD_SPEC.md) ·
[SCOPE.md](../SCOPE.md). Sprint log: [SPRINTS.md](../SPRINTS.md).
Submission + judge review: [SUBMISSION.md](../SUBMISSION.md).

## Current state — what's working, deployed, broken

- **S0–S11 DONE.** S0–S10 pushed to `main`; S11 (audit hardening) on branch
  `claude/silly-goldwasser-60969e`. Audit roadmap S12–S16 planned in
  [IMPROVEMENTS.md](../IMPROVEMENTS.md) + [docs/plans/](../plans/).
- **160 tests green** (property + fuzz + e2e). Gates all pass:
  `npm run check` (typecheck + lint + test), `npm run build` (→ dist),
  `npm run demo` (full headless pipeline). CI runs all three + e2e smoke.
- npm workspaces, strict TS. Packages under `packages/` (9) + `apps/terrace` (Pear app).
- **Working:** every pure/protocol layer, the swarm sim/fuzzer, the end-to-end
  demo, all docs, dual-condition JS build.
- **Unverified (disclosed):** `apps/terrace/app.js` on-device behavior — needs the
  Pear runtime, not executable in CI. Real WDK/QVAC adapters are wired against the
  verified SDK surfaces but CI/demo use FakeWallet + FakeAsr (labelled).

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

## Next steps — specific, actionable

**Next sprint: S12** (render architecture + render tests —
[plans/s12-render.md](../plans/s12-render.md)), then S13–S16 per
[IMPROVEMENTS.md](../IMPROVEMENTS.md). Note: S13 closes the honesty gap where
SUBMISSION.md claims demo-mode is "labelled in-UI" but no banner exists yet.

Human-only submission items (see SUBMISSION.md):
1. Register on DoraHacks, select all three tracks.
2. Record the ≤3-min YouTube demo (script: [DEMO.md](../DEMO.md)).
3. Fund a testnet wallet (faucet USDt + gas) for a real settlement txid on camera.
4. Confirm the GitHub repo is public.
5. Pick team nation (🏴󠁧󠁢󠁥󠁮󠁧󠁿 or 🇮🇳).

Optional code polish if time: BlindPairing for frictionless invites; exercise the
Pear app on real devices; wire the real WDK/QVAC paths against a funded wallet + a
downloaded model.
