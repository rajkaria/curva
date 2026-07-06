import { describe, expect, test } from "vitest";
import { randomIdentity, type Identity } from "../src/identity.js";
import { signMessage, type Msg } from "../src/protocol.js";
import {
  foldMessages,
  isLocked,
  readMarket,
  readPools,
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
