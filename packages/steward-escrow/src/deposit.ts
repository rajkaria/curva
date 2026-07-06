/**
 * Per-peer on-chain deposit verification.
 *
 * In escrow mode a bet only counts once its USDt deposit to the escrow address
 * is confirmed on-chain — and every peer checks this independently before the
 * bet enters its pools, so no one takes the opener's word for it. The chain read
 * is behind an adapter: {@link FakeEscrowChain} for tests and offline demo, a
 * lazy real reader against the WDK provider in production.
 */
export interface DepositRecord {
  readonly to: string;
  readonly from: string;
  readonly amount: bigint;
}

export interface EscrowChain {
  /** Look up a settled USDt transfer by txid, or null if not found/confirmed. */
  getDeposit(txid: string): Promise<DepositRecord | null>;
}

export class FakeEscrowChain implements EscrowChain {
  constructor(private readonly deposits: Readonly<Record<string, DepositRecord>>) {}
  async getDeposit(txid: string): Promise<DepositRecord | null> {
    return this.deposits[txid] ?? null;
  }
}

export interface BetDeposit {
  readonly escrowTxid: string;
  readonly stake: bigint;
  readonly escrowAddress: string;
}

/** True iff a confirmed deposit of ≥ stake reached the escrow address. */
export async function verifyBetDeposit(bet: BetDeposit, chain: EscrowChain): Promise<boolean> {
  const dep = await chain.getDeposit(bet.escrowTxid);
  if (!dep) return false;
  if (dep.to.toLowerCase() !== bet.escrowAddress.toLowerCase()) return false;
  return dep.amount >= bet.stake;
}
