import { describe, expect, test } from "vitest";
import { randomIdentity } from "../src/identity.js";
import {
  canonicalize,
  signMessage,
  verifyMessage,
  messageDigest,
  type Msg,
  type BetMsg,
  type HelloMsg,
} from "../src/protocol.js";

describe("canonicalize", () => {
  test("is stable across key order and excludes the sig field", () => {
    const a = canonicalize({ t: "chat", v: 1, author: "aa", text: "hi", lang: "en", ts: 5, sig: "X" });
    const b = canonicalize({ sig: "Y", ts: 5, lang: "en", text: "hi", author: "aa", v: 1, t: "chat" });
    expect(a).toBe(b);
    expect(a).not.toContain("sig");
  });

  test("serializes bigint stake amounts losslessly as decimal strings", () => {
    const c = canonicalize({ amount: 12_345_678_901_234_567_890n });
    expect(c).toContain("12345678901234567890");
  });
});

describe("signMessage / verifyMessage", () => {
  const alice = randomIdentity();

  function unsignedHello(): Omit<HelloMsg, "sig"> {
    return { t: "hello", v: 1, author: alice.idKey, name: "Ana", walletAddr: "0xana", ts: 1 };
  }

  test("a signed message verifies against its author", () => {
    const msg = signMessage(unsignedHello(), alice.privKey);
    expect(msg.sig).toMatch(/^[0-9a-f]{130}$/);
    expect(verifyMessage(msg)).toBe(true);
  });

  test("a message whose author != signer fails", () => {
    const mallory = randomIdentity();
    const forged = signMessage({ ...unsignedHello(), author: mallory.idKey }, alice.privKey);
    // author says mallory, signed by alice → recovered signer (alice) != author
    expect(verifyMessage(forged)).toBe(false);
  });

  test("tampering with any field after signing breaks verification", () => {
    const msg = signMessage(unsignedHello(), alice.privKey);
    expect(verifyMessage({ ...msg, name: "Mallory" } as Msg)).toBe(false);
  });

  test("bet stake amount is covered by the signature", () => {
    const unsigned: Omit<BetMsg, "sig"> = {
      t: "bet",
      v: 1,
      author: alice.idKey,
      marketId: "m1",
      outcomeKey: "HOME",
      amount: 10_000_000n,
      nonce: "n1",
      ts: 100,
    };
    const msg = signMessage(unsigned, alice.privKey);
    expect(verifyMessage(msg)).toBe(true);
    expect(verifyMessage({ ...msg, amount: 999_000_000n } as Msg)).toBe(false);
  });

  test("messageDigest is independent of field order", () => {
    const m1 = { t: "lock", v: 1, author: alice.idKey, marketId: "m1", ts: 3 };
    const m2 = { ts: 3, marketId: "m1", author: alice.idKey, v: 1, t: "lock" };
    expect(messageDigest(m1)).toBe(messageDigest(m2));
  });
});
