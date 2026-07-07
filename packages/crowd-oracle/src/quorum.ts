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

/** Where one outcome stands against the dual-⅔ thresholds, right now. */
export interface OutcomeTally {
  readonly outcomeKey: string;
  /** Distinct writers currently attesting this outcome. */
  readonly writers: number;
  /** Their summed bet stake (micros). */
  readonly stake: bigint;
  /** ≥minWriters AND ≥writerRatio of all attesting writers. */
  readonly writersOk: boolean;
  /** ≥stakeRatio of all attesting stake. */
  readonly stakeOk: boolean;
  /** Both thresholds met — this outcome would resolve. */
  readonly meetsQuorum: boolean;
}

/** The full standings of an attestation tally against the quorum thresholds. */
export interface TallyBreakdown {
  readonly totalWriters: number;
  readonly totalStake: bigint;
  readonly minWriters: number;
  readonly stakeRatio: readonly [number, number];
  readonly writerRatio: readonly [number, number];
  /** One row per attested outcome, sorted by key (deterministic). */
  readonly outcomes: readonly OutcomeTally[];
  /** The outcome that meets the dual quorum, or null. */
  readonly quorumOutcome: string | null;
}

/**
 * Score a tally against the dual thresholds, per outcome. This is the single
 * place the ⅔/⅔/minWriters rule is evaluated — {@link quorumOutcome} and the
 * UI's progress card both read it, so the picture the crowd sees can never
 * drift from the rule that actually resolves the money.
 */
export function tallyBreakdown(
  tally: ReadonlyMap<string, Attestation>,
  stakeByWriter: ReadonlyMap<string, bigint>,
  config: QuorumConfig = DEFAULT_QUORUM,
): TallyBreakdown {
  const writersFor = new Map<string, number>();
  const stakeFor = new Map<string, bigint>();
  let totalStake = 0n;
  for (const [writer, { outcomeKey }] of tally) {
    const stake = stakeByWriter.get(writer) ?? 0n;
    writersFor.set(outcomeKey, (writersFor.get(outcomeKey) ?? 0) + 1);
    stakeFor.set(outcomeKey, (stakeFor.get(outcomeKey) ?? 0n) + stake);
    totalStake += stake;
  }

  const totalWriters = tally.size;
  const [wNum, wDen] = config.writerRatio;
  const [sNum, sDen] = config.stakeRatio;
  let quorum: string | null = null;
  const outcomes: OutcomeTally[] = [...writersFor.keys()].sort().map((outcome) => {
    const writers = writersFor.get(outcome)!;
    const stake = stakeFor.get(outcome) ?? 0n;
    const writersOk = writers >= config.minWriters && writers * wDen >= wNum * totalWriters;
    const stakeOk = stake * BigInt(sDen) >= BigInt(sNum) * totalStake;
    const meetsQuorum = writersOk && stakeOk;
    if (meetsQuorum && quorum === null) quorum = outcome;
    return { outcomeKey: outcome, writers, stake, writersOk, stakeOk, meetsQuorum };
  });

  return {
    totalWriters,
    totalStake,
    minWriters: config.minWriters,
    stakeRatio: config.stakeRatio,
    writerRatio: config.writerRatio,
    outcomes,
    quorumOutcome: quorum,
  };
}

/** The outcome that currently meets the dual quorum, or null. */
export function quorumOutcome(
  tally: ReadonlyMap<string, Attestation>,
  stakeByWriter: ReadonlyMap<string, bigint>,
  config: QuorumConfig,
): string | null {
  if (tally.size === 0) return null;
  return tallyBreakdown(tally, stakeByWriter, config).quorumOutcome;
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
 * Replay the attestation log to find when a quorum first formed, then apply the
 * dispute window: a counter-quorum (a different outcome reaching quorum) before
 * finalization voids the market.
 *
 * Events are replayed in timestamp *batches*, not one at a time: quorum is a
 * property of the whole tally at a point in time, so all attestations sharing a
 * timestamp are applied together before quorum is evaluated. This is essential
 * for the stake threshold — evaluating mid-batch could latch a quorum off a
 * partial tally (e.g. three equal-stake voters at 100%) before a large late
 * stake in the same instant is counted, and would make the result depend on the
 * order same-timestamp events happen to be stored in.
 */
export function resolveMarket(input: ResolveInput): Resolution {
  const config = input.config ?? DEFAULT_QUORUM;
  const ordered = [...input.events].sort((a, b) =>
    a.ts !== b.ts ? a.ts - b.ts : a.writer < b.writer ? -1 : a.writer > b.writer ? 1 : 0,
  );

  const tally = new Map<string, Attestation>();
  let quorumOut: string | null = null;
  let quorumAt = 0;
  let i = 0;

  while (i < ordered.length) {
    const ts = ordered[i]!.ts;
    // Apply every attestation stamped at this instant before evaluating.
    while (i < ordered.length && ordered[i]!.ts === ts) {
      const e = ordered[i]!;
      tally.set(e.writer, { outcomeKey: e.outcomeKey, ts: e.ts });
      i++;
    }
    const current = quorumOutcome(tally, input.stakeByWriter, config);
    if (current === null) continue;

    if (quorumOut === null) {
      quorumOut = current;
      quorumAt = ts;
    } else if (current !== quorumOut && ts <= quorumAt + input.disputeWindowMs) {
      // A different outcome reached quorum within the window → dispute → void.
      return { status: "voided", reason: `counter-quorum for ${current} disputed ${quorumOut}` };
    }
  }

  if (quorumOut === null) return { status: "open" };
  const finalizesAt = quorumAt + input.disputeWindowMs;
  if (input.now >= finalizesAt) return { status: "resolved", outcomeKey: quorumOut, quorumAt };
  return { status: "provisional", outcomeKey: quorumOut, quorumAt, finalizesAt };
}
