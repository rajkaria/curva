# Trust & Settlement Tiers

Curva is honest about who can cheat whom, and lets a terrace dial up its
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

## Tier 2 — Steward Escrow (shipped: `@curva/steward-escrow`)

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

## Trust hardening (S16, shipped, opt-in)

Three post-audit upgrades close the remaining honesty gaps. All are **opt-in**;
demo-mode behavior is bit-identical unless a feature is switched on.

### Verified receipts (T1)

Receipts in the log are self-reported txids — Tier 1's social model tolerates
that, but real mode shouldn't have to. `ReceiptVerifier` (`@curva/wdk-vault`)
checks each claimed transfer against the chain: `eth_getTransactionReceipt` +
an exact ERC-20 `Transfer(from, to, amount)` log match on the disclosed USDt
contract. The "everyone's square" checklist upgrades ✓ (claimed) → ✓✓
(verified) per line; a reverted tx or a wrong amount shows ⚠ mismatch.
Failure modes (RPC down, unmined tx) degrade to "claimed" — **never to a false
"verified"**. Verification is read-side only: no protocol change, every peer
verifies independently.

### Hardened dispute window (T2)

The default dispute window is wall-clock (`{kind: "wallclock", ms}`): a market
finalizes N minutes after quorum, which trusts author timestamps — fine for
mates. The hardened mode (`{kind: "events", count}`) removes that last
wall-clock trust: a market finalizes only after `count` further **linearized
attestation events** arrive with no counter-quorum. Progress is measured in
signed log entries that every peer replays identically, so no author clock can
rush a finalization or stall one. Recommended for adversarial crowds; the
wallclock mode's behavior is pinned by a byte-identical regression property.

### Seed sealed at rest (T4)

By default the demo seed sits in localStorage, labelled "demo seed —
unencrypted". Opt in to a passphrase and the mnemonic is sealed with
scrypt (≈100 ms KDF) + XChaCha20-Poly1305 into a versioned blob
(`v1:scrypt:xchacha:…`); the app then gates launch on the passphrase.
Wrong passphrase fails closed (AEAD auth error — never garbage), and the
plaintext key is replaced, not shadowed. There is no recovery without the
passphrase, and the UI says so.

## Money invariants (all tiers)

Payout math is the ported Hunch kernel: winners split losers' pool pro-rata;
`feeBps` configurable (default 0 — friends don't rake friends);
single-participant → full refund; void → full gross refund; **conservation to the
micro-cent** enforced by property tests. Curva distributes sub-micro dust by
largest-remainder (Hunch keeps it in the treasury; Curva has no treasury), so the
books balance exactly.

## Gambling posture

Private social pools between named peers (poker-night framing), testnet USDt,
zero fee by default. Nothing here is a house taking bets against strangers.
