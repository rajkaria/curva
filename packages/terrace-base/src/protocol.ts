/**
 * The entire wire format — every message a peer appends to its own input core.
 *
 * A message is a signed, schema-versioned JSON node. The signature covers a
 * canonical serialization of the message with the `sig` field removed, so any
 * peer can recover the author and verify authenticity offline. Amounts are
 * bigint USDt micros and are serialized as decimal strings (JSON has no bigint)
 * — the canonical form is what gets hashed, so encode/decode is lossless and
 * deterministic on every peer.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { recoverSigner, signDigest } from "./identity.js";

export type Hex = string;
export type EpochMs = number;
export type MicroUsdt = bigint;

export type MarketKind =
  | "match-result"
  | "total-goals"
  | "goal-in-window"
  | "first-scorer"
  | "correct-score";

export interface MarketParams {
  /** Human label, e.g. "France vs Brazil — Result". */
  readonly title: string;
  /** The valid outcome keys for this market, in display order. */
  readonly outcomes: readonly string[];
  /** Free-form kind-specific metadata (line value, window index, squad list…). */
  readonly meta?: Readonly<Record<string, string | number>>;
}

interface Base {
  readonly v: 1;
  /** Compressed idKey of the author; the signature must recover to this. */
  readonly author: Hex;
  /** Author wall-clock at creation (ms). Used by the belt-and-braces fence. */
  readonly ts: EpochMs;
  readonly sig: Hex;
}

export interface HelloMsg extends Base {
  readonly t: "hello";
  readonly name: string;
  readonly walletAddr: string;
}

export interface MarketMsg extends Base {
  readonly t: "market";
  readonly marketId: string;
  readonly kind: MarketKind;
  readonly params: MarketParams;
  readonly cutoffAt: EpochMs;
  readonly feeBps: number;
}

export interface BetMsg extends Base {
  readonly t: "bet";
  readonly marketId: string;
  readonly outcomeKey: string;
  readonly amount: MicroUsdt;
  readonly nonce: string;
  readonly escrowTxid?: string;
}

export interface LockMsg extends Base {
  readonly t: "lock";
  readonly marketId: string;
}

export interface AttestMsg extends Base {
  readonly t: "attest";
  readonly marketId: string;
  readonly outcomeKey: string;
  readonly evidence?: { readonly asrScore?: string; readonly confidence: number };
}

export interface ReceiptMsg extends Base {
  readonly t: "receipt";
  readonly marketId: string;
  readonly manifestLine: number;
  readonly txid: string;
}

export interface ChatMsg extends Base {
  readonly t: "chat";
  readonly text: string;
  readonly lang: string;
}

export type Msg =
  | HelloMsg
  | MarketMsg
  | BetMsg
  | LockMsg
  | AttestMsg
  | ReceiptMsg
  | ChatMsg;

/** `Omit` distributed over a union — omitting from `Msg` directly collapses to common keys. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A protocol message minus its signature — the input to {@link signMessage}. */
export type UnsignedMsg = DistributiveOmit<Msg, "sig">;

/**
 * Deterministic canonical JSON: keys sorted at every level, bigints as decimal
 * strings, the `sig` field dropped. This exact string is what gets signed and
 * hashed, so it must be byte-identical on every peer.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, true);
}

function serialize(value: unknown, dropSig: boolean): string {
  if (typeof value === "bigint") return `"${value.toString()}"`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => serialize(v, false)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => !(dropSig && k === "sig") && obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k], false)}`).join(",")}}`;
}

/** keccak-256 digest (hex) of the canonical, sig-stripped message. */
export function messageDigest(msg: Record<string, unknown>): string {
  return bytesToHex(keccak_256(utf8ToBytes(canonicalize(msg))));
}

export function signMessage(unsigned: UnsignedMsg, privKey: string): Msg {
  const sig = signDigest(messageDigest(unsigned as Record<string, unknown>), privKey);
  return { ...(unsigned as object), sig } as Msg;
}

export function verifyMessage(msg: Msg): boolean {
  const recovered = recoverSigner(messageDigest(msg as unknown as Record<string, unknown>), msg.sig);
  return recovered !== null && recovered === msg.author;
}
