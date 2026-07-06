/**
 * Steward election — deterministic and identical on every peer.
 *
 * For bigger/looser groups than Mates Mode, the swarm elects a 2-of-3 signer
 * set: the market opener plus the two largest stakers. Ties break by idKey so
 * every peer computes the same set from the same view — no coordination, no
 * distinguished authority beyond "opener + whoever has the most skin in it".
 */
export interface StewardSet {
  readonly stewards: readonly string[]; // idKeys
  readonly threshold: number;
}

export function electStewards(opener: string, stakeByWriter: ReadonlyMap<string, bigint>): StewardSet {
  const participants = new Set(stakeByWriter.keys());
  participants.add(opener);
  if (participants.size < 3) {
    throw new Error("steward escrow needs at least 3 participants");
  }

  const others = [...participants]
    .filter((id) => id !== opener)
    .sort((a, b) => {
      const sa = stakeByWriter.get(a) ?? 0n;
      const sb = stakeByWriter.get(b) ?? 0n;
      return sa !== sb ? (sa > sb ? -1 : 1) : a < b ? -1 : 1;
    });

  const stewards = [opener, others[0]!, others[1]!].sort();
  return { stewards, threshold: 2 };
}
