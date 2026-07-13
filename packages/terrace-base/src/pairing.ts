/**
 * Pairing handshake (S15, U8) — kills the paste-a-hex-key pairing pain.
 *
 * The joiner already opens a Hyperswarm connection to the opener to replicate.
 * This module defines the one extra message that rides that connection on its
 * own protomux channel (`curva/pair`, never the log): a signed request carrying
 * the joiner's Autobase writer key and display name. The opener's UI shows
 * "Approve fan-a3f2?" and one tap calls the existing `addWriter` — the same
 * spec-sanctioned authorization as before, minus the hand-copied hex.
 *
 * Trust: the request is signed by the joiner's *identity* key over the same
 * canonicalization as every log message, so the opener knows exactly which
 * identity asked before approving. Anything malformed or mis-signed validates
 * to null and is never surfaced. Approval stays a human decision; the invite
 * key is still the capability that lets a peer connect at all.
 */
import { messageDigest } from "./protocol.js";
import { recoverSigner, signDigest, type Identity } from "./identity.js";

export interface PairRequest {
  readonly v: 1;
  readonly t: "pair";
  /** The joiner's identity key (compressed secp256k1, hex) — the signer. */
  readonly author: string;
  /** The joiner's local Autobase writer key (32-byte hex) to authorize. */
  readonly writerKey: string;
  /** The joiner's display name, shown on the approval card (escaped there). */
  readonly name: string;
  readonly ts: number;
  readonly sig: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX66 = /^[0-9a-f]{66}$/;
const MAX_NAME = 40;

/** Build a signed pairing request for this identity + writer key. */
export function buildPairRequest(
  identity: Identity,
  writerKey: string,
  name: string,
  ts: number,
): PairRequest {
  const unsigned = { v: 1 as const, t: "pair" as const, author: identity.idKey, writerKey, name, ts };
  const sig = signDigest(messageDigest(unsigned), identity.privKey);
  return { ...unsigned, sig };
}

/**
 * Validate an untrusted wire payload into a {@link PairRequest}, or null.
 * Structural checks first (shape, hex formats, caps — hostile input dies
 * here), then the signature must recover to `author` over the same
 * canonicalization the log uses.
 */
export function validatePairRequest(raw: unknown): PairRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r["v"] !== 1 || r["t"] !== "pair") return null;
  const author = r["author"];
  const writerKey = r["writerKey"];
  const name = r["name"];
  const ts = r["ts"];
  const sig = r["sig"];
  if (typeof author !== "string" || !HEX66.test(author)) return null;
  if (typeof writerKey !== "string" || !HEX64.test(writerKey)) return null;
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_NAME) return null;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  if (typeof sig !== "string") return null;

  const unsigned = { v: 1, t: "pair", author, writerKey, name, ts };
  const recovered = recoverSigner(messageDigest(unsigned), sig);
  if (recovered === null || recovered !== author) return null;
  return { v: 1, t: "pair", author, writerKey, name, ts, sig };
}
