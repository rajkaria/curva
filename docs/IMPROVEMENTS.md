# TIFO — Post-Audit Improvement Roadmap (S11–S16)

Source: full product audit of 2026-07-07 (UI/UX, features, tech, optimizations).
Every finding below maps to exactly one sprint — nothing is unassigned.
Plans live in [docs/plans/](plans/); sprint log in [SPRINTS.md](SPRINTS.md).

## Traceability — audit finding → sprint

| # | Finding | Sprint |
|---|---|---|
| B1 | HTML/XSS injection: peer-controlled strings (market title, outcome keys) interpolated raw into DOM; fold never validates outcome items are strings | **S11** |
| B2 | 1s polling re-render wipes in-progress input; async `render()` is re-entrant (duplicate/misordered cards) | **S12** |
| B3 | No busy-guard on Bet/Settle buttons (double-click = double spend); stake 0/NaN accepted silently | **S11** |
| B4 | `storageRoot` includes `Date.now()` → new Corestore + new writer key every launch; host must re-authorize after each restart; disk leak | **S11** |
| B5 | Runtime `seq` is a per-process counter (`this.seq++`) — resets on restart, diverges on Autobase truncate/re-apply → non-deterministic view keys on device | **S11** |
| B6 | `emit()` has no writability guard or error surface — read-only joiner chat send = unhandled rejection | **S11** |
| U1 | Demo-mode (FakeWallet/FakeAsr) is **not** labelled in-UI despite SUBMISSION.md claiming it is | **S13** |
| U2 | No peer-count / connection indicator (the kill-the-host demo is invisible) | **S13** |
| U3 | No wallet balance, no per-market position, no payout preview, no P&L after settle | **S13** |
| U4 | Chat shows pubkey hex instead of registered names; header shows hardcoded "you"; no display-name picker | **S13** |
| U5 | No cutoff countdown, no dispute-window/finalize countdown | **S13** |
| U6 | Chat: no Enter-to-send, no autoscroll, `lang` hardcoded `"en"` both ways — the 32-nations translate surface is dead code in-app | **S13** |
| U7 | "Attest manually" toast with no manual attest control; attestation tally (who voted what, quorum progress) invisible | **S13** |
| U8 | Pairing friction: no copy buttons, no QR, host pastes writer keys by hand | **S15** |
| U9 | Polish stretch: team emoji, odds-shift animation, win celebration | **S13** (stretch) |
| F1 | Only match-result markets reachable; catalogue's total-goals ladder / first-scorer / correct-score untapped | **S14** |
| F2 | Micro-round scheduler ("the live-demo killer") not wired into the app | **S14** |
| F3 | Hunch suggestions render as inert text, not tappable open-market actions | **S14** |
| F4 | No PnL leaderboard (all data already in the view; VISION centerpiece) | **S14** |
| F5 | Steward escrow (S9) has zero UI surface | **S14** |
| F6 | No recent-terraces list / rejoin persistence | **S14** |
| F7 | Gaffer never attempts the lazy QVAC LLM path (fallback only) | **S14** |
| F8 | Only 2 bundled fixtures; bundle the full knockout bracket | **S14** |
| T1 | Receipts are self-reported txids — no on-chain verification in real mode | **S16** |
| T2 | Dispute window + fence grace trust author wall-clock; linearization-index window as hardening option | **S16** |
| T3 | `marketId`/bet nonce derived from `Date.now()` only — same-ms collisions across peers | **S11** |
| T4 | Mnemonic stored plaintext in localStorage — passphrase encryption at rest | **S16** |
| T5 | `app.js` is the only untested surface (where all the bugs were): extract render layer, test with MemoryKV + jsdom; lint `apps/` | **S12** |
| T6 | Browser demo mode — full UI as a static page, no Pear install, judge-clickable | **S15** |
| P1 | Event-driven render off Autobase update (kill the 1s full-Hyperbee rescan) | **S12** |
| P2 | Cache `readIdentities`; `renderMarket` reads markets twice per pass | **S12** |
| P3 | Skip re-render while an input has focus | **S12** |

## Sprints

| Sprint | Theme | Plan | Gate |
|---|---|---|---|
| **S11** | Correctness & security hardening (B1, B3–B6, T3 + fold validation) | [plans/s11-hardening.md](plans/s11-hardening.md) | fold-validation + seq-determinism tests green; `npm run check`/`build`/`demo` green |
| **S12** | Render architecture + render tests (B2, T5, P1–P3) | [plans/s12-render.md](plans/s12-render.md) | view-model suite green in CI; zero input-wipe by construction |
| **S13** | UX quick wins (U1–U7, U9) | [plans/s13-ux.md](plans/s13-ux.md) | demo banner + peer count + money surfaces render from view-models under test |
| **S14** | Feature wiring (F1–F8) | [plans/s14-features.md](plans/s14-features.md) | every catalogue market kind openable; leaderboard from view |
| **S15** | Pairing & zero-install demo (U8, T6) | [plans/s15-pairing-demo.md](plans/s15-pairing-demo.md) | auto-approve handshake; static browser demo builds |
| **S16** | Trust hardening (T1, T2, T4) | [plans/s16-trust.md](plans/s16-trust.md) | receipt verify + encrypted seed + index-window all opt-in, tested |

Execution order is S11 → S16. S12 depends on S11's app.js shape; S13–S15 build on
S12's view-model layer; S16 is independent of S13–S15.
