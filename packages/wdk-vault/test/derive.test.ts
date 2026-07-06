import { describe, expect, test } from "vitest";
import { pubkeyToEvmAddress, toChecksumAddress } from "../src/address.js";
import { deriveVault } from "../src/derive.js";

// The standard BIP-39 test-vector mnemonic. NEVER fund this.
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
// Canonical m/44'/60'/0'/0/0 address for that mnemonic (proven in the S0b WDK spike).
const VECTOR_0 = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

describe("EIP-55 checksum", () => {
  test("checksums a known address", () => {
    expect(toChecksumAddress("0x9858effd232b4033e47d90003d41ec34ecaeda94")).toBe(VECTOR_0);
  });
});

describe("deriveVault", () => {
  test("the wallet (index 0) matches the canonical BIP-44 test vector", () => {
    const vault = deriveVault(MNEMONIC);
    expect(vault.wallet.address).toBe(VECTOR_0);
  });

  test("derivation is deterministic", () => {
    expect(deriveVault(MNEMONIC).wallet.address).toBe(deriveVault(MNEMONIC).wallet.address);
    expect(deriveVault(MNEMONIC).identity.idKey).toBe(deriveVault(MNEMONIC).identity.idKey);
  });

  test("identity (index 1) is a distinct, valid secp256k1 idKey", () => {
    const vault = deriveVault(MNEMONIC);
    expect(vault.identity.idKey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(vault.identity.idKey).not.toBe(vault.wallet.idKey);
    // The identity address differs from the wallet address (different path).
    expect(vault.identity.address).not.toBe(vault.wallet.address);
  });

  test("a different mnemonic yields a different vault", () => {
    const other =
      "legal winner thank year wave sausage worth useful legal winner thank yellow";
    expect(deriveVault(other).wallet.address).not.toBe(VECTOR_0);
  });

  test("pubkeyToEvmAddress round-trips the identity idKey to its address", () => {
    const vault = deriveVault(MNEMONIC);
    expect(pubkeyToEvmAddress(vault.identity.idKey)).toBe(vault.identity.address);
  });
});
