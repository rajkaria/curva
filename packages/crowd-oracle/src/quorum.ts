/**
 * The crowd oracle's decision rule — pure, deterministic, safety-first.
 *
 * A market resolves to outcome `o` only when attestations for `o` reach BOTH
 * ≥⅔ of attested stake AND ≥⅔ of distinct attesting writers, with ≥3 writers.
 * The dual threshold is the whole point: the writer threshold alone makes it
 * impossible for two outcomes to both reach quorum (proven in the suite), so
 * neither a whale (all stake, few writers) nor a sock-puppet swarm (many
 * writers, no stake) can steer a market alone.
 *
 * Resolution finalizes Δ after quorum first forms. If a *different* outcome
 * reaches quorum within that window — a genuine dispute — the market voids to a
 * full gross refund (the ported Hunch void semantics). AI/ASR only pre-fills
 * what a human signs; this rule, over signed attestations, is the only thing
 * that resolves money.
 */

export interface QuorumConfig {
  readonly minWriters: number;
  /** Stake threshold as [numerator, denominator], e.g. [2,3] = ≥⅔. */
  readonly stakeRatio: readonly [number, number];
  readonly writerRatio: readonly [number, number];
}

export const DEFAULT_QUORUM: QuorumConfig = {
  minWriters: 3,
  stakeRatio: [2, 3],
  writerRatio: [2, 3],
};

/** A writer's current vote. */
export interface Attestation {
  readonly outcomeKey: string;
  readonly ts: number;
}

/** One attestation event in the append-only log (a writer may re-attest). */
export interface AttestationEvent {
  readonly writer: string;
  readonly outcomeKey: string;
  readonly ts: number;
}

/** The outcome that currently meets the dual quorum, or null. */
export function quorumOutcome(
  tally: ReadonlyMap<string, Attestation>,
  stakeByWriter: ReadonlyMap<string, bigint>,
  config: QuorumConfig,
): string | null {
  const totalWriters = tally.size;
  if (totalWriters === 0) return null;

  const writersFor = new Map<string, number>();
  const stakeFor = new Map<string, bigint>();
  let totalStake = 0n;
  for (const [writer, { outcomeKey }] of tally) {
    const stake = stakeByWriter.get(writer) ?? 0n;
    writersFor.set(outcomeKey, (writersFor.get(outcomeKey) ?? 0) + 1);
    stakeFor.set(outcomeKey, (stakeFor.get(outcomeKey) ?? 0n) + stake);
    totalStake += stake;
  }

  const [wNum, wDen] = config.writerRatio;
  const [sNum, sDen] = config.stakeRatio;
  // Deterministic iteration for a stable answer.
  for (const outcome of [...writersFor.keys()].sort()) {
    const w = writersFor.get(outcome)!;
    const s = stakeFor.get(outcome) ?? 0n;
    const writersOk = w >= config.minWriters && w * wDen >= wNum * totalWriters;
    const stakeOk = s * BigInt(sDen) >= BigInt(sNum) * totalStake;
    if (writersOk && stakeOk) return outcome;
  }
  return null;
}

export type Resolution =
  | { readonly status: "open" }
  | { readonly status: "provisional"; readonly outcomeKey: string; readonly quorumAt: number; readonly finalizesAt: number }
  | { readonly status: "resolved"; readonly outcomeKey: string; readonly quorumAt: number }
  | { readonly status: "voided"; readonly reason: string };

export interface ResolveInput {
  readonly events: readonly AttestationEvent[];
  readonly stakeByWriter: ReadonlyMap<string, bigint>;
  readonly now: number;
  readonly disputeWindowMs: number;
  readonly config?: QuorumConfig;
}

/**
 * Replay the attestation log in time order to find when a quorum first formed,
 * then apply the dispute window: a counter-quorum (a different outcome reaching
 * quorum) before finalization voids the market.
 */
export function resolveMarket(input: ResolveInput): Resolution {
  const config = input.config ?? DEFAULT_QUORUM;
  const ordered = [...input.events].sort((a, b) =>
    a.ts !== b.ts ? a.ts - b.ts : a.writer < b.writer ? -1 : a.writer > b.writer ? 1 : 0,
  );

  const tally = new Map<string, Attestation>();
  let quorumOut: string | null = null;
  let quorumAt = 0;

  for (const e of ordered) {
    tally.set(e.writer, { outcomeKey: e.outcomeKey, ts: e.ts });
    const current = quorumOutcome(tally, input.stakeByWriter, config);
    if (current === null) continue;

    if (quorumOut === null) {
      quorumOut = current;
      quorumAt = e.ts;
    } else if (current !== quorumOut && e.ts <= quorumAt + input.disputeWindowMs) {
      // A different outcome reached quorum within the window → dispute → void.
      return { status: "voided", reason: `counter-quorum for ${current} disputed ${quorumOut}` };
    }
  }

  if (quorumOut === null) return { status: "open" };
  const finalizesAt = quorumAt + input.disputeWindowMs;
  if (input.now >= finalizesAt) return { status: "resolved", outcomeKey: quorumOut, quorumAt };
  return { status: "provisional", outcomeKey: quorumOut, quorumAt, finalizesAt };
}
