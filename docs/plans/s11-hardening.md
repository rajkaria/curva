# S11 — Correctness & Security Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every P0 correctness/security finding from the 2026-07-07 audit:
peer-string XSS (B1), double-spend clicks + silent invalid stakes (B3), per-launch
storage churn (B4), non-deterministic runtime seq (B5), unguarded emits (B6),
same-ms id collisions (T3) — plus message-field validation in the fold so hostile
payloads die at the protocol layer, not the DOM.

**Architecture:** Two layers change. (1) `terrace-base`: `applyMessage` drops its
caller-supplied `seq` parameter and derives it from a persisted `meta!seq` view row
(deterministic across restarts/reorgs because it rolls back with the bee); the
`market`/`hello`/`chat`/`attest`/`receipt` branches gain strict field validation.
(2) `apps/terrace/app.js`: an `esc()` + safe-class discipline for every
peer-derived string, a `busy()` wrapper for async buttons, writability/error
guards in `emit()`, author-suffixed ids, and stable per-terrace storage dirs.

**Tech stack:** TypeScript (strict) for packages, vitest + fast-check for tests,
plain ESM JS for the Pear app. No new dependencies.

**Working dir:** repo root · **Branch:** `claude/silly-goldwasser-60969e`

## File structure

| File | Change |
|---|---|
| `packages/terrace-base/src/apply.ts` | Modified — seq from `meta!seq`; field validation |
| `packages/terrace-base/src/autobase-runtime.ts` | Modified — drop `this.seq`, call `applyMessage(kv, v)` |
| `packages/terrace-base/test/apply.test.ts` | Modified — new signature; validation + restart-resume tests |
| `packages/crowd-oracle/test/integration.test.ts` | Modified — new `applyMessage` signature if used |
| `apps/terrace/app.js` | Modified — esc/busy/guards/ids/storage |
| `docs/SPRINTS.md` | Modified — S11 entry |
| `docs/context/tifo-build.md` | Modified — state refresh |

## Task graph

```
T1 seq-from-view (test → impl) ──┐
T2 fold validation (test → impl) ─┼─→ T4 app.js hardening ─→ T5 gates + docs
T3 runtime adapter update ────────┘
```

## Tasks

### T1 — Deterministic seq from the view
- [ ] Test (`apply.test.ts`): "seq survives a process restart" — apply the first
  k messages to a `MemoryKV` via `applyMessage(kv, msg)` (no counter argument),
  then apply the rest as if by a fresh process; `viewDigest` must equal a
  one-shot `foldMessages(all)` digest. Also: "seq increments for dropped
  messages" (bad-sig message still bumps `meta!seq`, preserving index semantics).
- [ ] Impl: in `applyMessage`, read `Number(await kv.get("meta!seq") ?? 0)` at
  entry, `put("meta!seq", seq + 1)` immediately (before validation, so seq ==
  linearized index exactly as today), remove the `seq` parameter; update
  `foldMessages`.
- [ ] Run terrace-base + sim + e2e suites (sim/e2e exercise the fold heavily —
  they are the convergence regression net).

### T2 — Fold field validation (protocol-layer input hygiene)
- [ ] Tests: market rejected when — `title` not a string; any outcome not a
  string / empty / >64 chars; duplicate outcomes; >256 outcomes; unknown `kind`;
  `meta` value neither string nor number. hello rejected when `name`/`walletAddr`
  not strings or `name` >40 chars. chat rejected when `text` not a string / >2000
  chars or `lang` not a string / >8 chars. bet rejected when `nonce` not a
  non-empty string ≤64. attest rejected when `evidence.confidence` present but
  not a finite 0..1 number, or `asrScore` present but not a string ≤64. receipt
  rejected when `manifestLine` not a non-negative integer or `txid` not a string
  ≤128.
- [ ] Impl: small `isStr(v, max)` helper + per-branch checks in `apply.ts`;
  `KINDS` whitelist matching `MarketKind`.
- [ ] Confirm fuzz suite still green (drops are deterministic → convergence holds).

### T3 — Runtime adapter
- [ ] `autobase-runtime.ts`: delete `private seq = 0`; apply callback calls
  `await applyMessage(kv, v as Msg)`.

### T4 — app.js hardening (surgical; no UX features — that's S13)
- [ ] `esc()` helper; every peer-derived interpolation escaped: market titles
  (list + header), outcome keys (labels, bet buttons), `res.outcomeKey`, gaffer
  quip, suggestion reasons, asrScore toasts.
- [ ] Kill class injection: outcome CSS classes only via a `SAFE_CLASS` allowlist
  (`HOME/AWAY/DRAW/YES/NO/OVER/UNDER`); unknown keys get no class.
- [ ] `busy(btn, fn)` wrapper: disables the button for the duration, try/catch →
  toast the error. Applied to Bet, Settle, Lock, Attest, Authorize, Send, Open, Join.
- [ ] `placeBet`: reject non-finite / ≤0 / >1e9 stakes with an error toast before
  emitting.
- [ ] `emit()`: if `!node?.writable()` → toast "Read-only — ask the host to
  authorize your writer key" and return; wrap append in try/catch → toast.
- [ ] Ids: `marketId()` and bet nonces gain an author suffix
  (`idKey.slice(2,8)`) + monotonic local counter — no same-ms cross-peer collisions.
- [ ] Storage: opener → `<storage>/terrace-host`, joiner →
  `<storage>/terrace-<inviteKey[0..16]>` — stable across launches, writer key
  survives restarts.
- [ ] `node --check apps/terrace/app.js` (the app is outside tsc/eslint until S12).

### T5 — Gates + docs
- [ ] `npm run check` && `npm run build` && `npm run demo` all green.
- [ ] SPRINTS.md S11 entry; context doc state refresh.
- [ ] Commit.

## Self-review checklist
- [ ] No peer-controlled string reaches `innerHTML` unescaped anywhere in app.js.
- [ ] No CSS class is ever built from a peer string outside the allowlist.
- [ ] `applyMessage` has no caller-supplied ordering input; `meta!seq` is the only
  counter and it lives in the view.
- [ ] Seq semantics unchanged (increments per message incl. drops) so existing
  key numbering is stable.
- [ ] Every async button is single-flight; every emit failure is user-visible.
- [ ] Validation rejects are silent drops (deterministic), never throws — a
  hostile message can never crash the fold.
