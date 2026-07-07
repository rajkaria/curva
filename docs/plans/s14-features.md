# S14 — Feature Wiring (the catalogue was already built — expose it)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** F1–F8. Every tested-but-invisible feature reaches the UI: all
market-catalogue kinds, the micro-round scheduler, tappable suggestions, a PnL
leaderboard, an escrow status panel, recent-terraces persistence, the lazy
Gaffer LLM path, and a full knockout-bracket fixture bundle.

**Architecture:** No protocol changes — this sprint only *signs existing
message shapes* from new UI entry points and reads existing view rows into new
VMs. The micro-round scheduler runs client-side on the opener: a `tick` checks
`nextOpenRound`/`liveRound` and emits the next `goal-in-window` market +
locks the expired one (idempotent by deterministic marketId
`m-<fixtureId>-r<round>` — first-wins in the fold makes double-opens harmless).

**Working dir:** repo root · **Branch:** `claude/silly-goldwasser-60969e`

## File structure

| File | Change |
|---|---|
| `packages/terrace-ui/src/vm.ts` | Modified — leaderboardVm, escrowVm, marketPickerVm |
| `packages/terrace-ui/test/vm.test.ts` | Modified |
| `apps/terrace/app.js` | Modified — picker, rounds ticker, leaderboard/escrow cards, recents, LLM toggle |
| `fixtures/wc2026.js` | Modified — 16-fixture knockout bracket + per-team stats |
| `docs/SPRINTS.md`, `docs/context/tifo-build.md` | Modified |

## Tasks

### T1 — Market-type picker (F1)
- [ ] Per-fixture "Open market ▾" menu: Result / Total-goals ladder (2.5 & 3.5)
  / First scorer (bundled squads) / Correct score (3×3 grid → 16 outcomes incl.
  NONE-cap awareness). Each calls the existing factory and emits; cutoff from
  fixture kickoff, not a hardcoded +90min.
- [ ] VM test: picker emits exactly the factory `{kind, params}` (no drift).

### T2 — Micro-rounds (F2)
- [ ] Opener-side ticker over `scheduleMicroRounds(kickoff, {roundMs: 10min,
  count: 9})`: auto-open next round's market at its cutoff−lead, auto-lock at
  window start. Deterministic marketIds; test the pure "what should exist/lock
  at time t" planner function in terrace-ui.
- [ ] Market list groups live round + next round at top ("Round 4 — goal? closes 2:10").

### T3 — Tappable suggestions (F3)
- [ ] Each `suggestMarkets` suggestion renders as a button that opens that
  exact market spec (not just its reason text); show top 2, not `slice(1,2)`.

### T4 — Leaderboard (F4)
- [ ] `leaderboardVm(kv)`: fold resolved markets → per-bettor realized PnL
  (payouts − stakes, from `computePayouts` per resolved market + receipts) →
  sorted rows with names. Terrace card + test with a 3-market fixture script.

### T5 — Escrow panel (F5)
- [ ] Read-only "Trust tier" card: Tier 1 (mates) active; Tier 2 (2-of-3
  steward escrow) — show the elected stewards for this terrace via
  steward-escrow's election over current identities; link TRUST.md. No money
  flow change.

### T6 — Recent terraces (F6)
- [ ] localStorage `tifo.terraces` (key, name, role, lastSeen); home screen
  lists them with one-tap rejoin (storage dirs from S11 make this durable).

### T7 — Gaffer LLM toggle (F7)
- [ ] "Load Gaffer model" button → lazy `QvacLlm` attempt with visible
  loading/failure states → falls back to `fallbackQuip` (existing behavior)
  and stays honest about which path produced the quip (🎩 vs 🎩⚡).

### T8 — Fixture bundle (F8)
- [ ] Full 16-team knockout bracket (R16→final), kickoffs, squads (3 danger men
  each), stats rows for suggestions. Keep the two current fixtures' ids stable.

### T9 — Gates + docs
- [ ] `npm run check`/`build`/`demo`; SPRINTS.md; context doc; commit.

## Self-review checklist
- [ ] Every market kind in `MarketKind` is openable from the UI.
- [ ] Micro-round automation is idempotent under two openers racing (first-wins).
- [ ] Leaderboard math reuses `computePayouts` — no parallel payout logic.
- [ ] All new strings escaped; all new buttons single-flight (S11 discipline).
