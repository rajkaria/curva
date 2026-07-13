import { describe, expect, test } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  FakeVerifier,
  RpcVerifier,
  squareStatus,
  type ExpectedTransfer,
} from "../src/verify.js";

const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const AMOUNT = 25_000_000n; // 25 USDt in micros

const expected = (over: Partial<ExpectedTransfer> = {}): ExpectedTransfer => ({
  txid: "0xabc123",
  from: FROM,
  to: TO,
  amount: AMOUNT,
  ...over,
});

describe("FakeVerifier — the demo/test double", () => {
  const ledger = [{ txid: "0xabc123", from: FROM, to: TO, amount: AMOUNT }];

  test("confirmed when the txid exists and every field matches", async () => {
    expect(await new FakeVerifier(ledger).verify(expected())).toBe("confirmed");
  });

  test("pending when the txid is unknown (not yet mined)", async () => {
    expect(await new FakeVerifier(ledger).verify(expected({ txid: "0xnothere" }))).toBe("pending");
  });

  test("mismatch when the txid exists but a field differs", async () => {
    expect(await new FakeVerifier(ledger).verify(expected({ amount: 1n }))).toBe("mismatch");
    expect(await new FakeVerifier(ledger).verify(expected({ to: FROM }))).toBe("mismatch");
  });

  test("address comparison is case-insensitive (checksummed vs lowercase)", async () => {
    expect(await new FakeVerifier(ledger).verify(expected({ to: TO.toUpperCase().replace("0X", "0x") }))).toBe(
      "confirmed",
    );
  });
});

describe("squareStatus — the checklist upgrade logic (pure)", () => {
  test("maps every manifest line: unpaid / claimed / verified / mismatch", () => {
    const receipts = [
      { line: 0, txid: "0xaaa" },
      { line: 1, txid: "0xbbb" },
      { line: 2, txid: "0xccc" },
    ];
    const verdicts = new Map([
      ["0xaaa", "confirmed" as const],
      ["0xbbb", "mismatch" as const],
      // 0xccc has no verdict yet
    ]);
    expect(squareStatus(4, receipts, verdicts)).toEqual(["verified", "mismatch", "claimed", "unpaid"]);
  });

  test("a pending verdict stays claimed — never a false verified", () => {
    const verdicts = new Map([["0xaaa", "pending" as const]]);
    expect(squareStatus(1, [{ line: 0, txid: "0xaaa" }], verdicts)).toEqual(["claimed"]);
  });

  test("a dry-run receipt (empty txid) is claimed, not verifiable", () => {
    expect(squareStatus(1, [{ line: 0, txid: "" }], new Map())).toEqual(["claimed"]);
  });

  test("no verifier at all (empty verdicts) degrades every receipt to claimed", () => {
    expect(squareStatus(2, [{ line: 0, txid: "0xaaa" }], new Map())).toEqual(["claimed", "unpaid"]);
  });
});

// ── RpcVerifier over a canned receipt (no live RPC in CI) ────────────────────

const TRANSFER_TOPIC = "0x" + bytesToHex(keccak_256(utf8ToBytes("Transfer(address,address,uint256)")));
const pad32 = (addr: string) => "0x" + addr.slice(2).toLowerCase().padStart(64, "0");
const amountData = (amount: bigint) => "0x" + amount.toString(16).padStart(64, "0");

/** A canned eth_getTransactionReceipt result for a successful USDt transfer. */
function cannedReceipt(over: { to?: string; amount?: bigint; token?: string; status?: string } = {}) {
  return {
    status: over.status ?? "0x1",
    logs: [
      {
        address: (over.token ?? USDT).toLowerCase(),
        topics: [TRANSFER_TOPIC, pad32(FROM), pad32(over.to ?? TO)],
        data: amountData(over.amount ?? AMOUNT),
      },
    ],
  };
}

const rpcWith = (result: unknown): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

const verifier = (fetchFn: typeof fetch) =>
  new RpcVerifier({ rpcUrl: "http://rpc.invalid", usdtAddress: USDT, fetchFn });

describe("RpcVerifier — receipt + Transfer log decode", () => {
  test("confirmed on a mined tx whose Transfer log matches from/to/amount", async () => {
    expect(await verifier(rpcWith(cannedReceipt())).verify(expected())).toBe("confirmed");
  });

  test("pending while the tx is unmined (null receipt)", async () => {
    expect(await verifier(rpcWith(null)).verify(expected())).toBe("pending");
  });

  test("mismatch when the amount differs from the claim", async () => {
    expect(await verifier(rpcWith(cannedReceipt({ amount: 1n }))).verify(expected())).toBe("mismatch");
  });

  test("mismatch when the recipient differs from the claim", async () => {
    expect(await verifier(rpcWith(cannedReceipt({ to: FROM }))).verify(expected())).toBe("mismatch");
  });

  test("mismatch when the log is another token's Transfer", async () => {
    expect(
      await verifier(rpcWith(cannedReceipt({ token: "0x3333333333333333333333333333333333333333" }))).verify(
        expected(),
      ),
    ).toBe("mismatch");
  });

  test("mismatch on a reverted tx (status 0x0) — the money never moved", async () => {
    expect(await verifier(rpcWith(cannedReceipt({ status: "0x0" }))).verify(expected())).toBe("mismatch");
  });

  test("RPC down degrades to pending — never a false verified", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await verifier(down).verify(expected())).toBe("pending");
  });

  test("malformed RPC payload degrades to pending", async () => {
    const garbage = (async () => new Response("not json")) as unknown as typeof fetch;
    expect(await verifier(garbage).verify(expected())).toBe("pending");
  });
});

describe("squareSummary — the receipts-card line", () => {
  test("counts each status and omits empty categories", async () => {
    const { squareSummary } = await import("../src/verify.js");
    expect(squareSummary(["verified", "verified", "claimed", "unpaid"])).toBe(
      "✓✓ 2 verified · ✓ 1 claimed · 1 unpaid",
    );
    expect(squareSummary(["mismatch"])).toBe("⚠ 1 mismatch");
    expect(squareSummary([])).toBe("no transfers");
  });
});
