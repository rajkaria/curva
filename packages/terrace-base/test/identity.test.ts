import { describe, expect, test } from "vitest";
import {
  identityFromPrivateKey,
  randomIdentity,
  signDigest,
  verifyDigest,
  recoverSigner,
} from "../src/identity.js";
import { keccak_256 } from "@noble/hashes/sha3";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils";

const digest = (s: string) => bytesToHex(keccak_256(utf8ToBytes(s)));

describe("identity", () => {
  test("a private key yields a stable 33-byte compressed idKey", () => {
    const priv = "11".repeat(32);
    const id = identityFromPrivateKey(priv);
    expect(id.idKey).toHaveLength(66); // 33 bytes compressed
    expect(id.idKey).toBe(identityFromPrivateKey(priv).idKey); // deterministic
    expect(/^0[23][0-9a-f]{64}$/.test(id.idKey)).toBe(true);
  });

  test("sign → verify round-trips for the signing identity", () => {
    const id = randomIdentity();
    const d = digest("curva:bet:fra-bra:HOME:10000000");
    const sig = signDigest(d, id.privKey);
    expect(verifyDigest(d, sig, id.idKey)).toBe(true);
  });

  test("recoverSigner returns the exact idKey that signed", () => {
    const id = randomIdentity();
    const d = digest("hello world");
    const sig = signDigest(d, id.privKey);
    expect(recoverSigner(d, sig)).toBe(id.idKey);
  });

  test("verification fails for a different signer", () => {
    const alice = randomIdentity();
    const mallory = randomIdentity();
    const d = digest("pay mallory");
    const sig = signDigest(d, alice.privKey);
    expect(verifyDigest(d, sig, mallory.idKey)).toBe(false);
  });

  test("verification fails if the digest is tampered", () => {
    const id = randomIdentity();
    const sig = signDigest(digest("stake 10"), id.privKey);
    expect(verifyDigest(digest("stake 1000000"), sig, id.idKey)).toBe(false);
  });

  test("malformed signatures are rejected, not thrown", () => {
    const id = randomIdentity();
    expect(verifyDigest(digest("x"), "not-a-sig", id.idKey)).toBe(false);
    expect(verifyDigest(digest("x"), "ab".repeat(65), id.idKey)).toBe(false);
  });
});
