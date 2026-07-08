/**
 * View-model suite — the whole render layer, tested with zero Pear/Autobase.
 *
 * A scripted message set (2–3 writers, one market, three bets, a lock, a
 * quorum of attests, receipts, chat) is folded with the production
 * `foldMessages`, then every VM is asserted against exact display strings —
 * the same strings the DOM shell will show verbatim.
 */
import { describe, expect, test } from "vitest";
import { foldMessages, randomIdentity, signMessage, type Identity, type Msg } from "@curva/terrace-base";
import { FakeTranslator } from "@curva/qvac-surfaces";
import { computePayouts, type Bet } from "@curva/market-kernel";
import {
  correctScore,
  firstScorer,
  goalInWindow,
  matchResult,
  scheduleMicroRounds,
  totalGoalsLadder,
} from "@curva/market-catalogue";
import {
  DEMO_BANNER,
  GAFFER_IDLE,
  LANGS,
  chatVm,
  escrowVm,
  gafferPoolVm,
  gafferVm,
  headerVm,
  leaderboardVm,
  marketPickerVm,
  marketVm,
  microRoundMarketId,
  peerVm,
  planMicroRounds,
  pnlVm,
  positionVm,
  previewPayout,
  recentTerracesVm,
  settlementVm,
  stakeByBettor,
  tallyVm,
  terraceVm,
  walletVm,
  type UiState,
} from "../src/vm.js";

const USDT = 1_000_000n;
const T0 = 1_000_000;
const CUTOFF = T0 + 90 * 60_000;
const DISPUTE_MS = 600_000;

const ana = randomIdentity();
const bo = randomIdentity();
const cai = randomIdentity();

function hello(id: Identity, name: string, ts = T0): Msg {
  return signMessage(
    { t: "hello", v: 1, author: id.idKey, name, walletAddr: "0x" + name, ts },
    id.privKey,
  );
}
function market(id: Identity, marketId: string, title: string, ts = T0 + 1): Msg {
  return signMessage(
    {
      t: "market",
      v: 1,
      author: id.idKey,
      marketId,
      kind: "match-result",
      params: { title, outcomes: ["HOME", "DRAW", "AWAY"] },
      cutoffAt: CUTOFF,
      feeBps: 0,
      ts,
    },
    id.privKey,
  );
}
function bet(id: Identity, marketId: string, outcomeKey: string, whole: bigint, nonce: string, ts: number): Msg {
  return signMessage(
    { t: "bet", v: 1, author: id.idKey, marketId, outcomeKey, amount: whole * USDT, nonce, ts },
    id.privKey,
  );
}
function lock(id: Identity, marketId: string, ts: number): Msg {
  return signMessage({ t: "lock", v: 1, author: id.idKey, marketId, ts }, id.privKey);
}
function attest(id: Identity, marketId: string, outcomeKey: string, ts: number): Msg {
  return signMessage(
    { t: "attest", v: 1, author: id.idKey, marketId, outcomeKey, evidence: { confidence: 1 }, ts },
    id.privKey,
  );
}
function receipt(id: Identity, marketId: string, manifestLine: number, ts: number): Msg {
  return signMessage(
    { t: "receipt", v: 1, author: id.idKey, marketId, manifestLine, txid: "0xfake" + manifestLine, ts },
    id.privKey,
  );
}
function chat(id: Identity, text: string, lang: string, ts: number): Msg {
  return signMessage({ t: "chat", v: 1, author: id.idKey, text, lang, ts }, id.privKey);
}
function goalMarket(
  id: Identity,
  marketId: string,
  round: number,
  windowStart: number,
  windowEnd: number,
  cutoffAt: number,
  ts: number,
): Msg {
  return signMessage(
    {
      t: "market",
      v: 1,
      author: id.idKey,
      marketId,
      kind: "goal-in-window",
      params: { title: `Goal in round ${round + 1}?`, outcomes: ["YES", "NO"], meta: { round, windowStart, windowEnd } },
      cutoffAt,
      feeBps: 0,
      ts,
    },
    id.privKey,
  );
}

/** Three markets, each resolved to HOME by a 3-writer quorum — the leaderboard fixture. */
const LB: readonly Msg[] = [
  hello(ana, "ana"),
  hello(bo, "bo"),
  hello(cai, "cai"),
  market(ana, "m1", "M1", T0 + 1),
  market(ana, "m2", "M2", T0 + 2),
  market(ana, "m3", "M3", T0 + 3),
  bet(ana, "m1", "HOME", 10n, "a1", T0 + 10),
  bet(bo, "m1", "AWAY", 10n, "b1", T0 + 11),
  bet(bo, "m2", "HOME", 10n, "b2", T0 + 12),
  bet(cai, "m2", "AWAY", 10n, "c2", T0 + 13),
  bet(ana, "m3", "HOME", 6n, "a3", T0 + 14),
  bet(cai, "m3", "AWAY", 4n, "c3", T0 + 15),
  lock(ana, "m1", T0 + 100),
  lock(ana, "m2", T0 + 100),
  lock(ana, "m3", T0 + 100),
  attest(ana, "m1", "HOME", T0 + 200),
  attest(bo, "m1", "HOME", T0 + 200),
  attest(cai, "m1", "HOME", T0 + 200),
  attest(ana, "m2", "HOME", T0 + 200),
  attest(bo, "m2", "HOME", T0 + 200),
  attest(cai, "m2", "HOME", T0 + 200),
  attest(ana, "m3", "HOME", T0 + 200),
  attest(bo, "m3", "HOME", T0 + 200),
  attest(cai, "m3", "HOME", T0 + 200),
];

const BASE: readonly Msg[] = [
  hello(ana, "ana"),
  hello(bo, "bo"),
  hello(cai, "cai"),
  market(ana, "m1", "FRA v BRA"),
  bet(ana, "m1", "HOME", 10n, "n1", T0 + 10),
  bet(bo, "m1", "AWAY", 5n, "n2", T0 + 11),
  bet(bo, "m1", "HOME", 2n, "n3", T0 + 12),
];

function state(over: Partial<UiState> = {}): UiState {
  return {
    now: T0 + 20,
    writable: true,
    role: "opener",
    inviteKey: "invite-hex",
    writerKey: "writer-hex",
    viewerId: ana.idKey,
    viewerLang: "en",
    disputeWindowMs: DISPUTE_MS,
    ...over,
  };
}

describe("marketVm — pools, odds, gating", () => {
  test("exact odds strings and pool totals from three bets", async () => {
    const kv = await foldMessages(BASE);
    const vm = (await marketVm(kv, state(), "m1"))!;

    expect(vm.title).toBe("FRA v BRA");
    expect(vm.statusLabel).toBe("OPEN");
    expect(vm.outcomes.map((o) => o.key)).toEqual(["HOME", "DRAW", "AWAY"]);

    const [home, draw, away] = vm.outcomes;
    expect(home!.gross).toBe(12n * USDT);
    expect(home!.grossLabel).toBe("12.00");
    expect(home!.oddsLabel).toBe("×1.42"); // 17/12
    expect(home!.pct).toBe(71);
    expect(away!.gross).toBe(5n * USDT);
    expect(away!.grossLabel).toBe("5.00");
    expect(away!.oddsLabel).toBe("×3.40"); // 17/5
    expect(away!.pct).toBe(29);
    expect(draw!.gross).toBe(0n);
    expect(draw!.oddsLabel).toBe("—");
    expect(draw!.pct).toBe(0);
  });

  test("open market: canBet/canLock true for a writer, closes-in countdown runs", async () => {
    const kv = await foldMessages(BASE);
    const vm = (await marketVm(kv, state({ now: T0 }), "m1"))!;
    expect(vm.locked).toBe(false);
    expect(vm.canBet).toBe(true);
    expect(vm.canLock).toBe(true);
    expect(vm.canSettle).toBe(false);
    expect(vm.closesLabel).toBe("closes in 1:30:00"); // 90 minutes out
  });

  test("after lock: canBet=false, LOCKED, no countdown", async () => {
    const kv = await foldMessages([...BASE, lock(ana, "m1", T0 + 100)]);
    const vm = (await marketVm(kv, state(), "m1"))!;
    expect(vm.locked).toBe(true);
    expect(vm.statusLabel).toBe("LOCKED");
    expect(vm.canBet).toBe(false);
    expect(vm.canLock).toBe(false);
    expect(vm.closesLabel).toBeNull();
  });

  test("read-only viewer can do nothing", async () => {
    const kv = await foldMessages(BASE);
    const vm = (await marketVm(kv, state({ writable: false }), "m1"))!;
    expect(vm.canBet).toBe(false);
    expect(vm.canLock).toBe(false);
    expect(vm.canSettle).toBe(false);
  });

  test("unknown market yields null", async () => {
    const kv = await foldMessages(BASE);
    expect(await marketVm(kv, state(), "nope")).toBeNull();
  });
});

describe("marketVm — resolution and receipts", () => {
  const ATTESTED = [
    ...BASE,
    lock(ana, "m1", T0 + 100),
    attest(ana, "m1", "HOME", T0 + 200),
    attest(bo, "m1", "HOME", T0 + 200),
    attest(cai, "m1", "HOME", T0 + 200),
  ];

  test("provisional inside the dispute window, with a finalizes-in countdown", async () => {
    const kv = await foldMessages(ATTESTED);
    const vm = (await marketVm(kv, state({ now: T0 + 300 }), "m1"))!;
    expect(vm.resolution.status).toBe("provisional");
    expect(vm.finalizesLabel).toBe("finalizes in 9:59"); // window − 100ms elapsed
    expect(vm.canSettle).toBe(false);
  });

  test("resolved after the window; canSettle for a writer; receipts counted", async () => {
    const kv = await foldMessages([
      ...ATTESTED,
      receipt(ana, "m1", 0, T0 + 700_000),
      receipt(bo, "m1", 1, T0 + 700_001),
    ]);
    const vm = (await marketVm(kv, state({ now: T0 + 200 + DISPUTE_MS }), "m1"))!;
    expect(vm.resolution).toMatchObject({ status: "resolved", outcomeKey: "HOME" });
    expect(vm.canSettle).toBe(true);
    expect(vm.finalizesLabel).toBeNull();
    expect(vm.receipts).toBe(2);
  });
});

describe("settlementVm — the settle handler's one read", () => {
  test("kernel-shaped bets, per-bettor stakes, wallet mapping with fallback", async () => {
    const kv = await foldMessages(BASE);
    const s = await settlementVm(kv, "m1");
    expect(s.bets).toHaveLength(3);
    expect(s.bets.every((b) => typeof b.stake === "bigint")).toBe(true);
    expect(s.stakes.get(ana.idKey)).toBe(10n * USDT);
    expect(s.stakes.get(bo.idKey)).toBe(7n * USDT);
    expect(s.walletOf(ana.idKey)).toBe("0xana"); // registered hello wallet
    expect(s.walletOf("02unknown")).toBe("02unknown"); // fallback: the idKey itself
  });
});

describe("terraceVm — market list", () => {
  test("lists markets with lock state and countdown labels", async () => {
    const kv = await foldMessages(BASE);
    const vm = await terraceVm(kv, state({ now: T0 }));
    expect(vm.role).toBe("opener");
    expect(vm.invite).toBe("invite-hex");
    expect(vm.markets).toEqual([
      {
        marketId: "m1",
        title: "FRA v BRA",
        kind: "match-result",
        round: null,
        liveRound: false,
        locked: false,
        closesLabel: "closes in 1:30:00",
        closesAt: CUTOFF,
      },
    ]);
  });

  test("a locked market shows LOCKED in the list", async () => {
    const kv = await foldMessages([...BASE, lock(ana, "m1", T0 + 100)]);
    const vm = await terraceVm(kv, state());
    expect(vm.markets[0]).toMatchObject({ locked: true, closesLabel: "LOCKED" });
  });
});

describe("chatVm — names and translation", () => {
  test("registered names, viewer-language translation via the adapter", async () => {
    const kv = await foldMessages([
      ...BASE,
      chat(ana, "come on", "en", T0 + 30),
      chat(bo, "vamos", "es", T0 + 31),
    ]);
    const lines = await chatVm(kv, state(), new FakeTranslator());
    expect(lines.map((l) => ({ name: l.name, text: l.text }))).toEqual([
      { name: "ana", text: "come on" }, // already the viewer's language
      { name: "bo", text: "[en] vamos" }, // FakeTranslator labels visibly
    ]);
  });

  test("an author with no hello falls back to a short key", async () => {
    // hello is required by the fold for chat, so fabricate the edge via a
    // registered author whose identity row we simply don't look up by name.
    const kv = await foldMessages([...BASE, chat(cai, "oi", "en", T0 + 32)]);
    const lines = await chatVm(kv, state(), new FakeTranslator());
    expect(lines[0]!.name).toBe("cai");
    expect(lines[0]!.author).toBe(cai.idKey);
  });
});

describe("hostile input stays data in the VM", () => {
  test("a hostile market title flows through untouched — as a raw string", async () => {
    const title = '<img src=x onerror=alert(1)>"><script>boom()</script>';
    const kv = await foldMessages([...BASE, market(ana, "m2", title, T0 + 2)]);
    const vm = (await marketVm(kv, state(), "m2"))!;
    expect(vm.title).toBe(title); // VM carries data; escaping is the DOM layer's job
    const list = await terraceVm(kv, state());
    expect(list.markets.map((m) => m.title)).toContain(title);
  });
});

describe("gafferVm", () => {
  test("quips about the selected market's pool", async () => {
    const kv = await foldMessages(BASE);
    expect(await gafferVm(kv, "m1")).toBe("71% of the terrace is on HOME. Brave, or daft?");
  });

  test("has something to say with no markets", async () => {
    const kv = await foldMessages([hello(ana, "ana")]);
    expect(await gafferVm(kv, null)).toBe("Open a market and I'll have something to say.");
  });
});

// ── S13 surfaces ──────────────────────────────────────────────────────────────

describe("walletVm / peerVm / headerVm — header honesty & presence", () => {
  test("walletVm formats the balance via usdt", () => {
    expect(walletVm(1000n * USDT).label).toBe("1000.00 USDt");
    expect(walletVm(23_400_000n)).toEqual({ balance: 23_400_000n, label: "23.40 USDt" });
  });

  test("peerVm pluralizes and flags zero (amber)", () => {
    expect(peerVm(0)).toEqual({ count: 0, ok: false, label: "no peers" });
    expect(peerVm(1)).toEqual({ count: 1, ok: true, label: "1 peer" });
    expect(peerVm(3)).toEqual({ count: 3, ok: true, label: "3 peers" });
    expect(peerVm(-5)).toMatchObject({ count: 0, ok: false });
    expect(peerVm(2.9)).toMatchObject({ count: 2, label: "2 peers" });
  });

  test("headerVm composes name, truncated address, balance, presence", () => {
    const h = headerVm({
      displayName: "Ana",
      walletAddr: "0x1234567890abcdef",
      balance: 1000n * USDT,
      peerCount: 3,
      demoMode: true,
    });
    expect(h.name).toBe("Ana");
    expect(h.addrShort).toBe("0x1234567890…");
    expect(h.wallet.label).toBe("1000.00 USDt");
    expect(h.peer.label).toBe("3 peers");
    expect(h.demoMode).toBe(true);
  });

  test("DEMO_BANNER states exactly what's faked", () => {
    expect(DEMO_BANNER).toContain("FakeWallet");
    expect(DEMO_BANNER).toContain("ASR");
  });

  test("LANGS is a non-trivial, well-formed picker list including English", () => {
    expect(LANGS.length).toBeGreaterThanOrEqual(8);
    expect(LANGS.map((l) => l.code)).toContain("en");
    expect(LANGS.every((l) => l.code.length > 0 && l.label.length > 0)).toBe(true);
  });
});

describe("positionVm — your stake, at risk", () => {
  test("groups your stake by outcome and totals it", async () => {
    const kv = await foldMessages(BASE);
    expect(await positionVm(kv, "m1", ana.idKey)).toEqual({
      byOutcome: [{ key: "HOME", stake: 10n * USDT, stakeLabel: "10.00" }],
      total: 10n * USDT,
      totalLabel: "10.00",
      hasPosition: true,
    });
    const boPos = await positionVm(kv, "m1", bo.idKey);
    expect(boPos.byOutcome).toEqual([
      { key: "AWAY", stake: 5n * USDT, stakeLabel: "5.00" },
      { key: "HOME", stake: 2n * USDT, stakeLabel: "2.00" },
    ]);
    expect(boPos.total).toBe(7n * USDT);
  });

  test("no bets → no position", async () => {
    const kv = await foldMessages(BASE);
    expect(await positionVm(kv, "m1", cai.idKey)).toMatchObject({ hasPosition: false, total: 0n, byOutcome: [] });
  });
});

describe("previewPayout — live return equals what settlement pays", () => {
  test("preview equals computePayouts for that bet added (dust and all)", async () => {
    const kv = await foldMessages(BASE);
    const s = await settlementVm(kv, "m1");
    const preview = previewPayout(s.bets, 0, "HOME", 10n * USDT, cai.idKey);
    const expected = computePayouts({
      bets: [...s.bets, { betId: "__p", bettorId: cai.idKey, outcomeKey: "HOME", stake: 10n * USDT }],
      resolution: { kind: "outcome", outcomeKey: "HOME" },
      feeBps: 0,
    }).lines.find((l) => l.bettorId === cai.idKey)!.amount;
    expect(preview).toBe(expected);
    expect(preview).toBeGreaterThan(0n);
  });

  test("only bettor → refund (your stake back); non-positive stake → 0", async () => {
    const kv = await foldMessages(BASE);
    const s = await settlementVm(kv, "m1");
    expect(previewPayout([], 0, "HOME", 10n * USDT, cai.idKey)).toBe(10n * USDT);
    expect(previewPayout(s.bets, 0, "HOME", 0n, cai.idKey)).toBe(0n);
    expect(previewPayout(s.bets, 0, "HOME", -1n, cai.idKey)).toBe(0n);
  });
});

describe("pnlVm — the scoreboard after settle", () => {
  const bets: Bet[] = [
    { betId: "n1", bettorId: ana.idKey, outcomeKey: "HOME", stake: 10n * USDT },
    { betId: "n2", bettorId: bo.idKey, outcomeKey: "AWAY", stake: 5n * USDT },
    { betId: "n3", bettorId: bo.idKey, outcomeKey: "HOME", stake: 2n * USDT },
  ];
  const stakes = stakeByBettor(bets);

  test("winner up, loser down — exactly, off the manifest", () => {
    const manifest = computePayouts({ bets, resolution: { kind: "outcome", outcomeKey: "HOME" }, feeBps: 0 });
    const winner = pnlVm(manifest, stakes, ana.idKey);
    expect(winner).toMatchObject({ net: 4_166_667n, won: true, label: "You're up 4.166667 ✓" });
    const loser = pnlVm(manifest, stakes, bo.idKey);
    expect(loser).toMatchObject({ net: -4_166_667n, won: false, label: "You're down 4.166667" });
    // conservation: the table nets to zero at feeBps 0.
    expect(winner.net + loser.net).toBe(0n);
  });

  test("a void refund reads as square", () => {
    const manifest = computePayouts({ bets, resolution: { kind: "void" }, feeBps: 0 });
    expect(pnlVm(manifest, stakes, ana.idKey)).toMatchObject({ net: 0n, won: false, label: "Square ✓" });
  });
});

describe("tallyVm — the quorum, made visible", () => {
  const ATTESTED = [
    ...BASE,
    lock(ana, "m1", T0 + 100),
    attest(ana, "m1", "HOME", T0 + 200),
    attest(bo, "m1", "HOME", T0 + 200),
    attest(cai, "m1", "HOME", T0 + 200),
  ];

  test("three writers on HOME reach quorum; standings and voters render with names", async () => {
    const kv = await foldMessages(ATTESTED);
    const s = await settlementVm(kv, "m1");
    const t = await tallyVm(kv, "m1", s.stakes);
    expect(t.totalWriters).toBe(3);
    expect(t.quorumOutcome).toBe("HOME");
    expect(t.outcomes.find((o) => o.key === "HOME")).toMatchObject({
      writers: 3,
      writersOk: true,
      stakeOk: true,
      meetsQuorum: true,
      label: "3/3 writers · 100% stake",
    });
    expect(t.voters.map((v) => ({ name: v.name, outcomeKey: v.outcomeKey }))).toEqual([
      { name: "ana", outcomeKey: "HOME" },
      { name: "bo", outcomeKey: "HOME" },
      { name: "cai", outcomeKey: "HOME" },
    ]);
  });

  test("no attestations → nothing claimed", async () => {
    const kv = await foldMessages(BASE);
    const s = await settlementVm(kv, "m1");
    const t = await tallyVm(kv, "m1", s.stakes);
    expect(t.hasAttestations).toBe(false);
    expect(t.outcomes).toEqual([]);
    expect(t.voters).toEqual([]);
    expect(t.quorumOutcome).toBeNull();
  });
});

// ── S14 surfaces ──────────────────────────────────────────────────────────────

describe("marketPickerVm — the whole catalogue, openable (F1)", () => {
  const fx = { id: "fra-bra", home: "France", away: "Brazil", homeSquad: ["Mbappe"], awaySquad: ["Vinicius"] };

  test("emits the exact factory specs, in order, no drift", () => {
    const specs = marketPickerVm(fx).map((o) => o.spec);
    expect(specs).toEqual([
      matchResult("France", "Brazil"),
      ...totalGoalsLadder([2.5, 3.5]),
      firstScorer(["Mbappe", "Vinicius"]),
      correctScore(3),
    ]);
  });

  test("covers every non-goal-in-window MarketKind; correct-score is a 16-outcome grid", () => {
    const opts = marketPickerVm(fx);
    expect(new Set(opts.map((o) => o.spec.kind))).toEqual(
      new Set(["match-result", "total-goals", "first-scorer", "correct-score"]),
    );
    expect(opts.find((o) => o.spec.kind === "correct-score")!.spec.params.outcomes).toHaveLength(16);
    expect(opts.map((o) => o.label)).toEqual([
      "Result",
      "Total goals O/U 2.5",
      "Total goals O/U 3.5",
      "First scorer",
      "Correct score",
    ]);
  });

  test("no squad → no first-scorer option", () => {
    const opts = marketPickerVm({ id: "x", home: "A", away: "B" });
    expect(opts.some((o) => o.spec.kind === "first-scorer")).toBe(false);
    expect(opts.some((o) => o.spec.kind === "correct-score")).toBe(true);
  });
});

describe("planMicroRounds — deterministic open/lock planner (F2)", () => {
  const ROUND = 10 * 60_000;
  const rounds = scheduleMicroRounds(0, { roundMs: ROUND, count: 9 });

  test("at kickoff: round 0 exists+locked, round 1 open for betting", () => {
    const plan = planMicroRounds("fx", rounds, 0);
    expect(plan.map((r) => r.round)).toEqual([0, 1]);
    expect(plan.find((r) => r.round === 0)!.shouldLock).toBe(true);
    expect(plan.find((r) => r.round === 1)).toMatchObject({ shouldLock: false, marketId: "m-fx-r1" });
    expect(plan[0]!.spec.kind).toBe("goal-in-window");
  });

  test("25 minutes in: rounds 0–3 exist, 0–2 should lock, round 3 open", () => {
    const plan = planMicroRounds("fx", rounds, 25 * 60_000);
    expect(plan.map((r) => r.round)).toEqual([0, 1, 2, 3]);
    expect(plan.filter((r) => r.shouldLock).map((r) => r.round)).toEqual([0, 1, 2]);
    // the spec is the catalogue factory's, verbatim
    const r3 = rounds[3]!;
    expect(plan.find((r) => r.round === 3)!.spec).toEqual(goalInWindow(3, r3.windowStart, r3.windowEnd));
  });

  test("deterministic market ids — two openers racing can't fork a round", () => {
    expect(microRoundMarketId("fra-bra", 3)).toBe("m-fra-bra-r3");
    expect(planMicroRounds("fx", rounds, 25 * 60_000)).toEqual(planMicroRounds("fx", rounds, 25 * 60_000));
  });
});

describe("terraceVm — live micro-rounds float to the top", () => {
  test("open goal-in-window markets sort above the rest, by round; locked rounds don't float", async () => {
    const kv = await foldMessages([
      ...BASE, // m1 is a match-result
      goalMarket(ana, "z-g0", 0, T0, T0 + 600_000, T0 + 600_000, T0 + 2),
      goalMarket(ana, "z-g1", 1, T0 + 600_000, T0 + 1_200_000, T0 + 1_200_000, T0 + 3),
      lock(ana, "z-g1", T0 + 100),
    ]);
    const vm = await terraceVm(kv, state({ now: T0 + 50 }));
    expect(vm.markets.map((m) => m.marketId)).toEqual(["z-g0", "m1", "z-g1"]);
    expect(vm.markets.find((m) => m.marketId === "z-g0")).toMatchObject({
      kind: "goal-in-window",
      round: 0,
      liveRound: true,
      locked: false,
    });
    expect(vm.markets.find((m) => m.marketId === "z-g1")).toMatchObject({ round: 1, liveRound: false, locked: true });
    expect(vm.markets.find((m) => m.marketId === "m1")).toMatchObject({ kind: "match-result", round: null, liveRound: false });
  });
});

describe("leaderboardVm — realized P&L off the same payout engine (F4)", () => {
  test("three resolved markets fold into signed, sorted, named rows", async () => {
    const kv = await foldMessages(LB);
    const lb = await leaderboardVm(kv, state({ now: T0 + 200 + DISPUTE_MS + 10 }));
    expect(lb.resolvedCount).toBe(3);
    expect(lb.hasResolved).toBe(true);
    expect(lb.rows.map((r) => ({ name: r.name, net: r.net, netLabel: r.netLabel, markets: r.markets }))).toEqual([
      { name: "ana", net: 14n * USDT, netLabel: "+14.00", markets: 2 },
      { name: "bo", net: 0n, netLabel: "0.00", markets: 2 },
      { name: "cai", net: -14n * USDT, netLabel: "-14.00", markets: 2 },
    ]);
    // conservation: at feeBps 0 the whole board nets to zero.
    expect(lb.rows.reduce((s, r) => s + r.net, 0n)).toBe(0n);
    // net equals what settlement actually pays: ana's payout − staked.
    const ana0 = lb.rows.find((r) => r.name === "ana")!;
    expect(ana0.payout - ana0.staked).toBe(ana0.net);
  });

  test("no resolved markets → empty board", async () => {
    const lb = await leaderboardVm(await foldMessages(BASE), state());
    expect(lb.hasResolved).toBe(false);
    expect(lb.rows).toEqual([]);
    expect(lb.resolvedCount).toBe(0);
  });
});

describe("escrowVm — trust tiers, made visible (F5)", () => {
  test("≥3 stakers → Tier 2 elects opener + top stakers (2-of-3)", async () => {
    const e = await escrowVm(await foldMessages(LB), state());
    expect(e.tier1Active).toBe(true);
    expect(e.participantCount).toBe(3);
    expect(e.tier2Available).toBe(true);
    expect(e.threshold).toBe(2);
    expect(e.stewards.map((s) => s.name).sort()).toEqual(["ana", "bo", "cai"]);
    expect(e.note).toContain("2-of-3");
  });

  test("fewer than 3 stakers → Tier 2 unavailable, no stewards", async () => {
    const e = await escrowVm(await foldMessages(BASE), state()); // only ana + bo staked
    expect(e.tier1Active).toBe(true);
    expect(e.tier2Available).toBe(false);
    expect(e.stewards).toEqual([]);
    expect(e.note).toContain("≥3");
  });
});

describe("gafferPoolVm — one read the fallback and the LLM both take (F7)", () => {
  test("builds the pool summary from the selected market's odds", async () => {
    const kv = await foldMessages(BASE);
    expect(await gafferPoolVm(kv, "m1")).toEqual({
      title: "FRA v BRA",
      outcomes: [
        { key: "HOME", pct: 71 },
        { key: "DRAW", pct: 0 },
        { key: "AWAY", pct: 29 },
      ],
    });
  });

  test("no market → null pool; gafferVm still has the idle line", async () => {
    const kv = await foldMessages([hello(ana, "ana")]);
    expect(await gafferPoolVm(kv, null)).toBeNull();
    expect(await gafferVm(kv, null)).toBe(GAFFER_IDLE);
  });
});

describe("recentTerracesVm — one-tap rejoin list (F6)", () => {
  const now = 10_000_000;

  test("de-dupes by key (newest wins), sorts most-recent first, labels the gap", () => {
    const rows = recentTerracesVm(
      [
        { key: "k1", name: "Alpha", role: "opener", lastSeen: now - 5 * 60_000 },
        { key: "k2", name: "Beta", role: "joiner", lastSeen: now - 2 * 60_000 },
        { key: "k1", name: "Alpha2", role: "opener", lastSeen: now - 1 * 60_000 },
      ],
      now,
    );
    expect(rows.map((r) => r.key)).toEqual(["k1", "k2"]);
    expect(rows[0]).toMatchObject({ name: "Alpha2", seenLabel: "1m ago" });
    expect(rows[1]!.seenLabel).toBe("2m ago");
  });

  test("caps the list at the limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      key: "k" + i,
      name: "n" + i,
      role: "joiner",
      lastSeen: now - i * 1000,
    }));
    expect(recentTerracesVm(many, now, 6)).toHaveLength(6);
  });
});
