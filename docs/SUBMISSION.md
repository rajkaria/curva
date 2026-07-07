# Submission & Judge-Loop Self-Review

## Judging criteria (1–5) — honest self-scores

| Criterion | Score | Why |
|---|---|---|
| **Technical ambition** | 5 | A multi-writer deterministic market protocol; parimutuel-as-CRDT with *fuzz-proven* convergence; on-device crowd oracle with a proven quorum-safety property; a shipped 2-of-3 escrow with a threshold-custody roadmap. Not a feature list — a CS thesis with tests. |
| **Real use of tracks** | 5 | Each of Pears/QVAC/WDK is structurally load-bearing — remove any one and the product ceases to exist (README table). No checkbox integrations. |
| **Creativity** | 5 | "The market *is* the crowd"; the kill-the-host demo; ambient-audio oracle; federated terraces (swarms of swarms). |
| **Real-world use** | 4 | Digitizes behavior that happens at every pub table; works where bookmakers are geo-blocked; USDt is the currency this crowd already holds. −1: needs the mates-trust framing to be honest about collusion. |
| **User experience** | 3→4 | 3 taps from invite to first bet; live odds; one-tap attest; one-tap settle; native-language chat. Held at 3 until the Pear app is exercised on real devices (see gaps); the headless demo shows the full flow today. |

**Weakest link = UX-on-device.** It is gated on human-only actions (below), not on
missing code. Everything the code can prove, it proves.

## What is proven in CI today

- 217 tests: property (conservation, commutativity/CRDT), fuzz (100 adversarial
  swarm runs), quorum safety, netting soundness, view-model + jsdom-escaping
  suites for the whole render layer, and a full headless e2e.
- `npm run check` (typecheck + lint + test) · `npm run build` · `npm run demo`
  (the whole pipeline, no external services) — all green, all in CI.

## Honest gaps / stated limitations

- **Live-device pairing** uses paste-a-key (spec-sanctioned demo fallback);
  BlindPairing is the frictionless roadmap.
- **Real WDK/QVAC paths** (`WdkWallet`, `QvacAsr`, `QvacLlm`) are wired against the
  verified SDK surfaces and lazy-loaded, but the CI/demo path uses `FakeWallet` +
  `FakeAsr`, labelled by a persistent in-UI demo banner (shown iff the fakes are
  active) and in the README. Swapping adapters is a config change, no protocol
  change.
- **Collusion** in a small pool can steal in Mates Mode — stated, and tiered up by
  escrow ([TRUST.md](TRUST.md)).

## Submission checklist

- [x] Public repo, MIT, public from first commit
- [x] README: thesis → run steps (`npm i && npm run demo`) → tracks table → prior-work → limitations
- [x] VISION.md linked from README
- [x] External services disclosed (chain RPC only; no cloud AI, no backend)
- [x] CI green: typecheck + lint + 217 tests + build + e2e smoke
- [x] Prior-work declared (ported Hunch kernel ~5%, everything else in-event)
- [ ] **Registered on DoraHacks, all three tracks selected** — human-only
- [ ] **≤3-min unlisted YouTube demo** recorded from the script in [DEMO.md](DEMO.md) — human-only
- [ ] **Funded testnet wallet** (faucet USDt + gas) to show a real settlement txid in the video — human-only
- [ ] **Confirm the GitHub repo is public** and push the branch to `main` — human-only
- [ ] **Nation pick** for the team (🏴󠁧󠁢󠁥󠁮󠁧󠁿 or 🇮🇳) — human-only

## Run it (judges)

```bash
npm install
npm run demo     # the whole thesis, headless, one command, no network
npm run check    # 217 tests (Node ≥20.19/22.12/24 — see .nvmrc)
npm run build && pear run apps/terrace   # the live app (needs the Pear runtime)
```
