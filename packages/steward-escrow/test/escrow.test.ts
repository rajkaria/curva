import { describe, expect, test } from "vitest";
import { randomIdentity } from "@tifo/terrace-base";
import { electStewards } from "../src/election.js";
import { FakeEscrowChain, verifyBetDeposit } from "../src/deposit.js";
import { payoutInstructionDigest, signPayout, coSignPayout } from "../src/multisig.js";

const USDT = 1_000_000n;
const ids = Array.from({ length: 5 }, () => randomIdentity());

describe("steward election", () => {
  test("elects the opener + top-2 stakers as a 2-of-3 signer set", () => {
    const stake = new Map([
      [ids[0]!.idKey, 5n * USDT], // opener
      [ids[1]!.idKey, 100n * USDT],
      [ids[2]!.idKey, 80n * USDT],
      [ids[3]!.idKey, 1n * USDT],
    ]);
    const set = electStewards(ids[0]!.idKey, stake);
    expect(set.threshold).toBe(2);
    expect(set.stewards).toHaveLength(3);
    expect(set.stewards).toContain(ids[0]!.idKey); // opener always a steward
    expect(set.stewards).toContain(ids[1]!.idKey); // top staker
    expect(set.stewards).toContain(ids[2]!.idKey); // second staker
    expect(set.stewards).not.toContain(ids[3]!.idKey);
  });

  test("is deterministic and breaks stake ties by idKey", () => {
    const stake = new Map([[ids[0]!.idKey, 1n], [ids[1]!.idKey, 5n], [ids[2]!.idKey, 5n], [ids[3]!.idKey, 5n]]);
    expect(electStewards(ids[0]!.idKey, stake)).toEqual(electStewards(ids[0]!.idKey, stake));
  });

  test("refuses to form escrow with fewer than 3 participants", () => {
    expect(() => electStewards(ids[0]!.idKey, new Map([[ids[0]!.idKey, 1n], [ids[1]!.idKey, 1n]]))).toThrow(/3/);
  });
});

describe("deposit verification (per-peer, against the chain)", () => {
  const escrowAddr = "0xEscrow";
  const chain = new FakeEscrowChain({
    "0xtxGood": { to: "0xescrow", from: "0xana", amount: 50n * USDT },
    "0xtxShort": { to: "0xEscrow", from: "0xana", amount: 10n * USDT },
    "0xtxWrongDest": { to: "0xSomeoneElse", from: "0xana", amount: 50n * USDT },
  });

  test("accepts a deposit to the escrow of at least the stake (address case-insensitive)", async () => {
    expect(await verifyBetDeposit({ escrowTxid: "0xtxGood", stake: 50n * USDT, escrowAddress: escrowAddr }, chain)).toBe(true);
  });

  test("rejects an underfunded deposit", async () => {
    expect(await verifyBetDeposit({ escrowTxid: "0xtxShort", stake: 50n * USDT, escrowAddress: escrowAddr }, chain)).toBe(false);
  });

  test("rejects a deposit to the wrong address", async () => {
    expect(await verifyBetDeposit({ escrowTxid: "0xtxWrongDest", stake: 50n * USDT, escrowAddress: escrowAddr }, chain)).toBe(false);
  });

  test("rejects an unknown txid", async () => {
    expect(await verifyBetDeposit({ escrowTxid: "0xNope", stake: 1n, escrowAddress: escrowAddr }, chain)).toBe(false);
  });
});

describe("2-of-3 payout co-signing", () => {
  const stake = new Map([[ids[0]!.idKey, 5n * USDT], [ids[1]!.idKey, 100n * USDT], [ids[2]!.idKey, 80n * USDT]]);
  const set = electStewards(ids[0]!.idKey, stake);
  const instruction = { marketId: "m1", line: 0, to: "0xWinner", amount: 42n * USDT };

  test("a digest is stable across field order", () => {
    expect(payoutInstructionDigest(instruction)).toBe(
      payoutInstructionDigest({ amount: 42n * USDT, to: "0xWinner", line: 0, marketId: "m1" }),
    );
  });

  test("two distinct stewards authorize a payout", () => {
    const sigs = [signPayout(instruction, ids[0]!), signPayout(instruction, ids[1]!)];
    const result = coSignPayout(instruction, sigs, set);
    expect(result.authorized).toBe(true);
    expect(result.signers).toHaveLength(2);
  });

  test("one steward is not enough", () => {
    const result = coSignPayout(instruction, [signPayout(instruction, ids[0]!)], set);
    expect(result.authorized).toBe(false);
  });

  test("a non-steward signature does not count toward threshold", () => {
    const outsider = ids[3]!;
    const sigs = [signPayout(instruction, ids[0]!), signPayout(instruction, outsider)];
    const result = coSignPayout(instruction, sigs, set);
    expect(result.authorized).toBe(false);
    expect(result.signers).toEqual([ids[0]!.idKey]);
  });

  test("the same steward signing twice counts once", () => {
    const sigs = [signPayout(instruction, ids[0]!), signPayout(instruction, ids[0]!)];
    expect(coSignPayout(instruction, sigs, set).authorized).toBe(false);
  });

  test("a signature over a different instruction is rejected", () => {
    const forged = signPayout({ ...instruction, amount: 999n * USDT }, ids[1]!);
    const result = coSignPayout(instruction, [signPayout(instruction, ids[0]!), forged], set);
    expect(result.authorized).toBe(false);
  });
});
