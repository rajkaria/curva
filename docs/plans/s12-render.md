# S12 — Render Architecture + Render Tests

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the input-wipe/re-entrant render bug (B2), make the app's render
layer CI-testable (T5), and remove the 1s full-Hyperbee rescan (P1–P3). After
this sprint `app.js` is a thin DOM shell over a tested view-model package.

**Architecture:** New package `packages/terrace-ui` — pure **view-model**
functions: `(kv, uiState) → plain data` (no DOM, no Pear). Examples:
`terraceVm(kv, state)` → `{ invite, writerKey, role, markets[], chat[] }`;
`marketVm(kv, state, marketId)` → `{ title, pills[], outcomes[{key, gross, odds,
pct, cls}], resolution, receipts, canBet, canLock, canSettle }`. Everything the
DOM shows comes from a VM; VMs are tested against `MemoryKV` + `foldMessages`
fixtures — including "hostile title stays inert" regression tests for S11's
escaping (assert VM carries raw strings + the DOM layer's `esc` is applied by a
single `renderCard(vm)` helper unit-tested with jsdom).

Render loop becomes event/version-driven:
- Track `node.version()` (`base.view.core.length` or `base.view.version`); the 1s
  tick only calls `render()` when the version changed OR local uiState changed.
- A render mutex (`rendering` flag + trailing re-run) serializes async renders.
- Skip DOM replacement while `document.activeElement` is an `input` inside a
  card that would be replaced; inputs get stable `id`s and values are restored.
- `readIdentities` cached per version; `renderMarket` reads markets once per pass.

**Tech stack:** TS for `terrace-ui`, vitest + jsdom (devDep) for DOM-layer tests,
`eslint packages apps` so app.js is linted from now on.

**Working dir:** repo root · **Branch:** `claude/silly-goldwasser-60969e`

## File structure

| File | Change |
|---|---|
| `packages/terrace-ui/package.json`, `tsconfig.json` | Created |
| `packages/terrace-ui/src/vm.ts` | Created — terraceVm/marketVm/chatVm |
| `packages/terrace-ui/src/format.ts` | Created — usdt(), countdown(), shortKey() |
| `packages/terrace-ui/test/vm.test.ts` | Created — VM suite over MemoryKV fixtures |
| `packages/terrace-ui/test/dom.test.ts` | Created — jsdom renderCard/esc regression |
| `apps/terrace/app.js` | Modified — consume VMs; versioned render loop |
| `package.json` | Modified — lint scope `packages apps`; jsdom devDep |
| `tsconfig.build.json`, `docs/SPRINTS.md`, `docs/context/tifo-build.md` | Modified |

## Task graph

```
T1 terrace-ui scaffold ─→ T2 VM tests → impl ─→ T3 app.js consumes VMs
                                             └─→ T4 versioned render loop ─→ T5 gates
```

## Tasks

### T1 — Scaffold `@tifo/terrace-ui`
- [ ] Package with dual export conditions matching sibling packages; depends on
  `@tifo/terrace-base`, `@tifo/market-kernel`, `@tifo/crowd-oracle`.

### T2 — View-models (TDD)
- [ ] Tests first: fold a scripted message set (2 writers, 1 market, 3 bets,
  lock, attests) with `foldMessages`, assert `marketVm` yields exact odds
  strings, pool totals, `canBet=false` after lock, resolution status, receipt
  count; `terraceVm` yields market list + chat with registered names.
- [ ] `format.ts`: `usdt(micros) → "10.00"`, `countdown(ms) → "12:04"`,
  `shortKey(hex)` — property-test `usdt` round-trips exact micros.
- [ ] Hostile-input regression: title `"<img onerror=x>"` flows through VM as
  data; jsdom test proves `renderCard` never parses it as markup.

### T3 — app.js consumes VMs
- [ ] Replace inline read+compute in `renderTerrace`/`renderMarket`/`renderChat`
  with VM calls; DOM building isolated in small `renderCard`-style helpers.

### T4 — Versioned, serialized, focus-safe render loop
- [ ] `let viewVersion = -1;` tick: `await node.update(); const v = node.version();
  if (v === viewVersion && !stateDirty) return; viewVersion = v; scheduleRender();`
- [ ] `scheduleRender()` = mutex + trailing flag (never two renders interleaved).
- [ ] Focus guard: if an input inside `#app` is focused, defer DOM swap until
  blur or submit (max 1 deferred render queued).
- [ ] `TerraceNode.version()` added in terrace-base (thin accessor over the view
  core length; unit-test the MemoryKV analogue).

### T5 — Gates + docs
- [ ] `eslint packages apps` green (fix fallout), full `npm run check`, `build`,
  `demo`; SPRINTS.md + context doc; commit.

## Self-review checklist
- [ ] No `readMarkets`/`readChat`/`readIdentities` calls remain in app.js outside VMs.
- [ ] Typing in chat/stake inputs survives 60s of background updates (manual + focus-guard unit test).
- [ ] Render work is zero when the view version is unchanged.
- [ ] VM suite runs in CI with no Pear/Autobase dependency.
