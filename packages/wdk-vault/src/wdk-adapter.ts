/**
 * The real WalletAdapter, backed by WDK (@tetherto/wdk-wallet-evm). This is the
 * only place TIFO touches an external service — the chain RPC — and it is
 * disclosed as such. Message signing does NOT go through here: the identity key
 * is derived purely (see ./derive) and signs with noble, so the protocol runs
 * in Bare/Pear without WDK. WDK is load-bearing for the money: USDt balance and
 * transfers, self-custodial from the same seed.
 *
 * The WDK SDK is loaded through a `string`-argument `import()` (typed
 * `Promise<any>`) so this package typechecks and its pure netting/settlement
 * logic stays testable without pulling WDK into CI. Requires a funded wallet +
 * an RPC URL; without them the app uses {@link FakeWallet}, disclosed in-UI.
 *
 * Verified WDK surface (from the installed package, matching the S0b spike):
 *   wallet.getAccount(0) → account
 *   account.getTokenBalance(token) → bigint (base units)
 *   account.transfer({ token, recipient, amount }) → { hash, fee }
 */
import type { WalletAdapter } from "./settle.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const dynImport = (m: string): Promise<Any> => import(m);

export interface WdkConfig {
  readonly mnemonic: string;
  readonly rpcUrl: string;
  /** USDt token contract address on the chosen chain. */
  readonly usdtAddress: string;
  /** BIP-44 account index for the settlement wallet (default 0). */
  readonly accountIndex?: number;
}

export class WdkWallet implements WalletAdapter {
  private addr = "";

  private constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly account: Any,
    private readonly usdtAddress: string,
    address: string,
  ) {
    this.addr = address;
  }

  static async connect(config: WdkConfig): Promise<WdkWallet> {
    const WalletManagerEvm = (await dynImport("@tetherto/wdk-wallet-evm")).default;
    const { SeedSignerEvm } = await dynImport("@tetherto/wdk-wallet-evm/signers");
    const root = new SeedSignerEvm(config.mnemonic);
    const wallet = new WalletManagerEvm(root, { provider: config.rpcUrl });
    const account = await wallet.getAccount(config.accountIndex ?? 0);
    const address = await account.getAddress();
    return new WdkWallet(account, config.usdtAddress, address);
  }

  address(): string {
    return this.addr;
  }

  async balance(): Promise<bigint> {
    return BigInt(await this.account.getTokenBalance(this.usdtAddress));
  }

  async transfer(to: string, amount: bigint): Promise<string> {
    const { hash } = await this.account.transfer({
      token: this.usdtAddress,
      recipient: to,
      amount,
    });
    return hash;
  }
}
