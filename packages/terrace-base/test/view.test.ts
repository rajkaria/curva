import { describe, expect, test } from "vitest";
import { MemoryKV } from "../src/view.js";
import { foldMessages, randomIdentity, signMessage, type Msg } from "../src/index.js";

describe("MemoryKV.version — the render loop's skip signal", () => {
  test("bumps on put and del, never on reads", async () => {
    const kv = new MemoryKV();
    expect(kv.version()).toBe(0);

    await kv.put("a", 1);
    expect(kv.version()).toBe(1);
    await kv.put("a", 2); // overwrite still counts — the view changed
    expect(kv.version()).toBe(2);
    await kv.del("a");
    expect(kv.version()).toBe(3);

    await kv.get("a");
    for await (const entry of kv.list()) void entry;
    await kv.dump();
    expect(kv.version()).toBe(3);
  });

  test("any applied message moves the version (meta!seq always advances)", async () => {
    const ana = randomIdentity();
    const hello: Msg = signMessage(
      { t: "hello", v: 1, author: ana.idKey, name: "ana", walletAddr: "0xana", ts: 1 },
      ana.privKey,
    );
    const kv = await foldMessages([hello]);
    const before = kv.version();
    expect(before).toBeGreaterThan(0);

    // Even a dropped message advances meta!seq — the version must move so a
    // renderer re-checks rather than trusting a stale view.
    const forged = { ...hello, name: "mallory" } as Msg;
    const { applyMessage } = await import("../src/apply.js");
    await applyMessage(kv, forged);
    expect(kv.version()).toBeGreaterThan(before);
  });
});
