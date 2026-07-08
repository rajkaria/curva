/**
 * End-to-end oracle path over the real protocol fold: sign hello/market/bet/
 * attest messages, fold them into a view, then read the attestation log +
 * staked weights straight out of the view and resolve. Proves terrace-base and
 * crowd-oracle line up — the log's `alog!` history and `bet!` stakes feed the
 * quorum rule with no glue code in between.
 */
import { describe, expect, test } from "vitest";
import {
  foldMessages,
  randomIdentity,
  signMessage,
  readAttestationLog,
  readValidBets,
  type Identity,
  type Msg,
} from "@curva/terrace-base";
import { resolveMarket, type AttestationEvent } from "../src/quorum.js";

const USDT = 1_000_000n;
const peers = { a: randomIdentity(), b: randomIdentity(), c: randomIdentity(), d: randomIdentity() };

function hello(id: Identity, name: string): Msg {
  return signMessage({ t: "hello", v: 1, author: id.idKey, name, walletAddr: "0x" + name, ts: 1 }, id.privKey);
}
function market(id: Identity): Msg {
  return signMessage(
    {
      t: "market", v: 1, author: id.idKey, marketId: "m1", kind: "match-result",
      params: { title: "FRA v BRA", outcomes: ["HOME", "DRAW", "AWAY"] },
      cutoffAt: 1000, feeBps: 0, ts: 2,
    },
    id.privKey,
  );
}
function bet(id: Identity, outcome: string, usdt: bigint, nonce: string): Msg {
  return signMessage(
    { t: "bet", v: 1, author: id.idKey, marketId: "m1", outcomeKey: outcome, amount: usdt * USDT, nonce, ts: 100 },
    id.privKey,
  );
}
function attest(id: Identity, outcome: string, ts: number): Msg {
  return signMessage(
    { t: "attest", v: 1, author: id.idKey, marketId: "m1", outcomeKey: outcome, evidence: { confidence: 0.9 }, ts },
    id.privKey,
  );
}

test("staked attestations fold, then resolve to a finalized outcome", async () => {
  const kv = await foldMessages([
    hello(peers.a, "a"), hello(peers.b, "b"), hello(peers.c, "c"), hello(peers.d, "d"),
    market(peers.a),
    bet(peers.a, "HOME", 30n, "n1"),
    bet(peers.b, "HOME", 30n, "n2"),
    bet(peers.c, "HOME", 30n, "n3"),
    bet(peers.d, "AWAY", 10n, "n4"),
    attest(peers.a, "HOME", 2000),
    attest(peers.b, "HOME", 2000),
    attest(peers.c, "HOME", 2000),
    attest(peers.d, "AWAY", 2000),
  ]);

  const events: AttestationEvent[] = await readAttestationLog(kv, "m1");
  expect(events).toHaveLength(4);

  const stakeByWriter = new Map<string, bigint>();
  for (const b of await readValidBets(kv, "m1")) {
    stakeByWriter.set(b.bettorId, (stakeByWriter.get(b.bettorId) ?? 0n) + b.stake);
  }

  const disputeWindowMs = 600_000;
  expect(resolveMarket({ events, stakeByWriter, now: 2000, disputeWindowMs })).toMatchObject({ status: "provisional", outcomeKey: "HOME" });
  expect(resolveMarket({ events, stakeByWriter, now: 2000 + disputeWindowMs, disputeWindowMs })).toMatchObject({ status: "resolved", outcomeKey: "HOME" });
});

describe("oracle rejects steering", () => {
  test("a whale's lone AWAY attestation cannot flip a HOME crowd", async () => {
    const kv = await foldMessages([
      hello(peers.a, "a"), hello(peers.b, "b"), hello(peers.c, "c"), hello(peers.d, "d"),
      market(peers.a),
      bet(peers.d, "AWAY", 10_000n, "n1"), // whale
      bet(peers.a, "HOME", 1n, "n2"),
      bet(peers.b, "HOME", 1n, "n3"),
      bet(peers.c, "HOME", 1n, "n4"),
      attest(peers.a, "HOME", 2000),
      attest(peers.b, "HOME", 2000),
      attest(peers.c, "HOME", 2000),
      attest(peers.d, "AWAY", 2000),
    ]);
    const events = await readAttestationLog(kv, "m1");
    const stakeByWriter = new Map<string, bigint>();
    for (const b of await readValidBets(kv, "m1")) stakeByWriter.set(b.bettorId, b.stake);
    // HOME has the writers but not the stake; AWAY has the stake but not the writers → open.
    expect(resolveMarket({ events, stakeByWriter, now: 999_999, disputeWindowMs: 600_000 }).status).toBe("open");
  });
});
