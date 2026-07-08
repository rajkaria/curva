/**
 * Threshold co-signing of escrow payouts.
 *
 * A payout from escrow is authorized only when ≥ threshold distinct stewards
 * sign the exact payout instruction (marketId, line, recipient, amount) with
 * their Curva identity keys. Reuses the protocol's secp256k1/keccak signing, so a
 * steward's escrow authority is the same key it signs bets with — no new trust
 * root. This is the honest 2-of-3 primitive; true t-of-n threshold signing
 * (FROST/MuSig2) is the SwarmVault vision (Tier 3), specced not shipped.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalize, signDigest, recoverSigner, type Identity } from "@curva/terrace-base";
import type { StewardSet } from "./election.js";

export interface PayoutInstruction {
  readonly marketId: string;
  readonly line: number;
  readonly to: string;
  readonly amount: bigint;
}

export interface StewardSignature {
  readonly signer: string; // idKey
  readonly sig: string;
}

export interface CoSignResult {
  readonly instruction: PayoutInstruction;
  readonly authorized: boolean;
  /** Distinct stewards whose signatures validated, sorted. */
  readonly signers: readonly string[];
}

export function payoutInstructionDigest(instruction: PayoutInstruction): string {
  return bytesToHex(keccak_256(utf8ToBytes(canonicalize(instruction))));
}

export function signPayout(instruction: PayoutInstruction, identity: Identity): StewardSignature {
  return { signer: identity.idKey, sig: signDigest(payoutInstructionDigest(instruction), identity.privKey) };
}

/** Validate signatures against the steward set; authorized iff ≥ threshold distinct stewards signed. */
export function coSignPayout(
  instruction: PayoutInstruction,
  signatures: readonly StewardSignature[],
  set: StewardSet,
): CoSignResult {
  const digest = payoutInstructionDigest(instruction);
  const valid = new Set<string>();
  for (const { sig } of signatures) {
    const recovered = recoverSigner(digest, sig);
    if (recovered !== null && set.stewards.includes(recovered)) valid.add(recovered);
  }
  const signers = [...valid].sort();
  return { instruction, authorized: signers.length >= set.threshold, signers };
}
