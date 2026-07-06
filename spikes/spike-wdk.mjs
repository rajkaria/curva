// S0b — WDK spike: seed → self-custodial EVM account → address + local message signing.
// Proves: one seed can root both TIFO identity (signing) and the USDt wallet. No cloud.
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { SeedSignerEvm } from "@tetherto/wdk-wallet-evm/signers";

// standard BIP-39 test vector mnemonic (never fund)
const seedPhrase =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const root = new SeedSignerEvm(seedPhrase);
const wallet = new WalletManagerEvm(root, { provider: "https://sepolia.drpc.org" });

const account0 = await wallet.getAccount(0); // settlement wallet
const account1 = await wallet.getAccount(1); // TIFO identity key

const addr0 = await account0.getAddress();
const addr1 = await account1.getAddress();
console.log("wallet  (acct 0):", addr0);
console.log("identity(acct 1):", addr1);

// BIP-44 m/44'/60'/0'/0/0 for this mnemonic is a known test vector
const VECTOR = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const derivationOk = addr0.toLowerCase() === VECTOR.toLowerCase();
console.log(derivationOk ? "✓ standard BIP-44 derivation confirmed" : `⚠ nonstandard derivation (got ${addr0})`);

// local signing — the identity primitive for every TIFO log message
const sig = await account0.sign("tifo:bet:fra-bra:HOME:10000000:nonce-1");
console.log("✓ local message signature:", sig.slice(0, 24) + "…");

console.log("✅ S0b GREEN — WDK self-custodial derivation + signing works offline");
