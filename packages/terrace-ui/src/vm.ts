/**
 * View-models: `(kv, uiState) → plain data`. No DOM, no Pear.
 *
 * Everything the app shows comes from a VM here. VMs carry peer strings RAW —
 * escaping is applied exactly once, in the html helpers ({@link ./html}) —
 * and every number shown near money is derived through @tifo/market-kernel,
 * never re-computed ad hoc. Each VM reads the view once per call, so a render
 * pass costs one scan per surface (the version-gated loop in the app makes
 * that zero when nothing changed).
 */
import {
  isLocked,
  readAttestationLog,
  readChat,
  readIdentities,
  readMarket,
  readMarkets,
  readPools,
  readReceipts,
  readValidBets,
  type BetRow,
  type IdentityRow,
  type KV,
} from "@tifo/terrace-base";
import { buildPools, impliedOdds, type Bet } from "@tifo/market-kernel";
import { resolveMarket, type Resolution } from "@tifo/crowd-oracle";
import { fallbackQuip, renderForViewer, type Translator } from "@tifo/qvac-surfaces";
import { countdown, shortKey, usdt } from "./format.js";

/** Local, non-replicated UI state the VMs need. The app owns and passes it. */
export interface UiState {
  /** Wall clock, injected for determinism (countdowns, resolution). */
  readonly now: number;
  readonly writable: boolean;
  readonly role: string;
  readonly inviteKey: string;
  readonly writerKey: string;
  /** The viewer's idKey. */
  readonly viewerId: string;
  /** Language chat renders into for this viewer. */
  readonly viewerLang: string;
  readonly disputeWindowMs: number;
}

// ── terrace ──────────────────────────────────────────────────────────────────

export interface MarketListItemVm {
  readonly marketId: string;
  readonly title: string;
  readonly locked: boolean;
  /** "closes in 12:04" while open, "LOCKED" after the whistle. */
  readonly closesLabel: string;
}

export interface TerraceVm {
  readonly role: string;
  readonly writable: boolean;
  readonly invite: string;
  readonly writerKey: string;
  readonly markets: readonly MarketListItemVm[];
}

export async function terraceVm(kv: KV, state: UiState): Promise<TerraceVm> {
  const markets = await readMarkets(kv);
  const items: MarketListItemVm[] = [];
  for (const m of markets) {
    const locked = await isLocked(kv, m.marketId);
    items.push({
      marketId: m.marketId,
      title: m.params.title,
      locked,
      closesLabel: locked ? "LOCKED" : `closes in ${countdown(m.cutoffAt - state.now)}`,
    });
  }
  return {
    role: state.role,
    writable: state.writable,
    invite: state.inviteKey,
    writerKey: state.writerKey,
    markets: items,
  };
}

// ── market ───────────────────────────────────────────────────────────────────

export interface OutcomeVm {
  readonly key: string;
  readonly gross: bigint;
  readonly grossLabel: string;
  readonly probability: number;
  /** Rounded percentage for the bar width — numeric, never a peer string. */
  readonly pct: number;
  /** "×1.42", or "—" when the outcome is unbacked. */
  readonly oddsLabel: string;
}

export interface MarketVm {
  readonly marketId: string;
  readonly title: string;
  readonly kind: string;
  /** Raw kind-specific metadata (homeTeam/awayTeam…) for action handlers. */
  readonly meta: Readonly<Record<string, string | number>>;
  readonly feeBps: number;
  readonly locked: boolean;
  readonly statusLabel: "OPEN" | "LOCKED";
  /** "closes in 12:04" while open; null once locked. */
  readonly closesLabel: string | null;
  readonly outcomes: readonly OutcomeVm[];
  readonly resolution: Resolution;
  /** "finalizes in 9:31" while provisional; null otherwise. */
  readonly finalizesLabel: string | null;
  readonly receipts: number;
  readonly canBet: boolean;
  readonly canLock: boolean;
  readonly canSettle: boolean;
}

/** Per-bettor gross stake — the oracle's stake weighting and settle's deltas both use this. */
export function stakeByBettor(bets: readonly BetRow[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const b of bets) out.set(b.bettorId, (out.get(b.bettorId) ?? 0n) + b.stake);
  return out;
}

/** BetRow → kernel Bet (same shape; the cast is spelled out once, here). */
export function toKernelBets(bets: readonly BetRow[]): Bet[] {
  return bets.map((b) => ({ betId: b.betId, bettorId: b.bettorId, outcomeKey: b.outcomeKey, stake: b.stake }));
}

export async function marketVm(kv: KV, state: UiState, marketId: string): Promise<MarketVm | null> {
  const m = await readMarket(kv, marketId);
  if (!m) return null;

  const bets = await readValidBets(kv, marketId);
  const gross = await readPools(kv, marketId);
  const odds = impliedOdds(buildPools(toKernelBets(bets), m.feeBps));
  const locked = await isLocked(kv, marketId);
  const events = await readAttestationLog(kv, marketId);
  const resolution = resolveMarket({
    events,
    stakeByWriter: stakeByBettor(bets),
    now: state.now,
    disputeWindowMs: state.disputeWindowMs,
  });
  const receipts = (await readReceipts(kv, marketId)).length;

  const outcomes: OutcomeVm[] = m.params.outcomes.map((key) => {
    const o = odds[key] ?? { probability: 0, decimalOdds: null };
    const g = gross[key] ?? 0n;
    return {
      key,
      gross: g,
      grossLabel: usdt(g),
      probability: o.probability,
      pct: Math.round(o.probability * 100),
      oddsLabel: o.decimalOdds ? `×${o.decimalOdds.toFixed(2)}` : "—",
    };
  });

  return {
    marketId: m.marketId,
    title: m.params.title,
    kind: m.kind,
    meta: m.params.meta ?? {},
    feeBps: m.feeBps,
    locked,
    statusLabel: locked ? "LOCKED" : "OPEN",
    closesLabel: locked ? null : `closes in ${countdown(m.cutoffAt - state.now)}`,
    outcomes,
    resolution,
    finalizesLabel:
      resolution.status === "provisional"
        ? `finalizes in ${countdown(resolution.finalizesAt - state.now)}`
        : null,
    receipts,
    canBet: !locked && state.writable && state.now <= m.cutoffAt,
    canLock: !locked && state.writable,
    canSettle: state.writable && resolution.status === "resolved",
  };
}

// ── settlement inputs ────────────────────────────────────────────────────────

export interface SettlementVm {
  /** Valid bets in kernel shape — feed straight to computePayouts. */
  readonly bets: readonly Bet[];
  /** Per-bettor gross stake — feed straight to computeDeltas. */
  readonly stakes: ReadonlyMap<string, bigint>;
  /** idKey → registered wallet address (idKey fallback for the unregistered). */
  readonly walletOf: (idKey: string) => string;
}

/** Everything settle needs, read from the view in one pass. */
export async function settlementVm(kv: KV, marketId: string): Promise<SettlementVm> {
  const bets = toKernelBets(await readValidBets(kv, marketId));
  const identities = await readIdentities(kv);
  return {
    bets,
    stakes: stakeByBettor(bets),
    walletOf: (idKey) => identities.get(idKey)?.walletAddr ?? idKey,
  };
}

// ── chat ─────────────────────────────────────────────────────────────────────

export interface ChatLineVm {
  readonly author: string;
  /** Registered hello name, short-key fallback. */
  readonly name: string;
  /** Already rendered into the viewer's language. */
  readonly text: string;
  readonly lang: string;
  readonly ts: number;
}

/** idKey → display name with a short-key fallback. */
export function nameOf(identities: ReadonlyMap<string, IdentityRow>, idKey: string): string {
  return identities.get(idKey)?.name ?? shortKey(idKey);
}

export async function chatVm(kv: KV, state: UiState, translator: Translator): Promise<ChatLineVm[]> {
  const identities = await readIdentities(kv);
  const lines = await readChat(kv);
  return Promise.all(
    lines.map(async (l) => ({
      author: l.author,
      name: nameOf(identities, l.author),
      text: await renderForViewer({ text: l.text, lang: l.lang }, state.viewerLang, translator),
      lang: l.lang,
      ts: l.ts,
    })),
  );
}

// ── gaffer ───────────────────────────────────────────────────────────────────

/** The Gaffer's deterministic quip about the selected (or first) market. */
export async function gafferVm(kv: KV, selectedMarketId: string | null): Promise<string> {
  const markets = await readMarkets(kv);
  const m = markets.find((x) => x.marketId === selectedMarketId) ?? markets[0];
  if (!m) return "Open a market and I'll have something to say.";
  const odds = impliedOdds(buildPools(toKernelBets(await readValidBets(kv, m.marketId)), m.feeBps));
  return fallbackQuip({
    title: m.params.title,
    outcomes: m.params.outcomes.map((k) => ({ key: k, pct: Math.round((odds[k]?.probability ?? 0) * 100) })),
  });
}
