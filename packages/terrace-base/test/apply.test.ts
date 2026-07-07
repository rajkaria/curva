import { describe, expect, test } from "vitest";
import { randomIdentity, type Identity } from "../src/identity.js";
import { signMessage, type Msg, type UnsignedMsg } from "../src/protocol.js";
import { MemoryKV } from "../src/view.js";
import {
  applyMessage,
  foldMessages,
  isLocked,
  readChat,
  readMarket,
  readPools,
  readReceipts,
  readValidBets,
  readAttestations,
  readIdentities,
  viewDigest,
} from "../src/apply.js";

const USDT = 1_000_000n;
const ana = randomIdentity();
const bo = randomIdentity();
const cai = randomIdentity();

function hello(id: Identity, name: string, ts = 1): Msg {
  return signMessage(
    { t: "hello", v: 1, author: id.idKey, name, walletAddr: "0x" + name, ts },
    id.privKey,
  );
}
function market(id: Identity, marketId: string, cutoffAt: number, feeBps = 0, ts = 2): Msg {
  return signMessage(
    {
      t: "market",
      v: 1,
      author: id.idKey,
      marketId,
      kind: "match-result",
      params: { title: "FRA v BRA", outcomes: ["HOME", "DRAW", "AWAY"] },
      cutoffAt,
      feeBps,
      ts,
    },
    id.privKey,
  );
}
function bet(id: Identity, marketId: string, outcomeKey: string, usdt: bigint, nonce: string, ts: number): Msg {
  return signMessage(
    { t: "bet", v: 1, author: id.idKey, marketId, outcomeKey, amount: usdt * USDT, nonce, ts },
    id.privKey,
  );
}
function lock(id: Identity, marketId: string, ts: number): Msg {
  return signMessage({ t: "lock", v: 1, author: id.idKey, marketId, ts }, id.privKey);
}
function attest(id: Identity, marketId: string, outcomeKey: string, confidence: number, ts: number): Msg {
  return signMessage(
    { t: "attest", v: 1, author: id.idKey, marketId, outcomeKey, evidence: { confidence }, ts },
    id.privKey,
  );
}

describe("fold — identities and markets", () => {
  test("hello registers an identity; market needs a registered opener", async () => {
    const kv = await foldMessages([hello(ana, "ana"), market(ana, "m1", 1000)]);
    expect((await readIdentities(kv)).get(ana.idKey)?.name).toBe("ana");
    expect(await readMarket(kv, "m1")).toMatchObject({ opener: ana.idKey, feeBps: 0 });
  });

  test("a market from an unknown author is dropped", async () => {
    const kv = await foldMessages([market(ana, "m1", 1000)]); // no hello first
    expect(await readMarket(kv, "m1")).toBeUndefined();
  });

  test("an invalid signature is dropped by every peer identically", async () => {
    const forged = { ...hello(ana, "ana"), name: "mallory" } as Msg; // sig no longer matches
    const kv = await foldMessages([forged]);
    expect((await readIdentities(kv)).size).toBe(0);
  });
});

describe("fold — bets and pools", () => {
  test("valid bets bump per-outcome gross pools", async () => {
    const kv = await foldMessages([
      hello(ana, "ana"),
      hello(bo, "bo"),
      market(ana, "m1", 1000),
      bet(ana, "m1", "HOME", 10n, "n1", 100),
      bet(bo, "m1", "AWAY", 5n, "n2", 100),
      bet(bo, "m1", "HOME", 2n, "n3", 100),
    ]);
    const pools = await readPools(kv, "m1");
    expect(pools["HOME"]).toBe(12n * USDT);
    expect(pools["AWAY"]).toBe(5n * USDT);
    expect((await readValidBets(kv, "m1")).length).toBe(3);
  });

  test("a bet on an unknown outcome is dropped", async () => {
    const kv = await foldMessages([
      hello(ana, "ana"),
      market(ana, "m1", 1000),
      bet(ana, "m1", "OFFSIDE", 10n, "n1", 100),
    ]);
    expect(await readPools(kv, "m1")).toEqual({});
  });

  test("a duplicate nonce is counted once (idempotent replay)", async () => {
    const b = bet(ana, "m1", "HOME", 10n, "dupe", 100);
    const kv = await foldMessages([hello(ana, "ana"), market(ana, "m1", 1000), b, b]);
    expect((await readPools(kv, "m1"))["HOME"]).toBe(10n * USDT);
    expect((await readValidBets(kv, "m1")).length).toBe(1);
  });
});

describe("the cutoff fence", () => {
  test("a bet that linearizes after the first lock is void", async () => {
    const kv = await foldMessages([
      hello(ana, "ana"),
      market(ana, "m1", 1000),
      bet(ana, "m1", "HOME", 10n, "n1", 500), // before lock → valid
      lock(bo === bo ? ana : ana, "m1", 1000), // first lock
      bet(ana, "m1", "HOME", 99n, "n2", 900), // after lock in log order → void
    ]);
    expect(await isLocked(kv, "m1")).toBe(true);
    expect((await readPools(kv, "m1"))["HOME"]).toBe(10n * USDT);
    expect((await readValidBets(kv, "m1")).length).toBe(1);
  });

  test("belt-and-braces: a bet stamped >90s past cutoff is void even before any lock", async () => {
    const kv = await foldMessages([
      hello(ana, "ana"),
      market(ana, "m1", 1000),
      bet(ana, "m1", "HOME", 10n, "n1", 1000 + 90_001), // ts beyond grace
    ]);
    expect(await readPools(kv, "m1")).toEqual({});
  });

  test("a bet exactly at the 90s grace boundary is still valid", async () => {
    const kv = await foldMessages([
      hello(ana, "ana"),
      market(ana, "m1", 1000),
      bet(ana, "m1", "HOME", 10n, "n1", 1000 + 90_000),
    ]);
    expect((await readPools(kv, "m1"))["HOME"]).toBe(10n * USDT);
  });
});

describe("attestations", () => {
  test("each writer's latest attestation is recorded (counter-attest replaces)", async () => {
    const kv = await foldMessages([
      hello(ana, "ana"),
      hello(bo, "bo"),
      market(ana, "m1", 1000),
      attest(ana, "m1", "HOME", 0.9, 2000),
      attest(bo, "m1", "HOME", 0.8, 2000),
      attest(bo, "m1", "AWAY", 0.7, 3000), // bo changes their mind
    ]);
    const tally = await readAttestations(kv, "m1");
    expect(tally.get(ana.idKey)?.outcomeKey).toBe("HOME");
    expect(tally.get(bo.idKey)?.outcomeKey).toBe("AWAY");
    expect(tally.size).toBe(2);
  });
});

describe("determinism (the convergence primitive)", () => {
  test("re-folding the identical linearized order reproduces the exact view", async () => {
    // Every peer shares Autobase's ONE linearized order → identical view digest.
    const msgs = [
      hello(ana, "ana"),
      hello(bo, "bo"),
      market(ana, "m1", 1000),
      bet(ana, "m1", "HOME", 10n, "n1", 100),
      lock(bo, "m1", 1000),
    ];
    expect(await viewDigest(await foldMessages(msgs))).toBe(await viewDigest(await foldMessages(msgs)));
  });

  test("logical state is invariant under any fence-preserving reordering", async () => {
    // Two deliveries that both keep the lock after the bets → same pools, same
    // valid-bet set, same attestations. (Raw view keys embed the seq index, so
    // convergence relies on the shared linearization, proven end-to-end in sim.)
    const base = [hello(ana, "ana"), hello(bo, "bo"), hello(cai, "cai"), market(ana, "m1", 1000)];
    const b1 = bet(ana, "m1", "HOME", 10n, "n1", 100);
    const b2 = bet(bo, "m1", "AWAY", 5n, "n2", 100);
    const lk = lock(cai, "m1", 1000);
    const at = attest(ana, "m1", "HOME", 0.9, 2000);

    const kvA = await foldMessages([...base, b1, b2, lk, at]);
    // Swap the concurrent helloes and the two concurrent bets; keep every
    // causal prereq (hello→market→bet→lock) intact, as any real linearization must.
    const kvB = await foldMessages([base[2], base[1], base[0], base[3], b2, b1, lk, at] as Msg[]);

    expect(await readPools(kvB, "m1")).toEqual(await readPools(kvA, "m1"));
    expect(new Set((await readValidBets(kvB, "m1")).map((b) => b.betId))).toEqual(
      new Set((await readValidBets(kvA, "m1")).map((b) => b.betId)),
    );
    expect(await readAttestations(kvB, "m1")).toEqual(await readAttestations(kvA, "m1"));
    expect(await isLocked(kvB, "m1")).toBe(true);
  });
});

describe("seq determinism — the counter lives in the view, not the process", () => {
  const msgs = (): Msg[] => [
    hello(ana, "ana"),
    hello(bo, "bo"),
    market(ana, "m1", 1000),
    bet(ana, "m1", "HOME", 10n, "n1", 100),
    bet(bo, "m1", "AWAY", 5n, "n2", 100),
    lock(bo, "m1", 1000),
    attest(ana, "m1", "HOME", 0.9, 2000),
  ];

  test("resuming a fold on a persisted view matches a one-shot fold (restart survival)", async () => {
    const all = msgs();
    const oneShot = await foldMessages(all);
    // First "process": applies a prefix, then dies.
    const kv = new MemoryKV();
    for (const m of all.slice(0, 3)) await applyMessage(kv, m);
    // Second "process": fresh memory, no in-process counter — resumes on the same view.
    for (const m of all.slice(3)) await applyMessage(kv, m);
    expect(await viewDigest(kv)).toBe(await viewDigest(oneShot));
  });

  test("dropped messages still advance the linearized index (key numbering is stable)", async () => {
    const forged = { ...hello(cai, "cai"), name: "mallory" } as Msg; // bad sig → dropped
    const kv = await foldMessages([
      hello(ana, "ana"), // seq 0
      market(ana, "m1", 1000), // seq 1
      forged, // seq 2 — dropped but counted
      bet(ana, "m1", "HOME", 10n, "n1", 100), // seq 3
    ]);
    const keys: string[] = [];
    for await (const { key } of kv.list({ gte: "bet!", lt: "bet!￿" })) keys.push(key);
    expect(keys).toEqual(["bet!m1!000000000003"]);
  });
});

describe("fold — field validation (hostile payloads die at the protocol layer)", () => {
  const sign = (unsigned: Record<string, unknown>, id: Identity): Msg =>
    signMessage(unsigned as unknown as UnsignedMsg, id.privKey);
  const withHello = async (bad: Msg): Promise<MemoryKV> => foldMessages([hello(ana, "ana"), bad]);
  const marketFields = (over: Record<string, unknown>): Record<string, unknown> => ({
    t: "market",
    v: 1,
    author: ana.idKey,
    marketId: "m1",
    kind: "match-result",
    params: { title: "FRA v BRA", outcomes: ["HOME", "DRAW", "AWAY"] },
    cutoffAt: 1000,
    feeBps: 0,
    ts: 2,
    ...over,
  });

  const badMarkets: Array<[string, Record<string, unknown>]> = [
    ["non-string title", marketFields({ params: { title: 7, outcomes: ["A", "B"] } })],
    ["oversize title", marketFields({ params: { title: "x".repeat(201), outcomes: ["A", "B"] } })],
    ["non-string outcome", marketFields({ params: { title: "t", outcomes: ["A", 5] } })],
    ["empty outcome", marketFields({ params: { title: "t", outcomes: ["A", ""] } })],
    ["oversize outcome", marketFields({ params: { title: "t", outcomes: ["A", "x".repeat(65)] } })],
    ["duplicate outcomes", marketFields({ params: { title: "t", outcomes: ["A", "A"] } })],
    [
      "too many outcomes",
      marketFields({ params: { title: "t", outcomes: Array.from({ length: 257 }, (_, i) => `o${i}`) } }),
    ],
    ["unknown kind", marketFields({ kind: "coin-flip" })],
    ["non-finite cutoff", marketFields({ cutoffAt: Number.NaN })],
    ["non-scalar meta value", marketFields({ params: { title: "t", outcomes: ["A", "B"], meta: { x: { nested: true } } } })],
  ];
  for (const [label, fields] of badMarkets) {
    test(`market with ${label} is dropped`, async () => {
      const kv = await withHello(sign(fields, ana));
      expect(await readMarket(kv, "m1")).toBeUndefined();
    });
  }

  test("hello with a non-string or oversize name is dropped", async () => {
    for (const name of [42, "x".repeat(41)]) {
      const kv = await foldMessages([
        sign({ t: "hello", v: 1, author: ana.idKey, name, walletAddr: "0xana", ts: 1 }, ana),
      ]);
      expect((await readIdentities(kv)).size).toBe(0);
    }
  });

  test("chat with non-string/oversize text or lang is dropped", async () => {
    const bads = [
      { text: 9, lang: "en" },
      { text: "x".repeat(2001), lang: "en" },
      { text: "hi", lang: "x".repeat(9) },
      { text: "hi", lang: 3 },
    ];
    for (const b of bads) {
      const kv = await withHello(sign({ t: "chat", v: 1, author: ana.idKey, ts: 5, ...b }, ana));
      expect((await readChat(kv)).length).toBe(0);
    }
  });

  test("bet with a non-string or oversize nonce is dropped", async () => {
    for (const nonce of [7, "", "x".repeat(65)]) {
      const kv = await foldMessages([
        hello(ana, "ana"),
        market(ana, "m1", 1000),
        sign({ t: "bet", v: 1, author: ana.idKey, marketId: "m1", outcomeKey: "HOME", amount: 1_000_000n, nonce, ts: 100 }, ana),
      ]);
      expect(await readPools(kv, "m1")).toEqual({});
    }
  });

  test("attest with out-of-range confidence or non-string asrScore is dropped", async () => {
    const bads = [{ confidence: 2 }, { confidence: Number.NaN }, { confidence: 0.5, asrScore: 9 }];
    for (const evidence of bads) {
      const kv = await foldMessages([
        hello(ana, "ana"),
        market(ana, "m1", 1000),
        sign({ t: "attest", v: 1, author: ana.idKey, marketId: "m1", outcomeKey: "HOME", evidence, ts: 100 }, ana),
      ]);
      expect((await readAttestations(kv, "m1")).size).toBe(0);
    }
  });

  test("receipt with a negative/non-integer line or non-string txid is dropped", async () => {
    const bads = [
      { manifestLine: -1, txid: "0xok" },
      { manifestLine: 1.5, txid: "0xok" },
      { manifestLine: 0, txid: 42 },
      { manifestLine: 0, txid: "x".repeat(129) },
    ];
    for (const b of bads) {
      const kv = await foldMessages([
        hello(ana, "ana"),
        market(ana, "m1", 1000),
        sign({ t: "receipt", v: 1, author: ana.idKey, marketId: "m1", ts: 100, ...b }, ana),
      ]);
      expect((await readReceipts(kv, "m1")).length).toBe(0);
    }
  });

  test("a message with an unknown schema version or non-finite ts is dropped", async () => {
    const v2 = sign({ t: "chat", v: 2, author: ana.idKey, text: "hi", lang: "en", ts: 5 }, ana);
    const badTs = sign({ t: "chat", v: 1, author: ana.idKey, text: "hi", lang: "en", ts: Number.NaN }, ana);
    const kv = await foldMessages([hello(ana, "ana"), v2, badTs]);
    expect((await readChat(kv)).length).toBe(0);
  });

  test("a valid dry-run receipt (empty txid) is still accepted", async () => {
    const kv = await foldMessages([
      hello(ana, "ana"),
      market(ana, "m1", 1000),
      sign({ t: "receipt", v: 1, author: ana.idKey, marketId: "m1", manifestLine: 0, txid: "", ts: 100 }, ana),
    ]);
    expect((await readReceipts(kv, "m1")).length).toBe(1);
  });
});
