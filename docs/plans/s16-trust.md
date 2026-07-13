# S16 — Trust Hardening (post-hackathon tier)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [x]`) syntax for tracking.

**Goal:** T1 (verify receipts on-chain in real mode), T2 (linearization-index
dispute window — remove the last wall-clock trust), T4 (mnemonic encrypted at
rest). All opt-in, all tested, none changing demo-mode behavior.

**Architecture:**
- *T1 Receipt verification:* new `ReceiptVerifier` port in wdk-vault —
  `verify(txid, from, to, amount) → confirmed | pending | mismatch` — with
  `FakeVerifier` (test/demo) and `RpcVerifier` (real mode: fetch tx receipt +
  ERC-20 Transfer log decode over the disclosed RPC). The "everyone's square"
  checklist upgrades a line from ✓(claimed) to ✓✓(verified) as confirmations
  land. Verification is a read-side concern — no protocol change.
- *T2 Index window:* `resolveMarket` gains an optional
  `disputeWindow: {kind: "wallclock", ms} | {kind: "events", count}` — the
  events mode finalizes after N further linearized attestation events with no
  counter-quorum, removing author-clock trust. Default stays wallclock (mates
  mode); TRUST.md documents the adversarial-mode recommendation.
- *T4 Seed at rest:* `sealVault(mnemonic, passphrase)` /
  `openVault(sealed, passphrase)` in wdk-vault using scrypt (noble-hashes) +
  xchacha20-poly1305 (noble-ciphers). App: optional passphrase at first launch;
  unencrypted remains the default demo path (labelled "demo seed — unencrypted").

**Working dir:** repo root · **Branch:** `claude/silly-goldwasser-60969e`

## File structure

| File | Change |
|---|---|
| `packages/wdk-vault/src/verify.ts` | Created — ReceiptVerifier port + Fake + Rpc impls |
| `packages/wdk-vault/src/seal.ts` | Created — sealVault/openVault |
| `packages/wdk-vault/test/verify.test.ts`, `test/seal.test.ts` | Created |
| `packages/crowd-oracle/src/quorum.ts` | Modified — dispute window kinds |
| `packages/crowd-oracle/test/quorum.test.ts` | Modified — events-window suite |
| `apps/terrace/app.js` | Modified — ✓✓ receipts, passphrase gate |
| `package.json` | Modified — @noble/ciphers dep |
| `docs/TRUST.md`, `docs/SPRINTS.md`, `docs/context/curva-build.md` | Modified |

## Tasks

### T1 — Receipt verification
- [x] TDD FakeVerifier semantics (confirmed/pending/mismatch) + the
  square-checklist upgrade logic as a pure function
  (`squareStatus(receipts, verdicts)`).
- [x] RpcVerifier: `eth_getTransactionReceipt` + Transfer(address,address,uint256)
  log decode against expected from/to/amount; retries/pending handling;
  integration-style test against a canned receipt JSON fixture (no live RPC in CI).
- [x] App: verified ticks in the receipts card (real mode only).

### T2 — Events-count dispute window
- [x] Tests: counter-quorum within N events voids; quiet N events finalizes;
  wallclock mode behavior byte-identical to today (regression).
- [x] Impl in `resolveMarket` (pure); TRUST.md gains a "hardened window" section.

### T3 — Sealed vault
- [x] TDD: seal→open round-trip; wrong passphrase fails closed; sealed blob is
  versioned (`v1:scrypt:xchacha`) for future migration; scrypt params chosen
  for ~100ms on desktop.
- [x] App: optional passphrase on first launch; "change passphrase" re-seal;
  demo default stays plaintext with an explicit label.

### T4 — Gates + docs
- [x] `npm run check`/`build`/`demo`; SPRINTS.md; context doc; commit.

## Self-review checklist
- [x] Demo-mode behavior is bit-identical unless features are opted into.
- [x] Wallclock dispute window regression suite proves no resolution changes.
- [x] No secret material ever logged or rendered; sealed blob replaces the
  plaintext localStorage key when a passphrase is set.
- [x] RpcVerifier failure modes (RPC down, pending tx) degrade to "claimed",
  never to a false "verified".
