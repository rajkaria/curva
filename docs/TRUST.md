# Trust & Settlement Tiers

TIFO is honest about who can cheat whom, and lets a terrace dial up its
guarantees. All demos use **testnet USDt** with **feeBps = 0**.

## Tier 1 — Mates Mode (default, shipped)

Stakes are commitments during the match: the log is the IOU ledger — signed,
replicated, non-repudiable. At resolution, `settle-plan` derives the **minimal
transfer set** from the payout manifest (max-debtor→max-creditor netting): a
10-person pool settles in ≤ 9 transfers, usually ~3. Each debtor one-taps; WDK
signs and broadcasts from their own wallet; `receipt` txids append to the log and
the terrace shows a live "everyone's square" checklist.

**Trust model:** social enforcement — exactly how pub debts work today, minus the
arguing, plus cryptographic receipts. A debtor can refuse to pay; the swarm sees
exactly who is unsettled. Best for people who'd share a table.

## Tier 2 — Steward Escrow (shipped: `@tifo/steward-escrow`)

For bigger/looser groups. The swarm deterministically elects the opener + the two
largest stakers as a **2-of-3** signer set (identical on every peer). Bets require
an on-chain USDt deposit to the escrow address, **verified independently by each
peer** against the chain before the bet counts in pools. Payouts are co-signed
(≥2 of 3 distinct stewards, over the exact payout instruction) straight from
escrow. No company custodian — three mates *are* the custodian.

## Tier 3 — SwarmVault (vision, not shipped)

`t`-of-`n` threshold signing (FROST/MuSig2) so the *swarm itself* is the
custodian with no distinguished stewards. Specced in [VISION.md](../VISION.md);
not attempted for this cut. We say so plainly rather than fake it.

## Money invariants (all tiers)

Payout math is the ported Hunch kernel: winners split losers' pool pro-rata;
`feeBps` configurable (default 0 — friends don't rake friends);
single-participant → full refund; void → full gross refund; **conservation to the
micro-cent** enforced by property tests. TIFO distributes sub-micro dust by
largest-remainder (Hunch keeps it in the treasury; TIFO has no treasury), so the
books balance exactly.

## Gambling posture

Private social pools between named peers (poker-night framing), testnet USDt,
zero fee by default. Nothing here is a house taking bets against strangers.
