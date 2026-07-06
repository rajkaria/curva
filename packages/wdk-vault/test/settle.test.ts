import { describe, expect, test } from "vitest";
import { FakeWallet } from "../src/fake-wallet.js";
import { settlementManifest, settleMyDebts } from "../src/settle.js";
import { minTransfers } from "../src/netting.js";

const USDT = 1_000_000n;

describe("settlementManifest", () => {
  test("orders transfers canonically so every peer indexes them identically", () => {
    const t = minTransfers(new Map([["ana", 30n], ["bo", -20n], ["cai", -10n]]));
    const m1 = settlementManifest(t);
    const m2 = settlementManifest([...t].reverse());
    expect(m1).toEqual(m2); // canonical order regardless of input order
  });
});

describe("settleMyDebts — each debtor settles only its own lines", () => {
  const manifest = settlementManifest([
    { from: "0xLoser", to: "0xWinner", amount: 10n * USDT },
    { from: "0xOther", to: "0xWinner", amount: 5n * USDT },
  ]);

  test("a debtor pays its transfers and emits receipts with txids", async () => {
    const wallet = new FakeWallet("0xLoser", 50n * USDT);
    const receipts = await settleMyDebts(manifest, wallet);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ to: "0xWinner", amount: 10n * USDT });
    expect(receipts[0]!.txid).toMatch(/^0x/);
    expect(await wallet.balance()).toBe(40n * USDT); // debited
  });

  test("a peer that owes nothing on this manifest settles nothing", async () => {
    const wallet = new FakeWallet("0xWinner", 0n);
    expect(await settleMyDebts(manifest, wallet)).toEqual([]);
  });

  test("the union of every peer's receipts covers all lines exactly once", async () => {
    const loser = new FakeWallet("0xLoser", 50n * USDT);
    const other = new FakeWallet("0xOther", 50n * USDT);
    const lines = [
      ...(await settleMyDebts(manifest, loser)),
      ...(await settleMyDebts(manifest, other)),
    ].map((r) => r.line);
    expect(new Set(lines)).toEqual(new Set([0, 1]));
  });

  test("insufficient balance is refused before broadcasting", async () => {
    const wallet = new FakeWallet("0xLoser", 1n * USDT);
    await expect(settleMyDebts(manifest, wallet)).rejects.toThrow(/insufficient/i);
    expect(await wallet.balance()).toBe(1n * USDT); // nothing moved
  });

  test("dryRun previews receipts without moving money", async () => {
    const wallet = new FakeWallet("0xLoser", 50n * USDT);
    const receipts = await settleMyDebts(manifest, wallet, { dryRun: true });
    expect(receipts[0]!.txid).toBe("");
    expect(await wallet.balance()).toBe(50n * USDT);
  });
});
