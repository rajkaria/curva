# @curva/market-kernel

The pure parimutuel core. Zero I/O, zero dependencies, all amounts in bigint
USDt micros. Every peer runs this same fold over the same bet set and produces
a byte-identical settlement manifest — that determinism is what lets the market
live on an eventually-consistent P2P log with no server.

## API

- `buildPools(bets, feeBps)` — fold bets into per-outcome pool aggregates
- `mergePools(a, b)` — merge two partial folds (partitions heal for free)
- `impliedOdds(pools)` — pool-implied probability + decimal odds (display only)
- `computePayouts({ bets, resolution, feeBps })` — the settlement manifest

## Settlement semantics

| Case | Result |
|---|---|
| Resolved, winners exist | winners split the net pool pro-rata by net stake; sub-micro dust distributed by largest remainder (ties → lower bettorId) so the pool is exhausted **exactly** |
| Voided (dispute) | full gross refund, fees returned |
| Single participant | full gross refund — a market needs a counterparty |
| Nobody backed the winner | full gross refund — there is no treasury to retain the pool |

## Invariants (property-tested with fast-check, not asserted)

- **Conservation** — `Σ payouts + Σ fees === Σ stakes`, exactly, for arbitrary
  bet sets, fees, and resolutions
- **Commutativity** — any permutation of the bet set gives identical pools,
  odds, and manifests; any partition folds + merges to the same pools (the
  CRDT claim)
- **Winner no-loss** — at `feeBps = 0` no winner ever receives less than their
  winning stake
- **Refund exactness** — refund paths return each bettor exactly their gross

## Provenance

Ported from the Hunch production payout engine (`computeMarketPayouts`,
settling real USDC on Base since June 2026) — declared prior work. Adapted for
P2P: N-way outcomes, bigint micros, exact conservation (Hunch keeps sub-micro
dust in the treasury; Curva has no treasury), and refund-on-no-winner.
