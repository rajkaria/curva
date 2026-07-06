/**
 * Self-custodial settlement: each peer signs only the transfers it owes, from
 * its own wallet, and appends a receipt (txid) to the log. No custodian ever
 * holds the pot. The transfer set is deterministic, so line indices agree on
 * every peer and the "everyone's square" checklist fills identically for all.
 */
import type { Transfer } from "./netting.js";

/** The minimal capability the settler needs — implemented by WDK (real) or the fake. */
export interface WalletAdapter {
  address(): string;
  /** Spendable USDt balance in micros. */
  balance(): Promise<bigint>;
  /** Broadcast a USDt transfer; resolves to the txid. */
  transfer(to: string, amount: bigint): Promise<string>;
}

export interface SettlementReceipt {
  /** Index into the canonical transfer manifest — the log's `manifestLine`. */
  readonly line: number;
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
  /** Chain txid, or "" for a dry run. */
  readonly txid: string;
}

/** Canonical, stable ordering of a transfer set so every peer indexes it the same. */
export function settlementManifest(transfers: readonly Transfer[]): Transfer[] {
  return [...transfers].sort((a, b) =>
    a.from !== b.from
      ? a.from < b.from
        ? -1
        : 1
      : a.to !== b.to
        ? a.to < b.to
          ? -1
          : 1
        : a.amount < b.amount
          ? -1
          : a.amount > b.amount
            ? 1
            : 0,
  );
}

export interface SettleOptions {
  /** Compute the receipts a peer would emit without moving any money. */
  readonly dryRun?: boolean;
}

/** Settle every transfer this wallet owes; returns one receipt per paid line. */
export async function settleMyDebts(
  manifest: readonly Transfer[],
  wallet: WalletAdapter,
  options: SettleOptions = {},
): Promise<SettlementReceipt[]> {
  const me = wallet.address();
  const mine = manifest
    .map((transfer, line) => ({ transfer, line }))
    .filter(({ transfer }) => transfer.from === me);

  if (mine.length === 0) return [];

  const owed = mine.reduce((sum, { transfer }) => sum + transfer.amount, 0n);
  const available = await wallet.balance();
  if (available < owed) {
    throw new Error(
      `insufficient balance: owe ${owed} micros USDt but hold ${available}`,
    );
  }

  const receipts: SettlementReceipt[] = [];
  for (const { transfer, line } of mine) {
    const txid = options.dryRun ? "" : await wallet.transfer(transfer.to, transfer.amount);
    receipts.push({ line, from: transfer.from, to: transfer.to, amount: transfer.amount, txid });
  }
  return receipts;
}
