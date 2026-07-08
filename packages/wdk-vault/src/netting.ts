/**
 * Settlement is just netting.
 *
 * A resolved parimutuel market produces a payout manifest; combined with each
 * party's total stake it yields a per-party *delta*: winners are owed their net
 * winnings (positive), losers owe their whole stake (negative). Deltas sum to
 * zero (conservation), so the swarm settles like Splitwise: a greedy
 * max-debtor→max-creditor match produces the minimal transfer set — a 10-person
 * pool settles in ≤ 9 transfers, usually far fewer. No custodian: each debtor
 * signs their own USDt transfer from their own WDK wallet.
 *
 * Pure and deterministic (parties broken by name), so every peer computes the
 * identical transfer set and can watch "everyone's square" fill in the same way.
 */
import type { PayoutManifest } from "@curva/market-kernel";

export interface Transfer {
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
}

export interface DeltaOptions {
  /** Where a retained fee (feeBps > 0) is owed, so the ledger balances. */
  readonly feeRecipient?: string;
}

/** Per-party net position from a manifest + each party's total stake. */
export function computeDeltas(
  manifest: PayoutManifest,
  stakesByParty: ReadonlyMap<string, bigint>,
  options: DeltaOptions = {},
): Map<string, bigint> {
  const payoutByParty = new Map<string, bigint>();
  for (const line of manifest.lines) {
    payoutByParty.set(line.bettorId, (payoutByParty.get(line.bettorId) ?? 0n) + line.amount);
  }

  const deltas = new Map<string, bigint>();
  for (const [party, stake] of stakesByParty) {
    deltas.set(party, (payoutByParty.get(party) ?? 0n) - stake);
  }

  if (manifest.feeTotal > 0n) {
    if (!options.feeRecipient) {
      throw new Error("fee is retained but no feeRecipient given — the ledger would not balance");
    }
    deltas.set(options.feeRecipient, (deltas.get(options.feeRecipient) ?? 0n) + manifest.feeTotal);
  }

  return deltas;
}

/** Greedy minimal-transfer settlement of a zero-sum delta ledger. */
export function minTransfers(deltas: ReadonlyMap<string, bigint>): Transfer[] {
  const byAmountThenName = (a: [string, bigint], b: [string, bigint]) =>
    a[1] !== b[1] ? (a[1] > b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1;

  const creditors = [...deltas.entries()].filter(([, d]) => d > 0n).sort(byAmountThenName);
  const debtors = [...deltas.entries()]
    .filter(([, d]) => d < 0n)
    .map(([p, d]): [string, bigint] => [p, -d])
    .sort(byAmountThenName);

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const [creditor, owed] = creditors[ci]!;
    const [debtor, owes] = debtors[di]!;
    const amount = owed < owes ? owed : owes;
    if (amount > 0n) transfers.push({ from: debtor, to: creditor, amount });
    creditors[ci] = [creditor, owed - amount];
    debtors[di] = [debtor, owes - amount];
    if (creditors[ci]![1] === 0n) ci++;
    if (debtors[di]![1] === 0n) di++;
  }
  return transfers;
}
