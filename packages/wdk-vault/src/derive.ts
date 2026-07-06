/**
 * One seed → the whole self-custodial vault.
 *
 * BIP-39 mnemonic → BIP-32 master → BIP-44 EVM paths, exactly as WDK derives
 * them (the S0b spike proved `m/44'/60'/0'/0/0` matches WDK's account 0). TIFO
 * splits the same seed into two roles:
 *
 *   m/44'/60'/0'/0/0  → USDt settlement wallet (the funded, explorer-visible address)
 *   m/44'/60'/0'/0/1  → TIFO identity key (signs every log message; @tifo/terrace-base)
 *
 * Both are secp256k1, so identity and money share one curve and one seed — the
 * self-custody story in one primitive. Pure derivation (no WDK dependency here);
 * the real WDK wallet is only needed to move USDt, in the settlement adapter.
 */
import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { pubkeyToEvmAddress } from "./address.js";

const WALLET_PATH = "m/44'/60'/0'/0/0";
const IDENTITY_PATH = "m/44'/60'/0'/0/1";

export interface DerivedKey {
  readonly path: string;
  readonly privKey: string;
  readonly idKey: string; // compressed pubkey hex
  readonly address: string; // EIP-55 EVM address
}

export interface Vault {
  /** Settlement wallet — receives/sends testnet USDt. */
  readonly wallet: DerivedKey;
  /** Identity — signs log messages (idKey is the on-wire peer identity). */
  readonly identity: DerivedKey;
}

function deriveKey(root: HDKey, path: string): DerivedKey {
  const node = root.derive(path);
  if (!node.privateKey) throw new Error(`no private key at ${path}`);
  const privKey = bytesToHex(node.privateKey);
  const idKey = bytesToHex(secp256k1.getPublicKey(node.privateKey, true));
  return { path, privKey, idKey, address: pubkeyToEvmAddress(idKey) };
}

export function deriveVault(mnemonic: string, passphrase = ""): Vault {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase));
  return { wallet: deriveKey(root, WALLET_PATH), identity: deriveKey(root, IDENTITY_PATH) };
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}

/** Generate a fresh 12-word seed and its vault — the app's first-run onboarding. */
export function randomVault(): { mnemonic: string; vault: Vault } {
  const mnemonic = generateMnemonic(wordlist);
  return { mnemonic, vault: deriveVault(mnemonic) };
}
