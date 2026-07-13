import { describe, expect, test } from "vitest";
import { randomIdentity } from "../src/identity.js";
import { buildPairRequest, validatePairRequest } from "../src/pairing.js";

const joiner = randomIdentity();
const WRITER = "ab".repeat(32);

describe("pairing handshake — signed request validation (S15 U8)", () => {
  test("a well-formed request round-trips through validation", () => {
    const req = buildPairRequest(joiner, WRITER, "ana", 1234);
    expect(validatePairRequest(req)).toEqual(req);
    expect(validatePairRequest(JSON.parse(JSON.stringify(req)))).toEqual(req);
  });

  test("a tampered writer key fails — you cannot swap your key into someone's approval", () => {
    const req = buildPairRequest(joiner, WRITER, "ana", 1234);
    expect(validatePairRequest({ ...req, writerKey: "cd".repeat(32) })).toBeNull();
  });

  test("a tampered name fails (the approval card shows what was signed)", () => {
    const req = buildPairRequest(joiner, WRITER, "ana", 1234);
    expect(validatePairRequest({ ...req, name: "mallory" })).toBeNull();
  });

  test("a request signed by a different identity than `author` fails", () => {
    const mallory = randomIdentity();
    const forged = { ...buildPairRequest(mallory, WRITER, "ana", 1), author: joiner.idKey };
    expect(validatePairRequest(forged)).toBeNull();
  });

  test("structurally hostile payloads validate to null, never throw", () => {
    for (const raw of [
      null,
      42,
      "pair",
      {},
      { v: 1, t: "pair" },
      { v: 2, t: "pair", author: joiner.idKey, writerKey: WRITER, name: "a", ts: 1, sig: "00" },
      { v: 1, t: "chat", author: joiner.idKey, writerKey: WRITER, name: "a", ts: 1, sig: "00" },
      { v: 1, t: "pair", author: "zz", writerKey: WRITER, name: "a", ts: 1, sig: "00" },
      { v: 1, t: "pair", author: joiner.idKey, writerKey: "not-hex", name: "a", ts: 1, sig: "00" },
      { v: 1, t: "pair", author: joiner.idKey, writerKey: WRITER, name: "", ts: 1, sig: "00" },
      { v: 1, t: "pair", author: joiner.idKey, writerKey: WRITER, name: "x".repeat(41), ts: 1, sig: "00" },
      { v: 1, t: "pair", author: joiner.idKey, writerKey: WRITER, name: "a", ts: Infinity, sig: "00" },
      { v: 1, t: "pair", author: joiner.idKey, writerKey: WRITER, name: "a", ts: 1, sig: 7 },
      { v: 1, t: "pair", author: joiner.idKey, writerKey: WRITER, name: "a", ts: 1, sig: "00".repeat(65) },
    ]) {
      expect(validatePairRequest(raw)).toBeNull();
    }
  });
});
