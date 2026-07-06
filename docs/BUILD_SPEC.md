# TIFO — Tether Developers Cup Build Spec

> **The serverless terrace market.** A football prediction market that lives entirely
> among the fans watching the match — no server, no cloud, no oracle company, no
> custodian. Peer-to-peer market state on the Pears stack, an on-device AI crowd
> oracle on QVAC, self-custodial USDt settlement on WDK. Kill any machine in the
> swarm — including the one that created the market — and the market keeps trading.

- **Hackathon:** Tether Developers Cup (DoraHacks) — football-themed knockout
- **Tracks:** ALL THREE — Pears (P2P) + QVAC (Local AI) + WDK (Wallets), each load-bearing
- **Prize target:** Cup Champion (5,000 USDt) + any/all track prizes (3 × 1,000 USDt)
- **Team:** Raj (solo)
- **Repo:** `github.com/rajkaria/tifo` (new, public, MIT) — separate from Hunch, like the CROO precedent
- **License:** MIT

---

## 1. One-liner

**TIFO turns any group of fans watching a match into a sovereign prediction market:
the swarm is the exchange, the crowd is the oracle, and every fan holds their own keys.**

A *tifo* is the giant choreographed display in a football stand — thousands of fans
each holding up one card. No single fan holds the picture; the picture only exists
in the crowd. TIFO is a market built the same way: every peer holds one append-only
log of bets; the market only exists in the crowd. That's the brand, the metaphor,
and the architecture in one word.

## 2. The Insight (why nobody thought of this)

Everyone "knows" a prediction market needs three centralized things:

1. **A matching engine / AMM** → so it needs a server or a chain with liveness.
2. **An oracle service** → so it needs UMA/Chainlink/an admin key.
3. **A custodian for the pot** → so it needs a company or a smart contract.

The insight that unlocks a fully P2P market: **parimutuel markets are CRDTs.**

- An order book requires a *total order* over messages (matching is
  order-dependent and adversarial). You cannot build one on eventually-consistent
  infrastructure without consensus.
- A **parimutuel pool is a grow-only set of bets**. Pool totals are sums; sums are
  commutative and associative. The payout is a **pure function** of
  `(final bet-set, resolved outcome)`. Merge order doesn't matter. Partitions heal
  for free. The *only* thing that needs ordering is the betting **cutoff** — and
  Autobase's deterministic linearization gives exactly that one primitive.

So the entire market reduces to: a multi-writer append-only log (Autobase), one
deterministic fold (`apply`), and a pure payout function. Hunch has run that exact
pure payout function (`computeMarketPayouts`) with real USDC on Base since June —
battle-tested parimutuel math with fee handling, single-participant refunds, and
void semantics. TIFO ports it byte-for-byte into every peer.

The second insight: **at the sofa/pub/stadium scale, the oracle problem dissolves.**
Polymarket needs a global oracle because strangers bet against strangers. In a
watch-party swarm, everyone is *literally watching the answer*. The people in the
market ARE the ground truth. TIFO makes that rigorous: each peer's device runs
on-device speech recognition (QVAC) over the ambient TV/radio commentary,
extracts match events locally, and pre-fills a signed attestation. Resolution is a
stake-and-writer quorum over signed attestations — a **crowd oracle** where the AI
runs on every phone and no audio ever leaves the device.

Third insight: **self-custody + parimutuel = settlement is just netting.** Since
payouts are a deterministic manifest, the swarm can settle like Splitwise: compute
the minimal transfer set (max-debtor→max-creditor netting) and each loser signs
their own USDt transfers from their own WDK wallet. No pot custodian at all in the
default mode. Escrow variants exist for lower-trust settings (see §8).

**Pitch compression:** *"Polymarket needs AWS, an oracle company, and a custodian.
TIFO needs two phones."*

## 3. The Problem

Watch-party betting is a massive, ancient, informal behavior — every pub table,
group chat, office pool, and stadium section runs ad-hoc wagers on every match.
Today those are: a message thread ("£5 says Mbappé scores"), a spreadsheet, a
mental note, and an argument at full time about who owes what. The alternatives
are worse for this use case:

- **Bookmakers**: you bet against the house at house odds, KYC-gated,
  geo-blocked in most of the world, and the group dynamic is gone.
- **On-chain prediction markets**: global anonymous liquidity, gas, bridges,
  custodial deposits or clunky wallets — nobody at the pub is doing this before
  kickoff.
- **Group-tipping apps**: track debts but have no market structure, no odds, no
  resolution, no settlement.

The gap: **the social, private, between-mates market** — five to five-hundred
people who share a screen or a stadium, want real skin in the game, and need
zero infrastructure between them.

## 4. The Solution

A Pear app (`pear run pear://tifo`) — no install store, no domain, no server:

1. **Open a terrace.** Pick a match (bundled World Cup fixture data). TIFO creates
   an Autobase, joins a Hyperswarm topic, and shows a QR/`pear://` invite.
2. **Mates join.** Each scan adds a writer (blind-pairing invite flow). Every peer
   gets a WDK-derived identity: one seed → signing keypair (bets/attestations) +
   USDt wallet (settlement). Fully self-custodial.
3. **Trade the match.** Parimutuel pools: match result (HOME/DRAW/AWAY), total-goals
   ladder, next-goal-in-10-minutes micro-rounds, first scorer. Odds are pool-implied
   and update live as bets replicate through the swarm.
4. **The crowd resolves it.** At the whistle, each device's QVAC ASR has already
   heard the score in the commentary; peers one-tap confirm their pre-filled
   attestation. ≥⅔ quorum (stake- and writer-weighted) resolves the market;
   disagreement past the dispute window voids to full refund.
5. **Settle in USDt, key-to-key.** TIFO computes the payout manifest with the
   ported Hunch engine, nets it to the minimal transfer set, and each debtor
   one-taps signed USDt transfers from their own WDK wallet. Receipts (txids) are
   appended to the log so the whole swarm sees settlement complete.

Meanwhile QVAC also powers **The Gaffer** (an on-device LLM commentator who banters
about the pool state), **live chat translation** (32 nations, one terrace, everyone
reads their own language), and **hunch suggestions** from bundled tournament stats.
No API keys exist anywhere in the product.

## 5. Competitive Positioning

What 80% of the field will build (they're listed in the brief, so they'll be
crowded): match predictor apps, AI commentators, fantasy leagues, watch-party
chat, group-tipping tools. Mostly single-track, mostly a web app with a wallet
button, mostly cloud AI behind a local façade.

Ideas considered and rejected for TIFO:

| Idea | Why rejected |
|---|---|
| Port Hunch to USDt/WDK as-is | Strong but obvious — "existing product + sponsor SDK" is exactly the checkbox integration judges discount |
| AI coach / commentator only | QVAC-only, crowded lane, no money path, thin demo |
| P2P watch-party chat + tipping | Pears-only, "group-tipping" is literally in the brief's idea list |
| On-chain WC prediction market | Ignores all three tracks' actual point; needs a chain with liveness |

TIFO's moat in this field: (a) a **CS-level thesis** (parimutuel-as-CRDT) rather
than a feature list; (b) **three tracks, each structurally load-bearing** — remove
any one and the product is impossible, not merely worse; (c) **production-grade
market math** ported from a venue that has settled real money for months; (d) a
demo with a **jaw-drop moment** (§13: kill the host, market survives).

### Track load-bearing test (the judges' "real use of track" axis)

| Track | Remove it and… | What it does in TIFO |
|---|---|---|
| **Pears** | there is no market | Hyperswarm discovery, Autobase multi-writer ledger + deterministic view, Corestore/Hyperbee storage, blind-pairing invites, `pear` deploy of the app itself |
| **QVAC** | there is no oracle (and no Gaffer, no translation) | on-device ASR → event extraction → attestation pre-fill; local LLM commentary; local chat translation; zero cloud AI |
| **WDK** | there is no money and no identity | seed → HD identity keys (signing) + USDt wallet; balances, transfers, receipts; self-custody throughout |

## 6. Architecture

```
┌──────────────────────────  one peer (Pear app)  ──────────────────────────┐
│                                                                            │
│  UI (terrace / market / chat / settle)                                     │
│        │                                                                   │
│  ┌─────┴──────────┐   ┌───────────────┐   ┌─────────────────────────────┐  │
│  │ market-kernel   │   │ qvac-oracle   │   │ wdk-vault                   │  │
│  │ (pure, ported   │   │ ASR + LLM +   │   │ seed → identity keys        │  │
│  │  from Hunch)    │   │ translate,    │   │      → USDt wallet          │  │
│  │ odds · payouts  │   │ all on-device │   │ transfers · receipts        │  │
│  └─────┬──────────┘   └──────┬────────┘   └──────────┬──────────────────┘  │
│        │  fold               │ attest                │ settle              │
│  ┌─────┴──────────────────────┴───────────────────────┴────────────────┐   │
│  │ terrace-base: Autobase (multi-writer log) → apply() → Hyperbee view │   │
│  └─────────────────────────────┬───────────────────────────────────────┘   │
│                                │ Hypercore replication                     │
└────────────────────────────────┼──────────────────────────────────────────┘
                                 │
                     Hyperswarm DHT (or LAN/mdns in stadium mode)
                                 │
                    ┌────────────┴───────────┐
                    │   every other peer      │  ← identical; no roles,
                    └────────────────────────┘     no host, no server
```

### 6.1 Message protocol (the entire wire format)

Every message is a signed, schema-versioned JSON node appended to the author's
own input core. The Autobase `apply` folds them deterministically:

```ts
type Msg =
  | { t: "hello";    v: 1; name: string; idKey: Hex; walletAddr: string; sig: Hex }
  | { t: "market";   v: 1; marketId: ULID; kind: MarketKind; params: MarketParams;
      cutoffAt: EpochMs; feeBps: number; sig: Hex }              // anyone may open
  | { t: "bet";      v: 1; marketId: ULID; outcomeKey: string;
      stake: { asset: "USDT"; amount: MicroUsdt };
      escrowTxid?: string; nonce: ULID; sig: Hex }
  | { t: "lock";     v: 1; marketId: ULID; sig: Hex }            // cutoff fence, §6.2
  | { t: "attest";   v: 1; marketId: ULID; outcomeKey: string;
      evidence?: { asrScore?: string; confidence: number }; sig: Hex }
  | { t: "receipt";  v: 1; marketId: ULID; manifestLine: number;
      txid: string; sig: Hex }                                    // settlement proof
  | { t: "chat";     v: 1; text: string; lang: string; sig: Hex }
```

`apply(nodes, view, host)` — the one deterministic fold, identical on every peer:

- validates signature against the writer's `hello` identity key
- `market` → insert into Hyperbee (`mkt!<id>`)
- `bet` → reject if malformed / unknown outcome / after that market's fence
  (§6.2); else insert (`bet!<mktId>!<seq>`) and bump pool aggregates
  (`pool!<mktId>!<outcome>`)
- `attest` → tally per outcome (stake-weighted + writer-weighted, §7)
- `receipt` → mark manifest line paid (`paid!<mktId>!<line>`)
- pool odds, resolution state, settlement progress are all *derived* Hyperbee
  rows — every peer materializes an identical view, or the fold is buggy (and
  the fuzzer in §11 will find it)

### 6.2 The cutoff fence (the only ordering problem — solved with the log itself)

Timestamps can't be trusted in P2P. TIFO doesn't trust them:

- Any peer MAY append `lock` for a market once its local clock passes `cutoffAt`.
  Every honest peer does this automatically → the log gets many locks.
- The view voids every bet on that market that **linearizes after the first
  `lock`**. Autobase's deterministic linearization makes "first" well-defined and
  identical on every peer.
- A cheater who back-dates a bet after the goal must get it linearized *before*
  every honest peer's lock — impossible once any honest peer's lock has
  replicated, and at pub scale locks replicate in milliseconds.
- Belt-and-braces: bets carry the author's wall-clock; a bet stamped >90s after
  `cutoffAt` is void regardless of position (defense against a fully partitioned
  duo replaying old state).

This is the whole consensus story. No PBFT, no chain — one fence, one fold.

### 6.3 Identity & keys (WDK as the root of trust)

One BIP-39 seed per user, held only on-device via WDK key management:

- `m/…/0` → **identity keypair** — signs every log message; doubles as the
  Autobase writer key. Your market identity IS a key you custody.
- `m/…/1` → **USDt wallet** — settlement. WDK provides balances, transfer
  construction/signing, and txid receipts.
- Chain: whichever WDK-supported network has the best testnet USDt story
  (Day-0 spike, §15 — candidates: Ethereum Sepolia / Arbitrum Sepolia / TON
  testnet). One chain only, per hackathon scoping rules.

## 7. The Crowd Oracle (QVAC)

**Design goal: the AI assists, humans sign, quorum decides. No model output ever
touches the money path unverified** — the same rule Hunch enforces in production
(LLM output never resolves a market; here ASR output never resolves one either —
it only *pre-fills* what a human signs).

Pipeline, entirely on-device:

1. **Listen (opt-in):** QVAC ASR transcribes ambient commentary audio in rolling
   30s windows. Nothing leaves the device — this is *the* QVAC story: your
   microphone in a pub is the most privacy-sensitive sensor imaginable, and
   cloud ASR would be disqualifying creepy. Local AI isn't a gimmick here; it's
   the only acceptable design.
2. **Extract:** a small on-device LM pass (or rule-based scorer over the
   transcript for robustness) detects `GOAL`, scorer names, and the full-time
   score with a confidence value.
3. **Prompt:** at full time each peer sees "Full time: FRA 2–1 BRA — confirm?"
   pre-filled. One tap → signed `attest` message.
4. **Quorum:** a market resolves to outcome `o` when attestations for `o` reach
   **≥⅔ of attested stake AND ≥⅔ of distinct attesting writers AND ≥3 writers**
   (both thresholds, so neither whales nor sock-puppet writers can steer alone).
5. **Dispute window:** resolution finalizes `Δ = 10 min` after quorum. A
   counter-quorum inside Δ → the market **voids → full gross refund**, Hunch's
   exact production void semantics (flat-round void rule, ported).
6. **Incentive (stretch):** route `feeBps` (default 0 among mates) to attesters
   who matched the final outcome — a micro attester reward pot.

Threat notes: colluding majority in a 5-person pool can steal — accepted and
*stated honestly*: TIFO's trust model is "people you'd share a table with,"
tiered up by escrow modes (§8). Judges respect a stated trust model far more
than a hand-waved "decentralized oracle."

Also on QVAC (same runtime, big demo surface, small marginal code):

- **The Gaffer** — local LLM commentator with the live Hyperbee view as context:
  "2–1 and 80% of the pool is on DRAW — someone's having a shocker."
- **Terrace translate** — chat messages carry `lang`; every peer renders every
  message in its own language via local translation. World Cup = 32 nations in
  one swarm; nobody switches apps.
- **Hunch suggestions** — local semantic search over bundled tournament stats
  (squads, form, H2H) feeding market-creation suggestions.

## 8. Settlement (WDK) — three trust tiers

**Tier 1 — Mates Mode (default, must-ship).** Stakes are commitments during the
match (the log is the IOU ledger — it's signed, replicated, and non-repudiable).
At resolution, `settle-plan` derives from the payout manifest the **minimal
transfer set** via max-debtor→max-creditor netting (Splitwise algorithm): a
10-person pool settles in ≤9 transfers, usually ~3. Each debtor one-taps; WDK
signs and broadcasts; `receipt` txids append to the log; the terrace shows a
live "everyone's square" checklist. Social enforcement — exactly how pub debts
work today, minus the arguing, plus cryptographic receipts.

**Tier 2 — Steward Escrow (should-ship).** For bigger/looser groups: the swarm
elects 2 stewards + the market opener as a 2-of-3 multisig (WDK keys); bets
require an on-chain USDt deposit to the escrow address (`escrowTxid` verified by
each peer against the chain before the bet counts in pools); payouts are
co-signed straight from escrow per the manifest. No company custodian — three
mates ARE the custodian.

**Tier 3 — SwarmVault (stretch/vision).** t-of-n threshold signing (FROST/MuSig2)
so the *swarm itself* is the custodian with no distinguished stewards. Specced in
VISION.md as the research roadmap; not attempted for the first cut.

Payout math for all tiers = the ported Hunch kernel: winners split losers' pool
pro-rata; `feeBps` configurable (default 0 — friends don't rake friends);
single-participant → full refund; void → full gross refund; conservation to the
micro-cent enforced by property tests.

## 9. Market catalogue (ported Hunch DNA, football-shaped)

| Market | Structure | Hunch ancestry |
|---|---|---|
| Match result | 3-way parimutuel HOME/DRAW/AWAY | N-way outcome keys (event_versus / coin-flip) |
| Total goals | O/U ladder (0.5 / 1.5 / 2.5 / 3.5) | ladder-config factory |
| Goal in next 10 min | recurring micro-rounds, auto-open/lock/resolve all match | recurring-rounds engine + T-60s lock (The Flip) |
| First / anytime scorer | N-way over the squad list | event_versus `candidates` |
| Correct score | 5×5 grid parimutuel | stretch |

**Micro-rounds are the live-demo killer**: a new 10-minute pool every 10 minutes,
all match long — the swarm never runs out of something to trade, and the demo
never has dead air.

**Tournament layer (stretch): the federated terrace.** Every terrace publishes
its resolved outcomes + anonymized PnL leaderboard on a public Hypercore; a
tournament manifest (a Hyperbee of terrace keys) lets any peer replicate and
aggregate a global World Cup leaderboard across thousands of independent
terraces — a worldwide competition with zero servers. This is the "nobody
thought of that" encore: swarms of swarms.

## 10. Repo layout

```
tifo/
├── packages/
│   ├── market-kernel/     # PURE. Ported Hunch parimutuel core: odds, payouts,
│   │                      #   fees, refunds, void. Zero I/O. Property-tested.
│   ├── terrace-base/      # Autobase apply(), Hyperbee view schema, msg codecs,
│   │                      #   signature validation, cutoff fence, invites
│   ├── crowd-oracle/      # attestation protocol, quorum math (pure) +
│   │                      #   QVAC ASR/extract adapters (device-only)
│   ├── wdk-vault/         # seed → identity + wallet, transfers, receipts,
│   │                      #   escrow verify, netting (pure) + WDK adapter
│   └── sim/               # in-memory multi-peer swarm simulator + fuzzer
├── apps/
│   └── terrace/           # the Pear app (pear run .) — UI, QVAC bindings
├── fixtures/              # WC-2026 fixtures, squads, stats bundle (offline)
├── docs/                  # ARCHITECTURE.md, ORACLE.md, TRUST.md, DEMO.md
└── VISION.md
```

Ports-&-adapters carried over from Hunch: `market-kernel`, quorum math, and
netting are pure and run under vitest on CI; Pears/QVAC/WDK live behind
interfaces with in-memory fakes so the whole protocol is testable headless.

## 11. Testing (the judge-impresser)

- **Property tests (fast-check), `market-kernel` + quorum + netting:**
  - *Conservation*: Σ payouts + fees = Σ stakes, exactly, for arbitrary bet sets
  - *Commutativity*: any permutation/partition/merge order of the same bet set →
    identical pools, odds, payouts (the CRDT claim, proven not asserted)
  - *Netting soundness*: transfer set settles the manifest exactly, ≤ n−1 edges
  - *Quorum safety*: no two conflicting outcomes can both reach quorum under the
    dual-threshold rule
- **Swarm fuzzing (`packages/sim`):** N in-process peers on in-memory corestores;
  random bet interleavings, writer churn, partitions/heals, late-bet injection
  after the fence, double-attests, whale-stake attestation attacks → assert view
  convergence byte-for-byte across peers + all invariants above.
- **Contract tests:** WDK adapter against testnet (one real funded wallet);
  QVAC ASR against a fixture pack of real commentary clips (goal / no-goal /
  crowd noise) with a minimum extraction-accuracy bar.
- **CI:** GitHub Actions — typecheck, lint, unit + property + sim on every push.
  Public commit history shows steady cadence (the brief says judges watch this).

## 12. Reuse & prior-work declaration (submission compliance)

The brief: *"You can reuse your own old code, but judges only score what you
build during the event."* Declared plainly in README + submission:

- **Ported prior work (mine, from Hunch/playhunch.xyz, live since June 2026):**
  the pure parimutuel payout kernel, pool-implied odds math, void/refund rules,
  ladder + recurring-round *concepts*. ~5% of the final codebase, and none of it
  touches Pears/QVAC/WDK.
- **Built during the event (scored):** everything else — the entire P2P protocol
  (`terrace-base`), the crowd oracle, all QVAC and WDK integration, the netting
  engine, the sim/fuzzer, the Pear app and UI, docs and demo.

This is a *strength*, not a caveat: "the market math has been settling real money
for months; the hackathon work is making it serverless" is a better story than
"we wrote untested payout math on day one."

## 13. Demo flow (3-minute video + live pitch)

Three devices on camera: two laptops + one phone. A real (or replayed) match on
a TV in the background.

1. **[0:00–0:20] Hook.** "This is a prediction market with no server. Watch."
   Laptop A: `pear run pear://tifo` → open a terrace for tonight's match → QR.
2. **[0:20–0:50] Join & trade.** Phone + Laptop B scan in. Three bets land;
   pool odds shift live on all three screens. Open a "goal in next 10 min"
   micro-round.
3. **[0:50–1:20] 💀 THE MOMENT. Close Laptop A — the machine that *created* the
   market.** Phone and Laptop B keep trading, odds keep moving. Caption:
   "There is no host. There is nothing to shut down." (This single beat is the
   whole thesis, and no centralized competitor can survive it.)
4. **[1:20–2:00] The crowd oracle.** Goal on the TV → phone's QVAC transcript
   pane highlights "GOAL — 2–1" heard *locally, offline* → full-time attestation
   pre-filled → two taps on two devices → quorum bar fills → RESOLVED.
5. **[2:00–2:40] Settlement.** Payout manifest → netted to two transfers →
   debtor taps → WDK-signed USDt transfers → txids appear as receipts in the
   log on every screen → "everyone's square ✓". Show the block-explorer link.
6. **[2:40–3:00] Zoom out.** The Gaffer cracks a joke; chat shows PT→EN→HI live
   translation; federated leaderboard teaser; card: *"Polymarket needs AWS, an
   oracle company, and a custodian. TIFO needs two phones."*

Backup: full pre-recorded run + a `sim`-driven scripted swarm so the live pitch
can never be killed by venue Wi-Fi (fittingly, TIFO barely needs Wi-Fi — LAN
mode IS the backup).

## 14. Sprint plan (gates, no dates — depth-ordered)

Every sprint ends green (`typecheck && lint && test`) and pushed; the Hunch
working agreement, unchanged.

- **S0 — Day-0 spikes (de-risk everything external):** QVAC SDK hello-world (ASR
  a WAV, run a small LM, translate a string — on-device, no keys); WDK
  hello-world (seed → address → testnet USDt transfer → txid); Autobase
  hello-world (2 writers, deterministic view). *Go/no-go per track; fallback
  positions in §15.*
- **S1 — `market-kernel` port + property suite.** Conservation + commutativity
  green before any networking exists.
- **S2 — `terrace-base`:** msg codecs, signatures, `apply`, Hyperbee view,
  cutoff fence. Sim harness proves 3-peer convergence.
- **S3 — Fuzzer + adversarial suite** (late bets, partitions, churn). The
  protocol is *done* before any UI exists.
- **S4 — Pear app:** terrace UI, invites/QR, live odds, bet flow, chat.
- **S5 — `wdk-vault`:** identity + wallet, Mates-Mode netting + transfers +
  receipts, end-to-end on testnet.
- **S6 — `crowd-oracle`:** attestation/quorum/dispute/void + QVAC ASR pre-fill
  against the fixture clip pack.
- **S7 — QVAC surfaces:** the Gaffer, terrace translate, hunch suggestions.
- **S8 — Micro-rounds + total-goals ladder + first-scorer** (recurring engine).
- **S9 — Steward escrow (Tier 2).**
- **S10 — Polish + judge loop:** simulated 7-judge panel (per the hackathon
  skill), fix, re-panel to 8.5+; demo video; README; VISION.md; submit.
- **S11+ (post-first-cut resubmission ammo):** federated tournament layer,
  stadium LAN mode showcase, attester rewards, correct-score grid.

## 15. Risks & Day-0 verifications

| Risk | Odds | Mitigation |
|---|---|---|
| QVAC SDK maturity — ASR/LLM APIs, platform support, model sizes unknown until spiked | med | S0 spike FIRST. Fallbacks in order: (a) smaller model + rule-based score extraction from transcript; (b) ship attest-by-tap with QVAC powering Gaffer+translate only — oracle protocol is unchanged, ASR is assist-only by design |
| WDK chain/testnet USDt availability | med | S0 spike. Pick the single best-supported chain; worst case Tier-1 settles with native testnet asset labeled USDt-equivalent, disclosed honestly |
| Pear runtime on mobile is limited | high | Demo = 2 laptops + 1 phone *if* mobile works; else 3 desktop peers — thesis is untouched. Mobile listed as roadmap |
| Noisy-pub ASR accuracy | high | ASR is pre-fill assist, never authority; fixture-clip accuracy bar; manual attest is always one tap |
| Autobase writer-add / pairing UX friction | med | Blind-pairing invite pattern (Keet's approach); worst case paste-a-key flow for the demo |
| Real-money-gambling optics | med | Default feeBps=0 private social pools between named peers (poker-night framing); testnet USDt for all demos; TRUST.md states the legal posture; paper mode is one flag |
| Solo bandwidth vs. three tracks | high | The protocol (S1–S3) is pure TS I can fuzz headless — the risky externals are all isolated in S0 spikes and adapters; scope fallbacks pre-declared per tier |

## 16. Judging-criteria map

| Criterion | TIFO's answer |
|---|---|
| Technical ambition | multi-writer deterministic market protocol; parimutuel-as-CRDT with fuzz-proven convergence; on-device oracle; threshold-custody roadmap |
| User experience | 3 taps from QR to first bet; odds move live; attestation is one tap; settlement is one tap; translation makes it native-language for everyone |
| Real-world use | digitizes behavior that already happens at every pub table; works where bookmakers are geo-blocked; USDt is the currency this crowd already holds |
| Creativity | the market IS the crowd; kill-the-host demo; federated terraces; ambient-audio oracle |
| Real use of tracks | each of the three is structurally load-bearing (§5 table) — remove any one and the product ceases to exist |

## 17. Vision (VISION.md summary)

- **Month 1:** mobile Pear packaging; 10 pub pilots during the WC final rounds
  → knockout-stage usage data.
- **Month 3:** SwarmVault (FROST t-of-n escrow) research build; attester-reward
  economics; federated tournament layer GA; club/creator terraces (a podcast
  spins up a 5,000-listener terrace per match).
- **Month 6:** TIFO as a *protocol* — `terrace-base` published as the P2P
  parimutuel primitive others embed (esports, elections-night watch parties,
  award shows); Hunch itself becomes one venue that can *bridge* terraces.
- **Revenue:** protocol stays free among mates; optional feeBps on hosted/public
  terraces + escrow-service tier; the wedge is distribution, not rake.
- **Why Tether wins if TIFO wins:** every terrace is a reason for a group of
  friends to hold USDt in a self-custodial WDK wallet; QVAC gets its flagship
  privacy story ("a mic in a pub demands local AI"); Pears gets the first
  consumer-legible financial app on Autobase.

## 18. Submission checklist

- [ ] Registered on DoraHacks, all three tracks selected, before July 6 close
- [ ] Public repo `tifo`, MIT license, from first commit
- [ ] README: one-liner → GIF → 30-second architecture → run steps
      (`npm i && pear run .` must work first try) → tracks table (§5) →
      prior-work declaration (§12) → known limitations
- [ ] VISION.md linked from README
- [ ] ≤3-min unlisted YouTube demo (script in §13) — required at July-8 cut
- [ ] External services disclosed: chain RPC for USDt settlement, nothing else
      (no cloud AI, no backend — say it loudly)
- [ ] CI green badge; steady public commit cadence through both cuts
- [ ] Nation pick for the team (the brief asks): 🏴󠁧󠁢󠁥󠁮󠁧󠁿 or 🇮🇳 — Raj's call

---

*Spec status: ideation + spec phases complete (hackathon skill phases 1–3).
Next: S0 spikes (phase 4–5) on go-decision. This document is the single source
of truth for scope; anything not in §14 must-ship tiers is cut-eligible.*
