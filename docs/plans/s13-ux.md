# S13 — UX Quick Wins

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close U1–U7 (+U9 stretch): make demo-mode honest and visible, make the
P2P-ness visible (peer count), make the money visible (balance / position /
payout preview / P&L), humanize identity (names), surface time (countdowns),
fix chat ergonomics + activate translation, and complete the attestation UX.
This is the sprint that moves the judge UX score from 3 to 4–5.

**Architecture:** Every new surface is a view-model in `@curva/terrace-ui`
(S12) + a small DOM card in app.js. New local `uiState`: `{ displayName, lang,
peerCount }` persisted to localStorage (name/lang). Peer count from Hyperswarm
`connection`/`close` events exposed as `TerraceNode.peerCount()`.

**Tech stack:** unchanged (TS + vitest for VMs; plain JS DOM shell).

**Working dir:** repo root · **Branch:** `claude/silly-goldwasser-60969e`

## File structure

| File | Change |
|---|---|
| `packages/terrace-ui/src/vm.ts` | Modified — walletVm, positionVm, previewPayout, tallyVm, countdowns |
| `packages/terrace-ui/test/vm.test.ts` | Modified — suites per new VM |
| `packages/terrace-base/src/autobase-runtime.ts` | Modified — `peerCount()` |
| `apps/terrace/app.js`, `apps/terrace/index.html` | Modified — banner, header widgets, cards, name/lang pickers |
| `docs/SPRINTS.md`, `docs/context/curva-build.md`, `docs/SUBMISSION.md` | Modified |

## Tasks

### T1 — Demo-mode banner (U1) — first, it's an honesty fix
- [ ] Persistent header strip: `DEMO MODE — FakeWallet (demo funds) · bundled
  transcript ASR`; shown whenever the active adapters are fakes. Update
  SUBMISSION.md wording once true in-UI.

### T2 — Peer presence (U2)
- [ ] `TerraceNode.peerCount()` (+ swarm event wiring); header pill `⇄ 3 peers`;
  VM test with a fake swarm emitter. Pill turns amber at 0 peers.

### T3 — Money surfaces (U3)
- [ ] `walletVm(wallet)` → balance string in header (updates after settle).
- [ ] `positionVm(kv, marketId, me)` → your stake per outcome + total at risk,
  shown on the market screen ("You: 10 USDt on HOME").
- [ ] `previewPayout(pools, feeBps, outcomeKey, stake)` (pure, over
  market-kernel) → "Returns ~23.40 if HOME" live under the stake input.
  Property test: preview equals `computePayouts` result for that bet added.
- [ ] Post-settle P&L line: `payout − stake` per bettor from the manifest
  ("You're up 13.40 ✓").

### T4 — Names (U4)
- [ ] First-launch name prompt (default `fan-xxxx`), stored + sent in `hello`;
  chat lines and tally show registered names via identities map; header shows
  your name. Fold already stores `name` — VM maps idKey → name with hex fallback.

### T5 — Countdowns (U5)
- [ ] Market card: `closes in 12:04` (cutoffAt) / `LOCKED`; resolution card:
  `finalizes in 9:31` (finalizesAt from resolveMarket). `countdown()` from S12.
  Re-render tick may run at 1s but only touches countdown text nodes (no full swap).

### T6 — Chat ergonomics + translation (U6)
- [ ] Enter-to-send; autoscroll to newest line (unless user scrolled up).
- [ ] Language picker (persisted `uiState.lang`, e.g. en/es/pt/fr/it/de/ar/hi);
  `sendChat` stamps it; `renderForViewer(line, uiState.lang, translator)` now
  actually translates cross-language lines (FakeTranslator labels visibly in
  demo mode; QvacTranslator slot documented for real mode).

### T7 — Attestation UX (U7)
- [ ] Manual attest: outcome buttons behind an "Attest manually" disclosure —
  emits the same signed `attest` message as the ASR path.
- [ ] `tallyVm(kv, marketId, stakes)` → per-outcome writers/stake vs the dual-⅔
  thresholds ("2/3 writers · 71% stake on HOME") + who attested what; rendered
  as a quorum progress card. VM tests cover whale-only and sock-puppet-only
  shortfalls (mirrors quorum safety story).

### T8 — Stretch polish (U9, only if T1–T7 land)
- [ ] Team emoji on fixture buttons; odds-bar CSS transition; one-shot ✓
  celebration on "everyone's square".

### T9 — Gates + docs
- [ ] `npm run check`/`build`/`demo`; SPRINTS.md; context doc; commit.

## Self-review checklist
- [ ] A first-time viewer can tell within 5s: demo mode, peers connected, their
  balance, and what closes when.
- [ ] Every new string surface goes through the S11 escaping discipline.
- [ ] All money math shown in-UI comes from market-kernel functions, never
  re-derived ad hoc.
- [ ] SUBMISSION.md's "labelled in-UI" claim is now literally true.
