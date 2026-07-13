/**
 * Seed at rest (S16 T4) — closes audit finding T4: the mnemonic sat plaintext
 * in localStorage. `sealVault` encrypts it under a passphrase with
 * scrypt (KDF, ~100ms on desktop at the default cost) + XChaCha20-Poly1305
 * (AEAD), both from the audited noble family already in the dependency tree.
 *
 * The sealed blob is a versioned string — `v1:scrypt:xchacha:<logN>:<salt>:
 * <nonce>:<ciphertext>` — so a future kdf/cipher can migrate old blobs by
 * prefix. Opening with the wrong passphrase fails *closed*: Poly1305
 * authentication throws, it never returns garbage that could be mistaken for
 * a seed. The unencrypted path remains the labelled demo default; sealing is
 * opt-in at the app layer.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { scrypt } from "@noble/hashes/scrypt";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils";

const VERSION = "v1:scrypt:xchacha";
/** Default scrypt cost — 2^15, r=8, p=1: ~100ms on a desktop, ~33 MB. */
const DEFAULT_LOG_N = 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const NONCE_BYTES = 24; // XChaCha20's extended nonce

export interface SealOptions {
  /** scrypt cost exponent (N = 2^logN). Lower only in tests. */
  readonly logN?: number;
}

function deriveKey(passphrase: string, salt: Uint8Array, logN: number): Uint8Array {
  return scrypt(utf8ToBytes(passphrase), salt, { N: 2 ** logN, r: SCRYPT_R, p: SCRYPT_P, dkLen: 32 });
}

/** Encrypt a mnemonic under a passphrase → versioned sealed blob. */
export function sealVault(mnemonic: string, passphrase: string, options: SealOptions = {}): string {
  if (passphrase.length === 0) throw new Error("a sealing passphrase must not be empty");
  const logN = options.logN ?? DEFAULT_LOG_N;
  if (!Number.isInteger(logN) || logN < 10 || logN > 22) throw new Error("scrypt logN out of range");
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = deriveKey(passphrase, salt, logN);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(mnemonic));
  return [VERSION, String(logN), bytesToHex(salt), bytesToHex(nonce), bytesToHex(ciphertext)].join(":");
}

/** Decrypt a sealed blob. Throws on wrong passphrase, tampering, or bad format. */
export function openVault(sealed: string, passphrase: string): string {
  const parts = sealed.split(":");
  if (parts.length !== 7 || parts.slice(0, 3).join(":") !== VERSION) {
    throw new Error("unrecognized sealed-vault format");
  }
  const [, , , logNStr, saltHex, nonceHex] = parts;
  const ctHex = parts[6]!;
  const logN = Number(logNStr);
  if (!Number.isInteger(logN) || logN < 10 || logN > 22) throw new Error("scrypt logN out of range");
  const key = deriveKey(passphrase, hexToBytes(saltHex!), logN);
  const plain = xchacha20poly1305(key, hexToBytes(nonceHex!)).decrypt(hexToBytes(ctHex));
  return new TextDecoder().decode(plain);
}

/** True iff a stored string is a sealed blob (vs a plaintext demo mnemonic). */
export function isSealedVault(stored: string): boolean {
  return stored.startsWith(VERSION + ":");
}
