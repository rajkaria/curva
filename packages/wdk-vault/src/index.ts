/**
 * @curva/wdk-vault — self-custodial identity + USDt settlement.
 *
 * Pure and tested: seed → identity + wallet derivation (./derive), minimal
 * transfer netting (./netting), settlement orchestration (./settle) over a
 * WalletAdapter with an in-memory {@link FakeWallet}. The real WDK adapter
 * (./wdk-adapter) is the only external-service touchpoint (chain RPC), loaded
 * lazily so CI stays pure.
 */
export * from "./address.js";
export * from "./derive.js";
export * from "./netting.js";
export * from "./settle.js";
export { FakeWallet } from "./fake-wallet.js";
export { WdkWallet, type WdkConfig } from "./wdk-adapter.js";
