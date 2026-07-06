/**
 * TIFO identity primitive — secp256k1 over keccak-256 digests.
 *
 * The identity key is the root of trust for the whole protocol: it signs every
 * log message and it is what a peer custodies (derived from the WDK seed at
 * `m/44'/60'/0'/0/1`, see @tifo/wdk-vault). It is deliberately a secp256k1 key
 * so it is the same primitive WDK uses for the USDt wallet — one seed, one
 * curve, identity and money from the same self-custodial root.
 *
 * `idKey` is the 33-byte compressed public key as lowercase hex. Signatures are
 * 65-byte recoverable compact hex (r‖s‖recovery), so any peer can recover the
 * signer from the signature alone — the fold binds authorship cryptographically
 * with no trusted mapping table.
 *
 * Pure: no network, no disk. Runs identically under Node, Bare, and Pear.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils";

export interface Identity {
  /** 32-byte private key, hex. Never leaves the device. */
  readonly privKey: string;
  /** 33-byte compressed public key, lowercase hex. The on-wire identity. */
  readonly idKey: string;
}

function normalizeHex(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2).toLowerCase() : hex.toLowerCase();
}

export function identityFromPrivateKey(privKey: string): Identity {
  const priv = normalizeHex(privKey);
  const idKey = bytesToHex(secp256k1.getPublicKey(hexToBytes(priv), true));
  return { privKey: priv, idKey };
}

export function randomIdentity(): Identity {
  return identityFromPrivateKey(bytesToHex(randomBytes(32)));
}

/** Sign a hex keccak-256 digest, returning a 65-byte recoverable compact sig hex. */
export function signDigest(digestHex: string, privKey: string): string {
  const sig = secp256k1.sign(normalizeHex(digestHex), normalizeHex(privKey));
  const recovery = sig.recovery ?? 0;
  return sig.toCompactHex() + recovery.toString(16).padStart(2, "0");
}

/** Recover the signer's idKey from a digest + recoverable signature, or null if malformed. */
export function recoverSigner(digestHex: string, sigHex: string): string | null {
  try {
    const raw = normalizeHex(sigHex);
    if (raw.length !== 130) return null;
    const recovery = parseInt(raw.slice(128, 130), 16);
    if (recovery !== 0 && recovery !== 1) return null;
    const sig = secp256k1.Signature.fromCompact(raw.slice(0, 128)).addRecoveryBit(recovery);
    const point = sig.recoverPublicKey(normalizeHex(digestHex));
    return point.toHex(true);
  } catch {
    return null;
  }
}

/** Verify a signature was produced by `idKey` over `digestHex`. */
export function verifyDigest(digestHex: string, sigHex: string, idKey: string): boolean {
  const recovered = recoverSigner(digestHex, sigHex);
  return recovered !== null && recovered === normalizeHex(idKey);
}
