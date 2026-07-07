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
 *  - schema version must be 1 and `ts` finite; per-type fields are validated
 *    (string types, length caps, kind whitelist) so hostile payloads die here,
 *    not in a renderer
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

/**
 * The linearized-index counter, persisted IN the view. It must not live in
 * process memory: Autobase can truncate and re-apply (and the app restarts),
 * and view keys embed this index — a process-local counter would diverge
 * across peers/restarts. A view row rolls back atomically with the bee.
 */
const SEQ_KEY = "meta!seq";

const KINDS: ReadonlySet<string> = new Set([
  "match-result",
  "total-goals",
  "goal-in-window",
  "first-scorer",
  "correct-score",
]);

const isStr = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

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
  for (const msg of messages) await applyMessage(kv, msg);
  return kv;
}

/**
 * Apply one message. Exported for the Autobase adapter. The linearized index
 * comes from the view's own `meta!seq` row and advances for EVERY message —
 * accepted or dropped — so it always equals the message's position in the
 * shared linearization, on every peer, across restarts and re-applies.
 */
export async function applyMessage(kv: KV, msg: Msg): Promise<void> {
  const seq = Number((await kv.get(SEQ_KEY)) ?? 0);
  await kv.put(SEQ_KEY, seq + 1);

  if (!verifyMessage(msg)) return;
  if (msg.v !== 1 || !Number.isFinite(msg.ts)) return;

  if (msg.t === "hello") {
    if (!isStr(msg.name, 40) || !isStr(msg.walletAddr, 128)) return;
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
      if (!KINDS.has(msg.kind) || !Number.isFinite(msg.cutoffAt)) return;
      if (!isStr(msg.params?.title, 200)) return;
      const outs = msg.params.outcomes;
      if (!Array.isArray(outs) || outs.length < 2 || outs.length > 256) return;
      if (!outs.every((o) => isStr(o, 64))) return;
      if (new Set(outs).size !== outs.length) return;
      if (msg.params.meta !== undefined) {
        const meta: unknown = msg.params.meta;
        if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return;
        for (const v of Object.values(meta)) {
          if (typeof v !== "string" && typeof v !== "number") return;
        }
      }
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
      if (!isStr(msg.nonce, 64)) return;
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
      if (msg.evidence !== undefined) {
        const c = msg.evidence.confidence;
        if (typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 1) return;
        if (msg.evidence.asrScore !== undefined && !isStr(msg.evidence.asrScore, 64)) return;
      }
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
      if (!Number.isInteger(msg.manifestLine) || msg.manifestLine < 0 || msg.manifestLine >= 1e12) return;
      // txid may be "" (dry run) — only its type and size are constrained.
      if (typeof msg.txid !== "string" || msg.txid.length > 128) return;
      const key = `paid!${msg.marketId}!${padSeq(msg.manifestLine)}`;
      if ((await kv.get(key)) === undefined) await kv.put(key, { txid: msg.txid, by: msg.author });
      return;
    }
    case "chat": {
      if (!isStr(msg.text, 2000) || !isStr(msg.lang, 8)) return;
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
