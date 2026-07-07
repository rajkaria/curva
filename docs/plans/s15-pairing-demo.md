# S15 — Pairing Friction + Zero-Install Browser Demo

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** U8 + T6. Kill the paste-hex pairing pain (copy buttons → QR →
auto-approve handshake) and ship a browser demo mode: the full UI running as a
static page over an in-memory node — a judge clicks a link, no Pear install.

**Architecture:**
- *Copy/QR:* clipboard buttons on invite/writer keys; QR rendered by a tiny
  vendored pure-JS QR encoder (no network, MIT, checked in under
  `apps/terrace/vendor/`).
- *Auto-approve handshake:* the joiner already opens a Hyperswarm connection to
  the opener. Add a `tifo-pair` protocol message on the replication stream
  (userData channel): joiner sends `{writerKey, name, sig}` signed by its
  identity key; opener UI shows "Approve fan-a3f2?" → one tap calls the existing
  `addWriter`. Falls back to paste-a-key. (BlindPairing proper remains roadmap —
  this stays within the spec-sanctioned flow but removes the hex hand-copy.)
- *Browser demo (T6):* `MemoryTerraceNode` in terrace-base implementing the
  TerraceNode surface (`view/append/update/writable/key/peerCount`) over
  `MemoryKV` + `foldMessages`, plus a scripted co-fan bot (bets, attests, chats
  on a timer) so the single-browser demo shows a *live* terrace. `apps/web/`
  bundles app.js + packages with esbuild to `dist-web/` publishable on GitHub
  Pages. Demo banner reads "BROWSER DEMO — in-memory swarm".

**Working dir:** repo root · **Branch:** `claude/silly-goldwasser-60969e`

## File structure

| File | Change |
|---|---|
| `packages/terrace-base/src/memory-runtime.ts` | Created — MemoryTerraceNode |
| `packages/terrace-base/test/memory-runtime.test.ts` | Created |
| `packages/terrace-base/src/autobase-runtime.ts` | Modified — pairing channel |
| `apps/terrace/app.js` | Modified — copy/QR/approve UI; runtime injection point |
| `apps/terrace/vendor/qr.js` | Created (vendored, attributed) |
| `apps/web/` (`index.html`, `demo-bot.js`, `build.mjs`) | Created |
| `package.json` | Modified — `demo:web` script; esbuild devDep |
| `.github/workflows/ci.yml` | Modified — build web demo artifact |
| `docs/SPRINTS.md`, `docs/context/tifo-build.md`, `README.md` | Modified — demo link |

## Tasks

### T1 — Copy + QR (small, ship first)
- [ ] Copy buttons (clipboard API, ✓ feedback). QR card for the invite key;
  jsdom test that the QR svg encodes the exact key string.

### T2 — Auto-approve handshake
- [ ] terrace-base: pairing message over the replication stream's userData/
  extension channel; opener surfaces pending requests via
  `onPairRequest(cb)`; joiner sends on connect until writable.
- [ ] Signature check: request must verify against the joiner's idKey (reuse
  `verifyMessage` canonicalization on a `{t:"pair", …}` shape). Unit-test the
  pure request-validation function.
- [ ] app.js: pending-request card with Approve/Ignore; approval calls
  `addWriter` (existing, already first-wins-safe).

### T3 — MemoryTerraceNode (TDD)
- [ ] Test: same scripted message set through MemoryTerraceNode and
  `foldMessages` → identical `viewDigest`; `writable()` true; `version()`
  increments per append.
- [ ] Impl: in-memory node + injected-clock-friendly design (the demo bot uses
  `setTimeout`, the tests use manual pumps).

### T4 — apps/web build + demo bot
- [ ] esbuild bundle (dev condition → TS sources compile via esbuild); bot
  script: join, hello, bet spread, lock at T+60s, attest, settle — a full
  narrative loop in-browser.
- [ ] `npm run demo:web` → serves `dist-web/`; CI builds the bundle (artifact).
- [ ] README "Try it in the browser" link + honesty note (in-memory swarm, not
  Hyperswarm — the wire path is the Pear app).

### T5 — Gates + docs
- [ ] `npm run check`/`build`/`demo`; SPRINTS.md; context doc; commit.

## Self-review checklist
- [ ] Pairing requests are signature-verified before being shown for approval.
- [ ] QR/vendored code is attributed, offline, and license-compatible (MIT).
- [ ] Browser demo clearly labels itself as in-memory; no claim inflation.
- [ ] MemoryTerraceNode digest-matches the fold — the browser demo runs the
  real protocol, only the transport is faked.
