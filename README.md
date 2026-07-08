# Curva ⚽

> **A football prediction market with no server.** The swarm is the exchange, the
> crowd is the oracle, every fan holds their own keys. Pears (P2P) + QVAC (local
> AI) + WDK (self-custodial USDt) — a Tether Developers Cup entry, all three
> tracks structurally load-bearing.

The *curva* is the curved stand behind the goal where the ultras gather —
thousands of fans, no assigned seats, moving and chanting as one. No single fan
*is* the crowd; the crowd only exists in the aggregate. Curva is a market built
the same way: every peer holds one append-only log of bets; the market only
exists in the crowd.

**Kill any machine in the swarm — including the one that created the market — and
the market keeps trading.**

---

## The one insight

Everyone "knows" a prediction market needs three centralized things: a matching
engine (a server), an oracle (an admin key), and a custodian (a company). Curva
removes all three because **a parimutuel pool is a CRDT**:

- Pool totals are sums; sums are commutative and associative. The payout is a
  pure function of `(final bet-set, resolved outcome)`. Merge order doesn't
  matter, so partitions heal for free — no consensus needed.
- The *only* thing needing order is the betting **cutoff**, and Autobase's
  deterministic linearization gives exactly that one primitive (the fence).
- At watch-party scale the oracle problem dissolves: everyone is literally
  watching the answer. Each device runs on-device ASR over the commentary and
  the crowd signs a stake-and-writer quorum.
- Self-custody + parimutuel ⇒ settlement is just netting: compute the minimal
  transfer set and each loser signs their own USDt transfer.

> *Polymarket needs AWS, an oracle company, and a custodian. Curva needs two phones.*

## Run it

```bash
npm install
npm run check   # typecheck + lint + 217 tests (property + fuzz + e2e + jsdom); Node ≥20.19/22.12/24
npm run demo    # the whole pipeline, headless, in one command
```

`npm run demo` runs the entire thesis with **no external services** — derive
vaults → open a terrace → three bets → **kill the host** → cutoff lock → on-device
ASR pre-fills attestations → crowd quorum resolves → net the payout → each debtor
settles their own USDt → receipts land → *everyone's square*. It exercises the
real packages (FakeWallet + FakeAsr, clearly labelled), so the claim is
verifiable even without Pear, a QVAC model, a funded wallet, or a network.

The Pear app:

```bash
npm run build                 # compile packages to JS
pear run apps/terrace         # requires the Pear runtime (npm i -g pear)
```

## Tracks — each one is load-bearing (remove it and the product is impossible)

| Track | What it does | Remove it and… |
|---|---|---|
| **Pears** | Hyperswarm discovery, Autobase multi-writer ledger + deterministic `apply` fold, Hyperbee view, cutoff fence, `pear` deploy | there is no market |
| **QVAC** | on-device ASR → score extraction → attestation pre-fill; local LLM Gaffer; local chat translation; zero cloud AI | there is no oracle |
| **WDK** | one seed → HD identity key (signs every message) + USDt wallet; netting; transfers; receipts | there is no money and no identity |

## Architecture

```
market-kernel   pure parimutuel core (odds/payouts/refunds/void) — ported from Hunch
terrace-base    signed msg protocol · apply() fold · Hyperbee view · cutoff fence · Autobase runtime
sim             Lamport-ordered swarm simulator + adversarial fuzzer
crowd-oracle    quorum math (dual ⅔ + dispute→void) · QVAC ASR score extraction
wdk-vault       seed → identity + wallet · minimal-transfer netting · settlement
market-catalogue  match-result / total-goals / micro-rounds / first-scorer factories
qvac-surfaces   the Gaffer · terrace translate · hunch suggestions
steward-escrow  Tier-2 2-of-3 escrow (election · deposit verify · co-signing)
e2e             the whole pipeline, headless (npm run demo)
apps/terrace    the Pear app
```

Ports-&-adapters throughout: everything money- or consensus-related is pure and
fuzz-tested; Pears/QVAC/WDK live behind adapters with in-memory fakes, so the
whole protocol is testable headless. Details:
[ARCHITECTURE](docs/ARCHITECTURE.md) · [ORACLE](docs/ORACLE.md) ·
[TRUST](docs/TRUST.md) · [DEMO script](docs/DEMO.md) · [VISION](VISION.md).

## What's proven, not asserted

- **Conservation** — `Σ payouts + Σ fees === Σ stakes`, exactly, for arbitrary
  bet sets (property test, fast-check).
- **Commutativity (the CRDT claim)** — any permutation/partition/merge of the same
  bet set yields identical pools, odds, and payouts.
- **Convergence under fuzz** — 100 randomized runs of bet interleavings, writer
  churn, partitions/heals, late bets, double-attests, and whale stakes all heal
  to one byte-identical view.
- **Quorum safety** — the dual ⅔ threshold makes it impossible for two outcomes
  to both reach quorum; neither a whale nor a sock-puppet swarm can steer.
- **Netting soundness** — the transfer set settles every party exactly in ≤ n−1
  edges.

## Prior-work declaration (judges score only in-event work)

- **Ported prior work (mine, from [Hunch](https://www.playhunch.xyz), settling real
  money on Base since June 2026):** the pure parimutuel payout math
  (`computeMarketPayouts`), odds, void/refund rules, and the ladder/recurring
  concepts — adapted into `@curva/market-kernel`. Every deviation is documented in
  that package's README. ~5% of the codebase; none of it touches Pears/QVAC/WDK.
- **Built during the event (scored):** the entire P2P protocol (`terrace-base`),
  the crowd oracle, the swarm sim/fuzzer, all QVAC and WDK integration, the
  netting engine, steward escrow, the market catalogue, the Pear app, and all docs.

## External services disclosed

Exactly one: a chain **RPC endpoint** for USDt settlement in real mode. No cloud
AI, no backend, no analytics — the demo/offline path uses no network at all.

## License

MIT — public from the first commit and staying public.
