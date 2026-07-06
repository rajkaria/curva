/**
 * `apply` — the one deterministic fold, identical on every peer.
 *
 * It consumes an already-linearized list of signed messages and writes derived
 * rows into the view. Every honest peer that has replicated the same messages
 * runs this same fold and materializes a byte-identical view — that is the
 * whole convergence story. The only ordering primitive it relies on is the
 * cutoff fence (§6.2): a bet that linearizes after a market's first `lock` is
 * void, and "first" is well-defined because we process in linearized order.
 *
 * Rules, in order, per message (any failing rule → the message is silently
 * dropped, identically on every peer, so drops don't break convergence):
 *  - signature must recover to the message's `author`
 *  - every non-hello message requires the author to have a registered `hello`
 *  - `market`   — first market for an id wins; feeBps and outcomes validated
 *  - `bet`      — known market + valid outcome + positive amount + unused nonce
 *                 + market not yet locked + ts within cutoff+90s grace
 *  - `lock`     — first lock for a market sets the fence
 *  - `attest`   — valid outcome; latest attestation per writer wins
 *  - `receipt`  — first receipt per manifest line wins
 *  - `chat`     — recorded in log order
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { verifyMessage, type MarketKind, type MarketParams, type Msg } from "./protocol.js";
import { MemoryKV, prefix, type KV } from "./view.js";

/** Wall-clock grace past a market's cutoff before a bet is void regardless of order. */
export const FENCE_GRACE_MS = 90_000;

const SEQ_WIDTH = 12;
const padSeq = (n: number) => n.toString().padStart(SEQ_WIDTH, "0");

export interface IdentityRow {
  readonly name: string;
  readonly walletAddr: string;
}
export interface MarketRow {
  readonly marketId: string;
  readonly kind: MarketKind;
  readonly params: MarketParams;
  readonly cutoffAt: number;
  readonly feeBps: number;
  readonly opener: string;
  readonly createdAt: number;
}
export interface BetRow {
  readonly betId: string;
  readonly bettorId: string;
  readonly outcomeKey: string;
  readonly stake: bigint;
}
export interface AttestRow {
  readonly outcomeKey: string;
  readonly confidence: number;
  readonly ts: number;
  readonly asrScore?: string;
}

/** Fold an ordered message list into a fresh in-memory view. */
export async function foldMessages(messages: readonly Msg[]): Promise<MemoryKV> {
  const kv = new MemoryKV();
  let seq = 0;
  for (const msg of messages) {
    await applyMessage(kv, msg, seq);
    seq += 1;
  }
  return kv;
}

/** Apply one message at linearized index `seq`. Exported for the Autobase adapter. */
export async function applyMessage(kv: KV, msg: Msg, seq: number): Promise<void> {
  if (!verifyMessage(msg)) return;

  if (msg.t === "hello") {
    const key = `id!${msg.author}`;
    if ((await kv.get(key)) === undefined) {
      await kv.put(key, { name: msg.name, walletAddr: msg.walletAddr });
    }
    return;
  }

  // Every other message requires a registered author.
  if ((await kv.get(`id!${msg.author}`)) === undefined) return;

  switch (msg.t) {
    case "market": {
      const key = `mkt!${msg.marketId}`;
      if ((await kv.get(key)) !== undefined) return; // first market for this id wins
      if (!Number.isInteger(msg.feeBps) || msg.feeBps < 0 || msg.feeBps > 10_000) return;
      if (!Array.isArray(msg.params.outcomes) || msg.params.outcomes.length < 2) return;
      const row: MarketRow = {
        marketId: msg.marketId,
        kind: msg.kind,
        params: msg.params,
        cutoffAt: msg.cutoffAt,
        feeBps: msg.feeBps,
        opener: msg.author,
        createdAt: msg.ts,
      };
      await kv.put(key, row);
      return;
    }
    case "bet": {
      const market = (await kv.get(`mkt!${msg.marketId}`)) as MarketRow | undefined;
      if (!market) return;
      if (!market.params.outcomes.includes(msg.outcomeKey)) return;
      if (typeof msg.amount !== "bigint" || msg.amount <= 0n) return;
      const nonceKey = `betseen!${msg.marketId}!${msg.nonce}`;
      if ((await kv.get(nonceKey)) !== undefined) return; // dedup
      if ((await kv.get(`lock!${msg.marketId}`)) !== undefined) return; // fence: after first lock
      if (msg.ts > market.cutoffAt + FENCE_GRACE_MS) return; // belt-and-braces
      await kv.put(nonceKey, seq);
      await kv.put(`bet!${msg.marketId}!${padSeq(seq)}`, {
        betId: msg.nonce,
        bettorId: msg.author,
        outcomeKey: msg.outcomeKey,
        stake: msg.amount.toString(),
      });
      const poolKey = `pool!${msg.marketId}!${msg.outcomeKey}`;
      const cur = BigInt(((await kv.get(poolKey)) as string | undefined) ?? "0");
      await kv.put(poolKey, (cur + msg.amount).toString());
      return;
    }
    case "lock": {
      if ((await kv.get(`mkt!${msg.marketId}`)) === undefined) return;
      const key = `lock!${msg.marketId}`;
      if ((await kv.get(key)) === undefined) await kv.put(key, { seq, by: msg.author });
      return;
    }
    case "attest": {
      const market = (await kv.get(`mkt!${msg.marketId}`)) as MarketRow | undefined;
      if (!market || !market.params.outcomes.includes(msg.outcomeKey)) return;
      const row: AttestRow = {
        outcomeKey: msg.outcomeKey,
        confidence: msg.evidence?.confidence ?? 1,
        ts: msg.ts,
        ...(msg.evidence?.asrScore !== undefined ? { asrScore: msg.evidence.asrScore } : {}),
      };
      await kv.put(`attest!${msg.marketId}!${msg.author}`, row); // latest wins (current tally)
      await kv.put(`alog!${msg.marketId}!${padSeq(seq)}`, {
        writer: msg.author,
        outcomeKey: msg.outcomeKey,
        ts: msg.ts,
      }); // append-only history (dispute-window replay)
      return;
    }
    case "receipt": {
      if ((await kv.get(`mkt!${msg.marketId}`)) === undefined) return;
      const key = `paid!${msg.marketId}!${padSeq(msg.manifestLine)}`;
      if ((await kv.get(key)) === undefined) await kv.put(key, { txid: msg.txid, by: msg.author });
      return;
    }
    case "chat": {
      await kv.put(`chat!${padSeq(seq)}`, {
        author: msg.author,
        text: msg.text,
        lang: msg.lang,
        ts: msg.ts,
      });
      return;
    }
  }
}

// ── Readers ──────────────────────────────────────────────────────────────────

export async function readIdentities(kv: KV): Promise<Map<string, IdentityRow>> {
  const out = new Map<string, IdentityRow>();
  for await (const { key, value } of kv.list(prefix("id!"))) {
    out.set(key.slice("id!".length), value as IdentityRow);
  }
  return out;
}

export async function readMarket(kv: KV, marketId: string): Promise<MarketRow | undefined> {
  return (await kv.get(`mkt!${marketId}`)) as MarketRow | undefined;
}

export async function readMarkets(kv: KV): Promise<MarketRow[]> {
  const out: MarketRow[] = [];
  for await (const { value } of kv.list(prefix("mkt!"))) out.push(value as MarketRow);
  return out;
}

export async function readPools(kv: KV, marketId: string): Promise<Record<string, bigint>> {
  const out: Record<string, bigint> = {};
  for await (const { key, value } of kv.list(prefix(`pool!${marketId}!`))) {
    out[key.slice(`pool!${marketId}!`.length)] = BigInt(value as string);
  }
  return out;
}

export async function readValidBets(kv: KV, marketId: string): Promise<BetRow[]> {
  const out: BetRow[] = [];
  for await (const { value } of kv.list(prefix(`bet!${marketId}!`))) {
    const v = value as { betId: string; bettorId: string; outcomeKey: string; stake: string };
    out.push({ betId: v.betId, bettorId: v.bettorId, outcomeKey: v.outcomeKey, stake: BigInt(v.stake) });
  }
  return out;
}

export async function readAttestations(kv: KV, marketId: string): Promise<Map<string, AttestRow>> {
  const out = new Map<string, AttestRow>();
  const p = prefix(`attest!${marketId}!`);
  for await (const { key, value } of kv.list(p)) {
    out.set(key.slice(`attest!${marketId}!`.length), value as AttestRow);
  }
  return out;
}

/** The append-only attestation history (each re-attest is a distinct event). */
export async function readAttestationLog(
  kv: KV,
  marketId: string,
): Promise<Array<{ writer: string; outcomeKey: string; ts: number }>> {
  const out: Array<{ writer: string; outcomeKey: string; ts: number }> = [];
  for await (const { value } of kv.list(prefix(`alog!${marketId}!`))) {
    out.push(value as { writer: string; outcomeKey: string; ts: number });
  }
  return out;
}

export async function readReceipts(
  kv: KV,
  marketId: string,
): Promise<Array<{ line: number; txid: string; by: string }>> {
  const out: Array<{ line: number; txid: string; by: string }> = [];
  for await (const { key, value } of kv.list(prefix(`paid!${marketId}!`))) {
    const v = value as { txid: string; by: string };
    out.push({ line: Number(key.slice(`paid!${marketId}!`.length)), txid: v.txid, by: v.by });
  }
  return out;
}

export async function readChat(
  kv: KV,
): Promise<Array<{ author: string; text: string; lang: string; ts: number }>> {
  const out: Array<{ author: string; text: string; lang: string; ts: number }> = [];
  for await (const { value } of kv.list(prefix("chat!"))) {
    out.push(value as { author: string; text: string; lang: string; ts: number });
  }
  return out;
}

export async function isLocked(kv: KV, marketId: string): Promise<boolean> {
  return (await kv.get(`lock!${marketId}`)) !== undefined;
}

/** A deterministic fingerprint of the whole view — equal iff two peers converged. */
export async function viewDigest(kv: KV): Promise<string> {
  const lines: string[] = [];
  for await (const { key, value } of kv.list()) lines.push(`${key}=${JSON.stringify(value)}`);
  return bytesToHex(keccak_256(utf8ToBytes(lines.join("\n"))));
}
