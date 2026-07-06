# TIFO — Scope Doc (Tether Developers Cup)

> The serverless terrace market: a football prediction market that lives entirely among
> the fans watching the match — P2P market state (Pears), on-device crowd oracle (QVAC),
> self-custodial USDt settlement (WDK). No server, no cloud, no custodian.

Full concept + architecture: [BUILD_SPEC.md](./BUILD_SPEC.md). Sprint detail: [SPRINTS.md](./SPRINTS.md).

## Hackathon constraints (hard requirements)

| Constraint | Detail |
|---|---|
| Platform | DoraHacks; registration closed July 6 (must be registered) |
| Cut 1 | **July 8** — submit project + ≤3-min unlisted YouTube demo. Top 16 advance |
| Cut 2 | **July 12** — semifinals, 16 → 4 finalists |
| Final lock | **July 14, 23:59 GMT-7** — building stops |
| Live pitch | July 15–18 (finalists); winners July 19 |
| Repo | Public GitHub, MIT/Apache-2.0, stays public; judges must be able to run it easily |
| Tracks | Pears: ALL networking via Pears stack (no plain WebRTC). QVAC: ALL AI on-device via QVAC SDK (no cloud AI). WDK: self-custodial keys |
| Disclosure | List all outside services/APIs/pre-built parts; declare prior work (judges score only in-event work) |
| Judging | 1–5 on: technical ambition · UX · real-world use · creativity · real use of track(s) |

## Track compliance map

| Track | Requirement | TIFO compliance |
|---|---|---|
| Pears | Pear CLI + pear-runtime, Hyperswarm/Hypercore/Autobase building blocks | App ships via `pear run`; market ledger = Autobase multi-writer log; discovery = Hyperswarm; storage = Corestore/Hyperbee. No other networking exists |
| QVAC | All AI on-device through QVAC SDK | ASR attestation pre-fill, Gaffer commentator, chat translation — all local. AI never in the money path (assist-only, humans sign) |
| WDK | Self-custodial wallet/payment via WDK | One seed → identity signing key + USDt wallet; netted key-to-key settlement; only external service = chain RPC (disclosed) |

## Scope by cut (tiered)

### Cut 1 — July 8 (MUST: working demo of the thesis)
1. **`market-kernel`** — pure parimutuel core ported from Hunch (odds, payouts, fees, single-participant refund, void→full-refund) + property tests (conservation, commutativity)
2. **`terrace-base`** — Autobase apply/view, signed msg protocol (`hello/market/bet/lock/attest/receipt/chat`), cutoff fence, invite flow; sim proves N-peer convergence
3. **Pear app `terrace`** — create/join terrace (QR/`pear://` invite), match-result 3-way market, live pool odds, bet flow, chat
4. **Oracle v1** — manual one-tap attestations, ⅔ stake+writer quorum, dispute window, void→refund
5. **Settlement v1 (Mates Mode)** — payout manifest → min-transfer netting → WDK testnet USDt transfers + receipts in log *(fallback if WDK spike red: manifest + signed IOU receipts, labeled honestly)*
6. Demo video (kill-the-host moment), README, prior-work declaration

### Cut 2 — July 12 (SHOULD: the wow layer)
7. **QVAC crowd oracle** — on-device ASR over commentary clips → score extraction → pre-filled attestations
8. **QVAC surfaces** — the Gaffer (local LLM commentator on live pool state), terrace translate (multilingual chat)
9. **More markets** — goal-in-next-10-min micro-rounds (recurring), total-goals ladder, first scorer
10. **Swarm fuzzer** — adversarial suite (late bets, partitions, writer churn) in CI

### Final — July 14 (COULD)
11. Steward escrow (2-of-3, on-chain USDt deposits verified per-peer)
12. Federated tournament layer (cross-terrace leaderboard via public Hypercores)
13. Stadium LAN mode showcase; polish; VISION.md; judge-loop to 8.5+

## Out of scope (explicit NOs)
- Mainnet/real money — testnet USDt only, `feeBps=0`
- Mobile Pear packaging (roadmap; demo = desktop peers + phone if Pear mobile works)
- FROST/threshold SwarmVault (VISION.md only)
- Correct-score grid, attester rewards (only if time after 12)
- Order books/AMMs (never — parimutuel-as-CRDT is the thesis), cloud AI (never), servers (never)
- Any coupling to the Hunch prod repo — kernel is *ported*, not imported

## Working agreements (carried from Hunch)
- Ports & adapters: `market-kernel`, quorum math, netting are pure TS; Pears/QVAC/WDK behind adapters with in-memory fakes
- Green gate per sprint: `npm run check` (typecheck + lint + test) → commit → push `main`
- Never trust model output into a money path — ASR/LLM pre-fill only, humans sign, quorum decides
- Honest labeling: anything simulated/mocked is marked in-UI and in README

## Sprint index

| Sprint | Deliverable | Gate |
|---|---|---|
| S0 | Day-0 spikes: Autobase / WDK / QVAC go-no-go | spike verdicts logged in SPRINTS.md |
| S1 | `market-kernel` port + property suite | conservation + commutativity green |
| S2 | `terrace-base` protocol + view + fence | 3-peer sim convergence |
| S3 | Fuzzer + adversarial suite | invariants hold under fuzz |
| S4 | Pear app: terrace UI, invites, bet flow | 2-device live demo works |
| S5 | `wdk-vault`: identity + netting + testnet settle | e2e testnet txids as receipts |
| S6 | Oracle: attest/quorum/dispute/void (+ASR pre-fill if S0 green) | quorum-safety tests green |
| S7 | QVAC surfaces: Gaffer, translate, suggestions | on-device, no keys |
| S8 | Micro-rounds + ladder + first-scorer | recurring rounds live |
| S9 | Steward escrow | deposits verified, co-signed payout |
| S10 | Judge loop, video, VISION, submit | panel ≥8.5, submitted |

## Top risks & fallbacks
1. **QVAC SDK access/maturity** → S0 spike; fallback: manual attest (protocol unchanged) + drop QVAC track claim rather than fake it with non-QVAC AI
2. **WDK chain/testnet USDt** → S0 spike; fallback: signed IOU receipts labeled, WDK identity keys still used
3. **Autobase API drift** → S0 spike first; pin versions
4. **Solo bandwidth** → protocol (S1–S3) is headless pure TS; externals isolated in adapters; per-cut tiers pre-declared
5. **Gambling optics** → private social pools, named peers, testnet, zero fee, TRUST.md
