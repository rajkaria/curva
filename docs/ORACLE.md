# The Crowd Oracle

**Design goal: the AI assists, humans sign, quorum decides. No model output ever
touches the money path unverified** — the same rule Hunch enforces in production.

## Pipeline (entirely on-device)

1. **Listen (opt-in).** QVAC ASR transcribes ambient commentary in rolling
   windows. Nothing leaves the device — a microphone in a pub is the most
   privacy-sensitive sensor imaginable, so cloud ASR would be disqualifying.
   Local AI isn't a gimmick here; it's the only acceptable design.
2. **Extract.** A pure, rule-based pass (`crowd-oracle/src/extract.ts`) reads the
   transcript for a full-time score — team-anchored, number words, robust to pub
   noise, deterministic across devices. Rule-based (not an LLM) on purpose: it
   must be reproducible and identical everywhere.
3. **Pre-fill.** At full time each peer sees "France 2–1 Brazil — confirm?"
   pre-filled. One tap → a signed `attest` message. The human is always the
   signer; ASR only fills the form.
4. **Quorum.** A market resolves to outcome `o` only when attestations for `o`
   reach **≥⅔ of attested stake AND ≥⅔ of distinct attesting writers AND ≥3
   writers**.
5. **Dispute window.** Resolution finalizes Δ = 10 min after quorum first forms.
   A counter-quorum (a *different* outcome reaching quorum) within Δ voids the
   market to a full gross refund — Hunch's exact void semantics, ported.

## Why the dual threshold

The writer threshold alone makes it impossible for two outcomes to both reach
quorum: two outcomes each with ≥⅔ of writers would need >the whole electorate.
So the vote is **safe** — proven, not asserted, in `quorum.test.ts`. The two
thresholds together mean:

- a **whale** (all the stake, few writers) fails the writer threshold;
- a **sock-puppet swarm** (many writers, no stake) fails the stake threshold.

Neither can steer a market alone. Quorum is evaluated on the whole tally at each
timestamp (not incrementally per event), so a large late vote in the same instant
is counted before quorum can latch — the resolution never depends on the order
same-timestamp attestations happen to be stored in.

## Stated trust model

A colluding majority in a small pool can still steal. This is **accepted and
stated honestly**: Curva's default trust model is "people you'd share a table
with," tiered up by escrow modes ([TRUST.md](TRUST.md)). Judges respect a stated
trust model far more than a hand-waved "decentralized oracle."
