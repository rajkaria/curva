import { describe, expect, test } from "vitest";
import { isSealedVault, openVault, sealVault } from "../src/seal.js";
import { randomVault } from "../src/derive.js";

// Fast scrypt for tests only — production default is calibrated in seal.ts.
const FAST = { logN: 12 };

describe("sealVault / openVault — mnemonic encrypted at rest", () => {
  const mnemonic = randomVault().mnemonic;

  test("seal → open round-trips the exact mnemonic", () => {
    const sealed = sealVault(mnemonic, "correct horse battery staple", FAST);
    expect(openVault(sealed, "correct horse battery staple")).toBe(mnemonic);
  });

  test("the sealed blob is versioned for future migration", () => {
    const sealed = sealVault(mnemonic, "pw", FAST);
    expect(sealed.startsWith("v1:scrypt:xchacha:")).toBe(true);
    expect(isSealedVault(sealed)).toBe(true);
  });

  test("a plaintext mnemonic is not mistaken for a sealed blob", () => {
    expect(isSealedVault(mnemonic)).toBe(false);
    expect(isSealedVault("")).toBe(false);
  });

  test("wrong passphrase fails closed (throws, never returns garbage)", () => {
    const sealed = sealVault(mnemonic, "right", FAST);
    expect(() => openVault(sealed, "wrong")).toThrow();
  });

  test("a tampered blob fails closed", () => {
    const sealed = sealVault(mnemonic, "pw", FAST);
    const parts = sealed.split(":");
    const ct = parts[parts.length - 1]!;
    const flipped = (parseInt(ct.slice(0, 1), 16) ^ 1).toString(16) + ct.slice(1);
    parts[parts.length - 1] = flipped;
    expect(() => openVault(parts.join(":"), "pw")).toThrow();
  });

  test("an empty passphrase is rejected at seal time", () => {
    expect(() => sealVault(mnemonic, "", FAST)).toThrow();
  });

  test("two seals of the same mnemonic differ (fresh salt + nonce)", () => {
    expect(sealVault(mnemonic, "pw", FAST)).not.toBe(sealVault(mnemonic, "pw", FAST));
  });

  test("a malformed blob fails closed", () => {
    expect(() => openVault("v1:scrypt:xchacha:nonsense", "pw")).toThrow();
    expect(() => openVault("v9:argon:aes:a:b:c:d", "pw")).toThrow();
  });
});
