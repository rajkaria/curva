import { describe, expect, test } from "vitest";
import { randomIdentity, type Identity } from "../src/identity.js";
import { signMessage, type Msg } from "../src/protocol.js";
import { foldMessages, readMarket, readPools, viewDigest } from "../src/apply.js";
import { MemoryTerraceNode } from "../src/memory-runtime.js";

const USDT = 1_000_000n;
const ana = randomIdentity();
const bo = randomIdentity();

function hello(id: Identity, name: string, ts = 1): Msg {
  return signMessage({ t: "hello", v: 1, author: id.idKey, name, walletAddr: "0x" + name, ts }, id.privKey);
}
function market(id: Identity, marketId: string, cutoffAt: number, ts = 2): Msg {
  return signMessage(
    {
      t: "market", v: 1, author: id.idKey, marketId, kind: "match-result",
      params: { title: "FRA v BRA", outcomes: ["HOME", "DRAW", "AWAY"] }, cutoffAt, feeBps: 0, ts,
    },
    id.privKey,
  );
}
function bet(id: Identity, marketId: string, outcomeKey: string, stake: bigint, nonce: string, ts: number): Msg {
  return signMessage({ t: "bet", v: 1, author: id.idKey, marketId, outcomeKey, amount: stake, nonce, ts }, id.privKey);
}
function lock(id: Identity, marketId: string, ts: number): Msg {
  return signMessage({ t: "lock", v: 1, author: id.idKey, marketId, ts }, id.privKey);
}

const SCRIPT: Msg[] = [
  hello(ana, "ana"),
  hello(bo, "bo"),
  market(ana, "m-1", 10_000),
  bet(ana, "m-1", "HOME", 10n * USDT, "n1", 100),
  bet(bo, "m-1", "AWAY", 5n * USDT, "n2", 101),
  bet(bo, "m-1", "AWAY", 5n * USDT, "n2", 102), // duplicate nonce — dropped
  lock(bo, "m-1", 200),
  bet(ana, "m-1", "HOME", 99n * USDT, "n3", 201), // after the fence — dropped
];

describe("MemoryTerraceNode — the TerraceNode surface with no Autobase/Hyperswarm", () => {
  test("the same script through the node and through foldMessages digest-matches", async () => {
    const node = await MemoryTerraceNode.open({});
    for (const msg of SCRIPT) await node.append(msg);
    const folded = await foldMessages(SCRIPT);
    expect(await viewDigest(node.view())).toBe(await viewDigest(folded));
    // and the derived state is the real thing, not a stub:
    expect(await readMarket(node.view(), "m-1")).toBeDefined();
    expect(await readPools(node.view(), "m-1")).toEqual({ HOME: 10n * USDT, AWAY: 5n * USDT });
  });

  test("writable immediately; version strictly increases per applied append", async () => {
    const node = await MemoryTerraceNode.open({});
    expect(node.writable()).toBe(true);
    const v0 = node.version();
    await node.append(hello(ana, "ana"));
    const v1 = node.version();
    expect(v1).toBeGreaterThan(v0);
    await node.append(market(ana, "m-1", 10_000));
    expect(node.version()).toBeGreaterThan(v1);
  });

  test("a dropped message still advances the version (seq counts every message)", async () => {
    const node = await MemoryTerraceNode.open({});
    await node.append(hello(ana, "ana"));
    const v = node.version();
    // bo never said hello — this bet is silently dropped by the fold, but the
    // linearized index (meta!seq) still advances, exactly like on-device.
    await node.append(bet(bo, "m-x", "HOME", USDT, "n", 5));
    expect(node.version()).toBeGreaterThan(v);
  });

  test("key/localWriterKey are stable 64-hex; update/addWriter/joinSwarm are safe no-ops", async () => {
    const node = await MemoryTerraceNode.open({ inviteKey: "ab".repeat(32) });
    expect(node.key()).toBe("ab".repeat(32));
    expect(node.localWriterKey()).toMatch(/^[0-9a-f]{64}$/);
    expect(node.localWriterKey()).toBe(node.localWriterKey());
    await node.joinSwarm();
    await node.update();
    await node.addWriter("cd".repeat(32));
    await node.close();
  });

  test("peer presence is scriptable for the demo (connect/disconnect)", async () => {
    const node = await MemoryTerraceNode.open({});
    expect(node.peerCount()).toBe(0);
    node.connectPeer();
    node.connectPeer();
    expect(node.peerCount()).toBe(2);
    node.disconnectPeer();
    expect(node.peerCount()).toBe(1);
    node.disconnectPeer();
    node.disconnectPeer(); // never below zero
    expect(node.peerCount()).toBe(0);
  });
});
