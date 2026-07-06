# Architecture

TIFO is one deterministic fold over a multi-writer append-only log, with three
external stacks (Pears, QVAC, WDK) isolated behind adapters. This document maps
the pieces; see the per-package READMEs for detail.

```
┌──────────────────────────  one peer (Pear app)  ──────────────────────────┐
│  UI (terrace / market / chat / settle)   apps/terrace                      │
│        │                                                                   │
│  ┌─────┴───────┐  ┌────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ market-kernel│  │ crowd-oracle│  │ market-catalogue│ wdk-vault          │  │
│  │ payouts/odds │  │ quorum/ASR  │  │ market factories│ identity+wallet    │  │
│  └─────┬───────┘  └──────┬─────┘  └──────┬───────┘  └────────┬──────────┘  │
│        │  fold           │ attest        │ open             │ settle       │
│  ┌─────┴──────────────────┴───────────────┴──────────────────┴─────────┐   │
│  │ terrace-base: signed msgs → apply() fold → Hyperbee view · fence     │   │
│  │              TerraceNode (Autobase + Corestore + Hyperswarm runtime) │   │
│  └───────────────────────────────┬────────────────────────────────────┘   │
└──────────────────────────────────┼─────────────────────────────────────────┘
                                    │ Hypercore replication over Hyperswarm
                           ┌────────┴────────┐
                           │  every other peer │  ← identical; no host, no server
                           └──────────────────┘
```

## The message protocol

Every message is a signed, schema-versioned JSON node appended to the author's
own input core (`packages/terrace-base/src/protocol.ts`):

`hello · market · bet · lock · attest · receipt · chat`

- **Identity** is a secp256k1 key (`m/44'/60'/0'/0/1` from the WDK seed). The
  signature is recoverable, so the fold binds authorship cryptographically with
  no trusted mapping table. The same seed's `…/0` key is the USDt wallet.
- **Canonical encoding**: keys sorted at every level, bigints as decimal strings,
  the `sig` field dropped before hashing — byte-identical on every peer.

## The fold (`apply`)

`applyMessage(view, msg, seq)` is the one deterministic fold, run identically on
every peer over Autobase's linearized order. Any message failing a rule is
silently dropped — identically everywhere, so drops never break convergence.
Derived rows in the Hyperbee view: identities, markets, valid bets, per-outcome
pools, the lock (fence), the append-only attestation log, receipts, chat.

## The cutoff fence (the only ordering problem)

Timestamps can't be trusted in P2P, so TIFO doesn't trust them. Any peer may
append `lock` once its clock passes `cutoffAt`; the view voids every bet that
linearizes **after the first lock**. "First" is well-defined because the fold
runs over Autobase's deterministic linearization. A 90-second wall-clock belt
catches a fully-partitioned duo replaying old state. That is the whole consensus
story — one fence, one fold, no PBFT, no chain.

## Ports & adapters

Pure and fuzz-tested: `market-kernel`, the `apply` fold, quorum math, netting,
the catalogue. Behind adapters with in-memory fakes: Autobase/Hyperswarm
(`TerraceNode`), WDK (`WdkWallet` / `FakeWallet`), QVAC ASR + LLM (`QvacAsr` /
`QvacLlm` / `FakeAsr` / `FakeLlm`), the escrow chain. The heavy SDKs are loaded
lazily (`import(variable)`), so CI and the headless demo need none of them.

## Determinism & testing

The `@tifo/sim` swarm models Autobase linearization with Lamport clocks: every
peer sorts the same envelope set the same way, so identical sets ⇒ byte-identical
views. That lets the fuzzer throw partitions, churn, and attacks at the protocol
in-process and assert convergence + every money invariant. The S0a spike proved
the same convergence on real Autobase over the wire.
