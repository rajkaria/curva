/**
 * @tifo/market-kernel — the pure parimutuel core.
 *
 * Ported from the Hunch production payout engine (computeMarketPayouts,
 * settling real USDC on Base since June 2026) and adapted for a P2P market
 * with no treasury:
 *
 * - N-way outcome keys (HOME/DRAW/AWAY, ladders, scorer lists…)
 * - amounts are bigint USDt micros — no floats anywhere near money
 * - EXACT conservation: sum(payouts) + sum(fees) === sum(stakes), always.
 *   Hunch floors per-winner and lets the treasury keep the sub-micro dust;
 *   TIFO has no treasury, so the dust is distributed deterministically
 *   (largest-remainder, ties by bettorId) and the books balance to the micro.
 * - no-winning-stake resolves to a full refund (Hunch retains the pool for
 *   the treasury; a P2P market has nowhere to retain it)
 * - void / single-participant → full gross refund (Hunch semantics, ported)
 *
 * Zero I/O. Deterministic: identical inputs (in any order) produce an
 * identical manifest on every peer — this is the CRDT claim the property
 * suite proves.
 */

/** USDt micros (1 USDt = 1_000_000n). */
export type MicroUsdt = bigint;

/** A bet as the kernel needs it — already validated/deduped by terrace-base. */
export interface Bet {
  /** Unique per market (the message nonce). Duplicates are a caller bug. */
  readonly betId: string;
  /** Stable peer identity (identity-key hex in production). */
  readonly bettorId: string;
  readonly outcomeKey: string;
  /** Gross stake in USDt micros. Must be > 0. */
  readonly stake: MicroUsdt;
}

export interface OutcomePool {
  readonly gross: MicroUsdt;
  readonly fee: MicroUsdt;
  readonly net: MicroUsdt;
  readonly betCount: number;
}

export interface MarketPools {
  readonly feeBps: number;
  readonly grossTotal: MicroUsdt;
  readonly feeTotal: MicroUsdt;
  readonly netTotal: MicroUsdt;
  /** Keys sorted ascending — identical iteration order on every peer. */
  readonly outcomes: Readonly<Record<string, OutcomePool>>;
  /** Distinct bettors, sorted ascending. */
  readonly bettorIds: readonly string[];
}

export interface OutcomeOdds {
  /** Pool-implied probability (net outcome stake / net total). Display only. */
  readonly probability: number;
  /** Pool-implied decimal odds (net total / net outcome stake); null if unbacked. */
  readonly decimalOdds: number | null;
}

export type Resolution =
  | { readonly kind: "outcome"; readonly outcomeKey: string }
  | { readonly kind: "void" };

export type PayoutReason =
  | "resolved"
  | "voided"
  | "single-participant"
  | "no-winning-stake";

export interface PayoutLine {
  readonly bettorId: string;
  readonly kind: "winnings" | "refund";
  /** The gross stake this line covers (winning-side stake for winnings). */
  readonly stake: MicroUsdt;
  /** Amount owed to the bettor in USDt micros. */
  readonly amount: MicroUsdt;
}

export interface PayoutManifest {
  readonly resolution: Resolution;
  readonly reason: PayoutReason;
  readonly feeBps: number;
  readonly grossTotal: MicroUsdt;
  /** Fees actually retained. Always 0 on refund paths — refunds are gross. */
  readonly feeTotal: MicroUsdt;
  readonly payoutTotal: MicroUsdt;
  /** Sorted by bettorId ascending. */
  readonly lines: readonly PayoutLine[];
}

const BPS_DENOMINATOR = 10_000n;

function assertFeeBps(feeBps: number): void {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new RangeError(`feeBps must be an integer in [0, 10000], got ${feeBps}`);
  }
}

function assertBets(bets: readonly Bet[]): void {
  const seen = new Set<string>();
  for (const bet of bets) {
    if (typeof bet.stake !== "bigint" || bet.stake <= 0n) {
      throw new RangeError(`bet ${bet.betId}: stake must be a positive bigint`);
    }
    if (seen.has(bet.betId)) {
      throw new Error(`duplicate betId ${bet.betId}`);
    }
    seen.add(bet.betId);
  }
}

function feeFor(stake: MicroUsdt, feeBps: number): MicroUsdt {
  return (stake * BigInt(feeBps)) / BPS_DENOMINATOR; // bigint division floors
}

function sortedRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    out[key] = value;
  }
  return out;
}

/** Fold bets into per-outcome pool aggregates. */
export function buildPools(bets: readonly Bet[], feeBps = 0): MarketPools {
  assertFeeBps(feeBps);
  assertBets(bets);

  const outcomes = new Map<string, { gross: bigint; fee: bigint; net: bigint; betCount: number }>();
  const bettors = new Set<string>();
  let grossTotal = 0n;
  let feeTotal = 0n;

  for (const bet of bets) {
    const fee = feeFor(bet.stake, feeBps);
    const pool = outcomes.get(bet.outcomeKey) ?? { gross: 0n, fee: 0n, net: 0n, betCount: 0 };
    pool.gross += bet.stake;
    pool.fee += fee;
    pool.net += bet.stake - fee;
    pool.betCount += 1;
    outcomes.set(bet.outcomeKey, pool);
    bettors.add(bet.bettorId);
    grossTotal += bet.stake;
    feeTotal += fee;
  }

  return {
    feeBps,
    grossTotal,
    feeTotal,
    netTotal: grossTotal - feeTotal,
    outcomes: sortedRecord(outcomes),
    bettorIds: [...bettors].sort(),
  };
}

/** Merge two partial pool folds (partition/heal). feeBps must match. */
export function mergePools(a: MarketPools, b: MarketPools): MarketPools {
  if (a.feeBps !== b.feeBps) {
    throw new Error(`cannot merge pools with different feeBps (${a.feeBps} vs ${b.feeBps})`);
  }

  const outcomes = new Map<string, { gross: bigint; fee: bigint; net: bigint; betCount: number }>();
  for (const pools of [a, b]) {
    for (const [key, pool] of Object.entries(pools.outcomes)) {
      const merged = outcomes.get(key) ?? { gross: 0n, fee: 0n, net: 0n, betCount: 0 };
      merged.gross += pool.gross;
      merged.fee += pool.fee;
      merged.net += pool.net;
      merged.betCount += pool.betCount;
      outcomes.set(key, merged);
    }
  }

  return {
    feeBps: a.feeBps,
    grossTotal: a.grossTotal + b.grossTotal,
    feeTotal: a.feeTotal + b.feeTotal,
    netTotal: a.netTotal + b.netTotal,
    outcomes: sortedRecord(outcomes),
    bettorIds: [...new Set([...a.bettorIds, ...b.bettorIds])].sort(),
  };
}

/** Pool-implied odds per outcome. Floats — display only, never money. */
export function impliedOdds(pools: MarketPools): Record<string, OutcomeOdds> {
  const odds = new Map<string, OutcomeOdds>();
  for (const [key, pool] of Object.entries(pools.outcomes)) {
    if (pools.netTotal === 0n || pool.net === 0n) {
      odds.set(key, { probability: 0, decimalOdds: null });
    } else {
      odds.set(key, {
        probability: Number(pool.net) / Number(pools.netTotal),
        decimalOdds: Number(pools.netTotal) / Number(pool.net),
      });
    }
  }
  return sortedRecord(odds);
}

function refundManifest(
  bets: readonly Bet[],
  resolution: Resolution,
  reason: PayoutReason,
  feeBps: number,
  grossTotal: MicroUsdt,
): PayoutManifest {
  const grossByBettor = new Map<string, bigint>();
  for (const bet of bets) {
    grossByBettor.set(bet.bettorId, (grossByBettor.get(bet.bettorId) ?? 0n) + bet.stake);
  }
  const lines: PayoutLine[] = [...grossByBettor.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bettorId, gross]) => ({ bettorId, kind: "refund", stake: gross, amount: gross }));

  return { resolution, reason, feeBps, grossTotal, feeTotal: 0n, payoutTotal: grossTotal, lines };
}

/** Compute the settlement manifest for a resolved (or voided) market. */
export function computePayouts(input: {
  readonly bets: readonly Bet[];
  readonly resolution: Resolution;
  readonly feeBps?: number;
}): PayoutManifest {
  const { bets, resolution } = input;
  const feeBps = input.feeBps ?? 0;
  assertFeeBps(feeBps);
  assertBets(bets);

  const grossTotal = bets.reduce((sum, bet) => sum + bet.stake, 0n);

  if (resolution.kind === "void") {
    return refundManifest(bets, resolution, "voided", feeBps, grossTotal);
  }
  if (new Set(bets.map((b) => b.bettorId)).size < 2) {
    return refundManifest(bets, resolution, "single-participant", feeBps, grossTotal);
  }

  // Winners: per-bettor gross + net stake on the resolved outcome.
  const winners = new Map<string, { gross: bigint; net: bigint }>();
  let feeTotal = 0n;
  let winningNetTotal = 0n;
  for (const bet of bets) {
    const fee = feeFor(bet.stake, feeBps);
    feeTotal += fee;
    if (bet.outcomeKey !== resolution.outcomeKey) continue;
    const entry = winners.get(bet.bettorId) ?? { gross: 0n, net: 0n };
    entry.gross += bet.stake;
    entry.net += bet.stake - fee;
    winners.set(bet.bettorId, entry);
    winningNetTotal += bet.stake - fee;
  }

  if (winningNetTotal === 0n) {
    return refundManifest(bets, resolution, "no-winning-stake", feeBps, grossTotal);
  }

  // Pro-rata floor split of the net pool, then distribute the sub-micro
  // remainder by largest remainder (ties → lower bettorId) so the pool is
  // exhausted exactly.
  const netPool = grossTotal - feeTotal;
  const shares = [...winners.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bettorId, { gross, net }]) => ({
      bettorId,
      gross,
      base: (netPool * net) / winningNetTotal,
      remainder: (netPool * net) % winningNetTotal,
    }));

  let dust = netPool - shares.reduce((sum, s) => sum + s.base, 0n);
  const byRemainder = [...shares].sort(
    (a, b) => (a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.bettorId < b.bettorId ? -1 : 1),
  );
  const extra = new Map<string, bigint>();
  for (const share of byRemainder) {
    if (dust === 0n) break;
    extra.set(share.bettorId, 1n);
    dust -= 1n;
  }

  const lines: PayoutLine[] = shares.map(({ bettorId, gross, base }) => ({
    bettorId,
    kind: "winnings",
    stake: gross,
    amount: base + (extra.get(bettorId) ?? 0n),
  }));

  return {
    resolution,
    reason: "resolved",
    feeBps,
    grossTotal,
    feeTotal,
    payoutTotal: netPool,
    lines,
  };
}
