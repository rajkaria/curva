import { describe, expect, test } from "vitest";
import { randomIdentity } from "@curva/terrace-base";
import { readPools, readValidBets, isLocked } from "@curva/terrace-base";
import { Swarm } from "../src/swarm.js";

const USDT = 1_000_000n;

function terrace(n: number): Swarm {
  const swarm = new Swarm();
  for (let i = 0; i < n; i++) swarm.addPeer(randomIdentity(), `peer${i}`);
  return swarm;
}

async function helloAll(swarm: Swarm): Promise<void> {
  for (const p of swarm.peers) {
    swarm.emit(p, { t: "hello", name: p.name, walletAddr: "0x" + p.name, ts: 1 });
  }
  swarm.flush();
}

describe("3-peer convergence (the S2 gate)", () => {
  test("independent bets from 3 writers converge to identical pools", async () => {
    const swarm = terrace(3);
    const [a, b, c] = swarm.peers;
    await helloAll(swarm);

    swarm.emit(a!, {
      t: "market",
      marketId: "m1",
      kind: "match-result",
      params: { title: "FRA v BRA", outcomes: ["HOME", "DRAW", "AWAY"] },
      cutoffAt: 10_000,
      feeBps: 0,
      ts: 2,
    });
    swarm.flush();

    swarm.emit(a!, { t: "bet", marketId: "m1", outcomeKey: "HOME", amount: 10n * USDT, nonce: "a1", ts: 100 });
    swarm.emit(b!, { t: "bet", marketId: "m1", outcomeKey: "AWAY", amount: 5n * USDT, nonce: "b1", ts: 100 });
    swarm.emit(c!, { t: "bet", marketId: "m1", outcomeKey: "HOME", amount: 2n * USDT, nonce: "c1", ts: 100 });
    swarm.flush();

    expect(await swarm.converged()).toBe(true);
    const pools = await readPools(await a!.view(), "m1");
    expect(pools["HOME"]).toBe(12n * USDT);
    expect(pools["AWAY"]).toBe(5n * USDT);
  });
});

describe("partition and heal (CRDT — partitions heal for free)", () => {
  test("peers that bet in isolation converge once the partition heals", async () => {
    const swarm = terrace(3);
    const [a, b, c] = swarm.peers;
    await helloAll(swarm);
    swarm.emit(a!, {
      t: "market",
      marketId: "m1",
      kind: "match-result",
      params: { title: "x", outcomes: ["HOME", "AWAY"] },
      cutoffAt: 10_000,
      feeBps: 0,
      ts: 2,
    });
    swarm.flush();

    // Partition: peer C hears nothing while A and B trade.
    swarm.emit(a!, { t: "bet", marketId: "m1", outcomeKey: "HOME", amount: 10n * USDT, nonce: "a1", ts: 100 });
    swarm.emit(b!, { t: "bet", marketId: "m1", outcomeKey: "AWAY", amount: 7n * USDT, nonce: "b1", ts: 100 });
    swarm.flush((i) => i !== 2); // deliver to everyone except C

    // Meanwhile C bets in its own partition.
    swarm.emit(c!, { t: "bet", marketId: "m1", outcomeKey: "HOME", amount: 3n * USDT, nonce: "c1", ts: 100 });
    swarm.flush((i) => i === 0 || i === 1 ? false : true); // C's bet reaches only C for now

    expect(await swarm.converged()).toBe(false); // diverged while partitioned

    // Heal: deliver everything still in flight to everyone.
    swarm.flush();
    expect(await swarm.converged()).toBe(true);
    expect((await readPools(await c!.view(), "m1"))["HOME"]).toBe(13n * USDT);
  });
});

describe("the cutoff fence under gossip", () => {
  test("a late bet that arrives after the lock is void on every peer", async () => {
    const swarm = terrace(3);
    const [a, b, c] = swarm.peers;
    await helloAll(swarm);
    swarm.emit(a!, {
      t: "market",
      marketId: "m1",
      kind: "match-result",
      params: { title: "x", outcomes: ["HOME", "AWAY"] },
      cutoffAt: 1000,
      feeBps: 0,
      ts: 2,
    });
    swarm.flush();

    swarm.emit(a!, { t: "bet", marketId: "m1", outcomeKey: "HOME", amount: 10n * USDT, nonce: "a1", ts: 500 });
    swarm.flush(); // everyone sees the honest bet and its lamport

    // Honest lock at cutoff — every peer now advances past the lock's lamport.
    swarm.emit(b!, { t: "lock", marketId: "m1", ts: 1000 });
    swarm.flush();

    // Cheater C, having received the lock, tries to sneak a bet in.
    swarm.emit(c!, { t: "bet", marketId: "m1", outcomeKey: "AWAY", amount: 99n * USDT, nonce: "c1", ts: 1001 });
    swarm.flush();

    expect(await swarm.converged()).toBe(true);
    const kv = await a!.view();
    expect(await isLocked(kv, "m1")).toBe(true);
    expect((await readPools(kv, "m1"))["HOME"]).toBe(10n * USDT);
    expect((await readPools(kv, "m1"))["AWAY"]).toBeUndefined(); // the sneak bet was fenced out
    expect((await readValidBets(kv, "m1")).length).toBe(1);
  });
});
