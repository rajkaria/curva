/**
 * EVM address derivation + EIP-55 checksumming — pure, matches WDK/Ethereum so
 * a TIFO wallet address is byte-for-byte what a block explorer and any wallet
 * will show for the same seed.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

function normalizeHex(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2).toLowerCase() : hex.toLowerCase();
}

/** Compressed or uncompressed secp256k1 pubkey hex → EIP-55 checksummed 0x address. */
export function pubkeyToEvmAddress(pubkeyHex: string): string {
  const point = secp256k1.ProjectivePoint.fromHex(normalizeHex(pubkeyHex));
  const uncompressed = point.toRawBytes(false); // 65 bytes, 0x04 prefix
  const hash = keccak_256(uncompressed.slice(1)); // drop the 0x04 prefix
  return toChecksumAddress("0x" + bytesToHex(hash.slice(-20)));
}

/** Apply the EIP-55 mixed-case checksum to a 0x hex address. */
export function toChecksumAddress(address: string): string {
  const lower = normalizeHex(address);
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  }
  return out;
}

export function privKeyToAddress(privKeyHex: string): string {
  return pubkeyToEvmAddress(bytesToHex(secp256k1.getPublicKey(hexToBytes(normalizeHex(privKeyHex)), true)));
}
