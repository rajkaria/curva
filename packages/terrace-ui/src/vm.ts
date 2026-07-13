/**
 * View-models: `(kv, uiState) → plain data`. No DOM, no Pear.
 *
 * Everything the app shows comes from a VM here. VMs carry peer strings RAW —
 * escaping is applied exactly once, in the html helpers ({@link ./html}) —
 * and every number shown near money is derived through @curva/market-kernel,
 * never re-computed ad hoc. Each VM reads the view once per call, so a render
 * pass costs one scan per surface (the version-gated loop in the app makes
 * that zero when nothing changed).
 */
import {
  isLocked,
  readAttestationLog,
  readAttestations,
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
} from "@curva/terrace-base";
import { buildPools, computePayouts, impliedOdds, type Bet, type PayoutManifest } from "@curva/market-kernel";
import { resolveMarket, tallyBreakdown, type Resolution } from "@curva/crowd-oracle";
import { fallbackQuip, renderForViewer, type PoolSummary, type Translator } from "@curva/qvac-surfaces";
import {
  correctScore,
  customMarket,
  firstScorer,
  goalInWindow,
  matchResult,
  totalGoalsLadder,
  type MarketSpec,
  type MicroRound,
} from "@curva/market-catalogue";
import { electStewards } from "@curva/steward-escrow";
import { agoLabel, countdown, shortKey, usdt } from "./format.js";

/** A signed USDt delta: "+13.40" / "-5.00" / "0.00". Positive keeps the sign. */
function signedUsdt(micros: bigint): string {
  return micros > 0n ? `+${usdt(micros)}` : usdt(micros);
}

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
  readonly kind: string;
  /** Micro-round index (from a goal-in-window market's meta); null otherwise. */
  readonly round: number | null;
  /** A goal-in-window round still open for betting — floats to the top of the list. */
  readonly liveRound: boolean;
  readonly locked: boolean;
  /** "closes in 12:04" while open, "LOCKED" after the whistle. */
  readonly closesLabel: string;
  /** Raw cutoff (ms) so the DOM can tick a live countdown; null once locked. */
  readonly closesAt: number | null;
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
    const round =
      m.kind === "goal-in-window" && typeof m.params.meta?.round === "number" ? m.params.meta.round : null;
    items.push({
      marketId: m.marketId,
      title: m.params.title,
      kind: m.kind,
      round,
      liveRound: round !== null && !locked,
      locked,
      closesLabel: locked ? "LOCKED" : `closes in ${countdown(m.cutoffAt - state.now)}`,
      closesAt: locked ? null : m.cutoffAt,
    });
  }
  // Live micro-round markets (open goal-in-window) float to the top, in round
  // order — the terrace never runs out of something live to trade; everything
  // else keeps its view order (stable sort).
  items.sort((a, b) => {
    const ra = a.liveRound ? 0 : 1;
    const rb = b.liveRound ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return ra === 0 ? a.round! - b.round! : 0;
  });
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
  /** Raw cutoff (ms) for a live countdown; null once locked. */
  readonly closesAt: number | null;
  readonly outcomes: readonly OutcomeVm[];
  readonly resolution: Resolution;
  /** "finalizes in 9:31" while provisional; null otherwise. */
  readonly finalizesLabel: string | null;
  /** Raw finalize time (ms) for a live countdown; null unless provisional. */
  readonly finalizesAt: number | null;
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
    closesAt: locked ? null : m.cutoffAt,
    outcomes,
    resolution,
    finalizesLabel:
      resolution.status === "provisional"
        ? resolution.finalizesAt !== null
          ? `finalizes in ${countdown(resolution.finalizesAt - state.now)}`
          : `finalizes after ${resolution.eventsRemaining ?? 0} more attestation(s)`
        : null,
    finalizesAt: resolution.status === "provisional" ? resolution.finalizesAt : null,
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

/** No market to talk about yet — the Gaffer still says something. */
export const GAFFER_IDLE = "Open a market and I'll have something to say.";

/**
 * The pool summary the Gaffer riffs on — the same shape {@link fallbackQuip}
 * and the real QVAC LLM both take, so the app can route either path off one
 * read. Null when there's no market yet.
 */
export async function gafferPoolVm(kv: KV, selectedMarketId: string | null): Promise<PoolSummary | null> {
  const markets = await readMarkets(kv);
  const m = markets.find((x) => x.marketId === selectedMarketId) ?? markets[0];
  if (!m) return null;
  const odds = impliedOdds(buildPools(toKernelBets(await readValidBets(kv, m.marketId)), m.feeBps));
  return {
    title: m.params.title,
    outcomes: m.params.outcomes.map((k) => ({ key: k, pct: Math.round((odds[k]?.probability ?? 0) * 100) })),
  };
}

/** The Gaffer's deterministic quip about the selected (or first) market. */
export async function gafferVm(kv: KV, selectedMarketId: string | null): Promise<string> {
  const pool = await gafferPoolVm(kv, selectedMarketId);
  return pool ? fallbackQuip(pool) : GAFFER_IDLE;
}

// ── header: honesty, presence, money ──────────────────────────────────────────

/** The demo-mode disclosure text — literally true whenever the fakes are active. */
export const DEMO_BANNER = "DEMO MODE — FakeWallet (demo funds) · bundled transcript ASR";

export interface WalletVm {
  readonly balance: bigint;
  /** "1000.00 USDt" — always via {@link usdt}, never re-derived. */
  readonly label: string;
}
export function walletVm(balance: bigint): WalletVm {
  return { balance, label: `${usdt(balance)} USDt` };
}

export interface PeerVm {
  readonly count: number;
  /** True while ≥1 peer is connected; the pill goes amber when false. */
  readonly ok: boolean;
  /** "no peers" · "1 peer" · "3 peers". The ⇄ glyph is the DOM's, not ours. */
  readonly label: string;
}
export function peerVm(count: number): PeerVm {
  const n = Math.max(0, Math.floor(count));
  return { count: n, ok: n > 0, label: n === 0 ? "no peers" : n === 1 ? "1 peer" : `${n} peers` };
}

/** Local, app-owned header state (name/wallet/presence/mode) — not from the view. */
export interface HeaderInput {
  readonly displayName: string;
  readonly walletAddr: string;
  readonly balance: bigint;
  readonly peerCount: number;
  readonly demoMode: boolean;
}
export interface HeaderVm {
  readonly name: string;
  readonly addrShort: string;
  readonly wallet: WalletVm;
  readonly peer: PeerVm;
  readonly demoMode: boolean;
}
export function headerVm(i: HeaderInput): HeaderVm {
  return {
    name: i.displayName,
    addrShort: i.walletAddr.length > 12 ? i.walletAddr.slice(0, 12) + "…" : i.walletAddr,
    wallet: walletVm(i.balance),
    peer: peerVm(i.peerCount),
    demoMode: i.demoMode,
  };
}

// ── position: what you have at risk ───────────────────────────────────────────

export interface PositionOutcomeVm {
  readonly key: string;
  readonly stake: bigint;
  readonly stakeLabel: string;
}
export interface PositionVm {
  /** Your stake per outcome, sorted by key. Empty when you haven't bet. */
  readonly byOutcome: readonly PositionOutcomeVm[];
  readonly total: bigint;
  readonly totalLabel: string;
  readonly hasPosition: boolean;
}

/** Your own stake on this market, grouped by outcome — "You: 10 on HOME". */
export async function positionVm(kv: KV, marketId: string, me: string): Promise<PositionVm> {
  const mine = (await readValidBets(kv, marketId)).filter((b) => b.bettorId === me);
  const byKey = new Map<string, bigint>();
  let total = 0n;
  for (const b of mine) {
    byKey.set(b.outcomeKey, (byKey.get(b.outcomeKey) ?? 0n) + b.stake);
    total += b.stake;
  }
  const byOutcome = [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, stake]) => ({ key, stake, stakeLabel: usdt(stake) }));
  return { byOutcome, total, totalLabel: usdt(total), hasPosition: total > 0n };
}

/**
 * What you'd get back if `outcomeKey` resolves and you stake `stake` on it now,
 * computed by running the canonical {@link computePayouts} over the current
 * bets plus your hypothetical one — never a hand-rolled parimutuel formula, so
 * the preview equals what settlement will actually pay (to the micro, dust and
 * all). Returns your total return on the winning side (0 for a non-positive
 * stake). If you'd be the only bettor it returns your stake — a full refund,
 * which is exactly what a single-participant market pays.
 */
export function previewPayout(
  bets: readonly Bet[],
  feeBps: number,
  outcomeKey: string,
  stake: bigint,
  me: string,
): bigint {
  if (stake <= 0n) return 0n;
  const hypothetical: Bet = { betId: "__preview__", bettorId: me, outcomeKey, stake };
  const manifest = computePayouts({
    bets: [...bets, hypothetical],
    resolution: { kind: "outcome", outcomeKey },
    feeBps,
  });
  return manifest.lines.filter((l) => l.bettorId === me).reduce((s, l) => s + l.amount, 0n);
}

// ── P&L: how you did once it's square ─────────────────────────────────────────

export interface PnlVm {
  readonly staked: bigint;
  readonly payout: bigint;
  /** payout − staked. */
  readonly net: bigint;
  readonly won: boolean;
  /** "You're up 13.40 ✓" · "You're down 5.00" · "Square ✓". */
  readonly label: string;
}

/** Your P&L on a settled market, straight off the payout manifest. */
export function pnlVm(manifest: PayoutManifest, stakeByBettor: ReadonlyMap<string, bigint>, me: string): PnlVm {
  const staked = stakeByBettor.get(me) ?? 0n;
  const payout = manifest.lines.filter((l) => l.bettorId === me).reduce((s, l) => s + l.amount, 0n);
  const net = payout - staked;
  const label = net > 0n ? `You're up ${usdt(net)} ✓` : net < 0n ? `You're down ${usdt(-net)}` : "Square ✓";
  return { staked, payout, net, won: net > 0n, label };
}

// ── attestation tally: the quorum, made visible ───────────────────────────────

export interface TallyOutcomeVm {
  readonly key: string;
  readonly writers: number;
  readonly stake: bigint;
  readonly stakePct: number;
  readonly writersOk: boolean;
  readonly stakeOk: boolean;
  readonly meetsQuorum: boolean;
  /** "2/3 writers · 71% stake". */
  readonly label: string;
}
export interface TallyVoterVm {
  readonly writer: string;
  readonly name: string;
  readonly outcomeKey: string;
}
export interface TallyVm {
  readonly totalWriters: number;
  readonly minWriters: number;
  /** "needs ≥3 writers, ⅔ of writers & ⅔ of stake". */
  readonly thresholdLabel: string;
  readonly outcomes: readonly TallyOutcomeVm[];
  /** Who attested what — names via the identities map, sorted by name. */
  readonly voters: readonly TallyVoterVm[];
  readonly quorumOutcome: string | null;
  readonly hasAttestations: boolean;
}

/**
 * The live attestation standings against the dual-⅔ quorum, so the crowd can
 * watch the whistle approach — reads the same {@link tallyBreakdown} the
 * resolver uses, so the card can never claim a quorum the rule wouldn't grant.
 */
export async function tallyVm(kv: KV, marketId: string, stakes: ReadonlyMap<string, bigint>): Promise<TallyVm> {
  const attestations = await readAttestations(kv, marketId);
  const identities = await readIdentities(kv);
  const tally = new Map<string, { outcomeKey: string; ts: number }>();
  for (const [writer, a] of attestations) tally.set(writer, { outcomeKey: a.outcomeKey, ts: a.ts });

  const b = tallyBreakdown(tally, stakes);
  const outcomes: TallyOutcomeVm[] = b.outcomes.map((o) => {
    const stakePct = b.totalStake > 0n ? Math.round((Number(o.stake) / Number(b.totalStake)) * 100) : 0;
    return {
      key: o.outcomeKey,
      writers: o.writers,
      stake: o.stake,
      stakePct,
      writersOk: o.writersOk,
      stakeOk: o.stakeOk,
      meetsQuorum: o.meetsQuorum,
      label: `${o.writers}/${b.totalWriters} writers · ${stakePct}% stake`,
    };
  });
  const voters: TallyVoterVm[] = [...attestations.entries()]
    .map(([writer, a]) => ({ writer, name: nameOf(identities, writer), outcomeKey: a.outcomeKey }))
    .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));

  return {
    totalWriters: b.totalWriters,
    minWriters: b.minWriters,
    thresholdLabel: `needs ≥${b.minWriters} writers, ⅔ of writers & ⅔ of stake`,
    outcomes,
    voters,
    quorumOutcome: b.quorumOutcome,
    hasAttestations: attestations.size > 0,
  };
}

// ── languages: the 32-nation translate surface, made pickable ─────────────────

export interface Lang {
  readonly code: string;
  readonly label: string;
}
/** The chat language picker's options — code stamps each message; label is UI. */
export const LANGS: readonly Lang[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "de", label: "Deutsch" },
  { code: "ar", label: "العربية" },
  { code: "hi", label: "हिन्दी" },
];

// ── market picker: the whole catalogue, made openable (F1) ────────────────────

/** Just enough of a fixture for the picker + micro-rounds — no app types leak in. */
export interface FixtureLike {
  readonly id: string;
  readonly home: string;
  readonly away: string;
  readonly homeSquad?: readonly string[];
  readonly awaySquad?: readonly string[];
}

export interface MarketPickerOptionVm {
  /** Button copy — our own constant, never a peer string. */
  readonly label: string;
  /** The exact factory `{ kind, params }` the app signs — no drift, no re-derivation. */
  readonly spec: MarketSpec;
}

/**
 * Every catalogue market kind reachable for one fixture, each carrying the exact
 * factory spec the app emits verbatim — Result, both total-goals lines, first
 * scorer over the bundled danger men, and the correct-score grid. `goal-in-window`
 * is the fifth kind and comes from the micro-round planner ({@link planMicroRounds}),
 * so between the two every {@link MarketKind} is openable from the UI.
 */
export function marketPickerVm(fx: FixtureLike): MarketPickerOptionVm[] {
  const options: MarketPickerOptionVm[] = [
    { label: "Result", spec: matchResult(fx.home, fx.away) },
    ...totalGoalsLadder([2.5, 3.5]).map((spec) => ({
      label: `Total goals O/U ${(Number(spec.params.meta?.lineTenths ?? 0) / 10).toFixed(1)}`,
      spec,
    })),
  ];
  const squad = [...(fx.homeSquad ?? []), ...(fx.awaySquad ?? [])];
  if (squad.length > 0) options.push({ label: "First scorer", spec: firstScorer(squad) });
  options.push({ label: "Correct score", spec: correctScore(3) });
  return options;
}

// ── custom markets: any peer opens a market on anything (general platform) ────

/** Split a free-text outcomes box (newline- or comma-separated) into clean keys.
 *  Deduping and cap enforcement happen in {@link customMarket} — this only tokenizes. */
export function parseOutcomes(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/** What the create-market form holds. Outcomes are one free-text box (a line or a
 *  comma each) so the UI stays a title + a textarea + a duration. */
export interface CustomMarketDraft {
  readonly title: string;
  readonly outcomesText: string;
}

/** Either a signable spec or a human-readable reason the draft is invalid — the
 *  app renders one or the other, and never signs a market the fold would drop. */
export type CustomMarketResult =
  | { readonly ok: true; readonly spec: MarketSpec }
  | { readonly ok: false; readonly error: string };

/**
 * Turn a user's draft into a signable `custom` market spec, or a UI error.
 * Delegates every rule to {@link customMarket}, whose caps mirror the fold — so
 * "valid here" means "survives `apply`". Peer text stays RAW in the returned spec
 * (title/outcomes); escaping happens once, later, in the html layer.
 */
export function buildCustomMarket(draft: CustomMarketDraft): CustomMarketResult {
  try {
    return { ok: true, spec: customMarket(draft.title, parseOutcomes(draft.outcomesText)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid market" };
  }
}

// ── micro-rounds: the live-demo killer, planned deterministically (F2) ────────

/** Deterministic id so two openers racing to open the same round can't fork it
 *  — first-market-wins in the fold makes the duplicate a no-op. */
export function microRoundMarketId(fixtureId: string, round: number): string {
  return `m-${fixtureId}-r${round}`;
}

export interface MicroRoundMarketVm {
  readonly round: number;
  readonly marketId: string;
  /** goal-in-window spec for this round — signed verbatim, cutoff below. */
  readonly spec: MarketSpec;
  readonly cutoffAt: number;
  /** The betting window has opened → this market should be locked. */
  readonly shouldLock: boolean;
}

/**
 * The pure "what should exist / be locked at time `now`" planner for one
 * fixture's micro-rounds. A round's market appears one round-length before its
 * cutoff (you bet on the round before it starts) and should be locked once its
 * window opens. The app diffs this against the view and emits only the missing
 * `market`/`lock` messages, so re-running every tick is idempotent.
 */
export function planMicroRounds(
  fixtureId: string,
  rounds: readonly MicroRound[],
  now: number,
): MicroRoundMarketVm[] {
  const out: MicroRoundMarketVm[] = [];
  for (const r of rounds) {
    const leadMs = r.windowEnd - r.windowStart; // open one round-length ahead
    if (now < r.cutoffAt - leadMs) continue; // lead-in hasn't started yet
    out.push({
      round: r.round,
      marketId: microRoundMarketId(fixtureId, r.round),
      spec: goalInWindow(r.round, r.windowStart, r.windowEnd),
      cutoffAt: r.cutoffAt,
      shouldLock: now >= r.cutoffAt, // window open → betting closed
    });
  }
  return out;
}

// ── leaderboard: realized P&L across the terrace (F4) ─────────────────────────

export interface LeaderRowVm {
  readonly id: string;
  readonly name: string;
  readonly staked: bigint;
  readonly payout: bigint;
  /** payout − staked, across every resolved market. */
  readonly net: bigint;
  /** "+13.40" / "-5.00" / "0.00". */
  readonly netLabel: string;
  readonly won: boolean;
  /** How many resolved markets this bettor was in. */
  readonly markets: number;
}
export interface LeaderboardVm {
  /** Sorted by net desc, ties by name. */
  readonly rows: readonly LeaderRowVm[];
  readonly resolvedCount: number;
  readonly hasResolved: boolean;
}

/**
 * Every resolved market's realized P&L, folded per bettor. Payouts come from the
 * canonical {@link computePayouts} — the same engine settlement runs — so a
 * bettor's leaderboard net equals the sum of what settle actually pays, never a
 * parallel formula. A market counts as resolved by the same {@link resolveMarket}
 * the market screen uses, so the board can't credit a win the rule wouldn't.
 */
export async function leaderboardVm(kv: KV, state: UiState): Promise<LeaderboardVm> {
  const markets = await readMarkets(kv);
  const identities = await readIdentities(kv);
  const staked = new Map<string, bigint>();
  const payout = new Map<string, bigint>();
  const counted = new Map<string, number>();
  let resolvedCount = 0;

  for (const m of markets) {
    const betRows = await readValidBets(kv, m.marketId);
    if (betRows.length === 0) continue;
    const stakes = stakeByBettor(betRows);
    const resolution = resolveMarket({
      events: await readAttestationLog(kv, m.marketId),
      stakeByWriter: stakes,
      now: state.now,
      disputeWindowMs: state.disputeWindowMs,
    });
    if (resolution.status !== "resolved") continue;
    resolvedCount++;

    const manifest = computePayouts({
      bets: toKernelBets(betRows),
      resolution: { kind: "outcome", outcomeKey: resolution.outcomeKey },
      feeBps: m.feeBps,
    });
    const payByBettor = new Map<string, bigint>();
    for (const l of manifest.lines) payByBettor.set(l.bettorId, (payByBettor.get(l.bettorId) ?? 0n) + l.amount);

    for (const [id, s] of stakes) {
      staked.set(id, (staked.get(id) ?? 0n) + s);
      payout.set(id, (payout.get(id) ?? 0n) + (payByBettor.get(id) ?? 0n));
      counted.set(id, (counted.get(id) ?? 0) + 1);
    }
  }

  const rows: LeaderRowVm[] = [...staked.keys()]
    .map((id) => {
      const s = staked.get(id) ?? 0n;
      const p = payout.get(id) ?? 0n;
      const net = p - s;
      return {
        id,
        name: nameOf(identities, id),
        staked: s,
        payout: p,
        net,
        netLabel: signedUsdt(net),
        won: net > 0n,
        markets: counted.get(id) ?? 0,
      };
    })
    .sort((a, b) => (a.net !== b.net ? (a.net > b.net ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return { rows, resolvedCount, hasResolved: resolvedCount > 0 };
}

// ── escrow: the trust tiers, made visible (F5) ────────────────────────────────

export interface StewardVm {
  readonly id: string;
  readonly name: string;
}
export interface EscrowVm {
  /** Mates Mode (Tier 1) is always on — the direct-settle path the demo uses. */
  readonly tier1Active: boolean;
  /** Distinct stakers plus the opener — the electable set. */
  readonly participantCount: number;
  /** Tier 2 (2-of-3 steward escrow) needs ≥3 electable participants. */
  readonly tier2Available: boolean;
  readonly threshold: number;
  /** The elected stewards (opener + top stakers), by name; empty when tier 2 is unavailable. */
  readonly stewards: readonly StewardVm[];
  readonly note: string;
}

/**
 * A read-only view of the two trust tiers for this terrace. Tier 2's steward set
 * is the deterministic {@link electStewards} election (opener + the two largest
 * stakers, ties by idKey) over the identities who've actually staked — every peer
 * computes the same three names. No money flow changes; this only surfaces what
 * @curva/steward-escrow already decides.
 */
export async function escrowVm(kv: KV, state: UiState): Promise<EscrowVm> {
  const identities = await readIdentities(kv);
  const markets = await readMarkets(kv);

  const stake = new Map<string, bigint>();
  for (const m of markets) {
    for (const [id, s] of stakeByBettor(await readValidBets(kv, m.marketId))) {
      stake.set(id, (stake.get(id) ?? 0n) + s);
    }
  }

  // Deterministic opener: the earliest-created market's opener (ties by id),
  // falling back to the viewer when no market exists yet.
  const opener =
    [...markets].sort((a, b) =>
      a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.marketId < b.marketId ? -1 : 1,
    )[0]?.opener ?? state.viewerId;

  const electable = new Set(stake.keys());
  electable.add(opener);
  const tier2Available = electable.size >= 3;

  let stewards: StewardVm[] = [];
  let threshold = 0;
  if (tier2Available) {
    const set = electStewards(opener, stake);
    threshold = set.threshold;
    stewards = set.stewards.map((id) => ({ id, name: nameOf(identities, id) }));
  }

  return {
    tier1Active: true,
    participantCount: electable.size,
    tier2Available,
    threshold,
    stewards,
    note: tier2Available
      ? `Tier 2 ready — ${threshold}-of-${stewards.length} steward escrow (opener + top stakers).`
      : `Tier 2 needs ≥3 stakers in the terrace (have ${electable.size}).`,
  };
}

// ── recent terraces: one-tap rejoin (F6) ──────────────────────────────────────

/** A remembered terrace (persisted app-side in localStorage, never replicated). */
export interface RecentTerrace {
  readonly key: string;
  readonly name: string;
  readonly role: string;
  readonly lastSeen: number;
}
export interface RecentTerraceVm extends RecentTerrace {
  readonly seenLabel: string;
}

/** Most-recent-first, de-duped by key, capped — with a coarse "seen" label. */
export function recentTerracesVm(
  entries: readonly RecentTerrace[],
  now: number,
  limit = 6,
): RecentTerraceVm[] {
  const byKey = new Map<string, RecentTerrace>();
  for (const e of entries) {
    const prev = byKey.get(e.key);
    if (!prev || e.lastSeen > prev.lastSeen) byKey.set(e.key, e);
  }
  return [...byKey.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit)
    .map((e) => ({ ...e, seenLabel: agoLabel(now - e.lastSeen) }));
}
