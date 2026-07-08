# VISION

Curva is a proof that a real-money market can live with no server, no oracle
company, and no custodian. The hackathon build is the wedge; here is where it goes.

## The encore nobody expects: swarms of swarms

Every terrace can publish its resolved outcomes + an anonymized PnL leaderboard on
a **public Hypercore**. A tournament manifest (a Hyperbee of terrace keys) lets any
peer replicate and aggregate a **global World Cup leaderboard across thousands of
independent terraces** — a worldwide competition with zero servers. The
parimutuel-as-CRDT thesis composes upward: a swarm of swarms.

## Roadmap

- **Month 1** — mobile Pear packaging; 10 pub pilots through the knockout rounds →
  real usage data. Desktop peers + phone today; mobile is the distribution unlock.
- **Month 3** — **SwarmVault**: `t`-of-`n` threshold signing (FROST/MuSig2) so the
  swarm itself is the custodian with no distinguished stewards (Tier 3 above the
  shipped 2-of-3 escrow). Attester-reward economics (route `feeBps` to attesters
  who matched the outcome). Federated tournament layer GA. Club/creator terraces —
  a podcast spins up a 5,000-listener terrace per match.
- **Month 6** — Curva as a *protocol*: `terrace-base` published as the P2P
  parimutuel primitive others embed (esports, elections-night watch parties, award
  shows). Hunch becomes one venue that can *bridge* terraces.

## Business

The protocol stays free among mates. Revenue is optional `feeBps` on hosted/public
terraces + an escrow-service tier. The wedge is distribution, not rake.

## Why Tether wins if Curva wins

Every terrace is a reason for a group of friends to hold USDt in a self-custodial
WDK wallet. QVAC gets its flagship privacy story — "a mic in a pub demands local
AI." Pears gets the first consumer-legible financial app on Autobase.

## Research threads

- **Threshold custody** — FROST/MuSig2 SwarmVault; verify deposits without a
  distinguished verifier.
- **Fence hardening** — beyond the 90s wall-clock belt: VDF/verifiable-delay or
  witnessed-lock schemes for adversarial (non-mates) settings.
- **Attester incentives** — reward-for-accuracy without opening a grief/bribery
  surface; the attester-reward pot economics.
- **Correct-score grids & richer catalogues** — the 5×5 grid, parlays across
  micro-rounds, all as pure kernel extensions.
