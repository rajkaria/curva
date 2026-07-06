/**
 * In-memory WalletAdapter — the test double, and the honest offline demo path.
 *
 * When no funded testnet wallet is available (CI, air-gapped demo), TIFO runs
 * settlement against this fake: transfers move fake balances and return
 * clearly-labeled `0xfake…` txids. The UI marks these as simulated and the
 * README discloses it — never a fake txid dressed up as a real one.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { WalletAdapter } from "./settle.js";

export class FakeWallet implements WalletAdapter {
  private bal: bigint;
  private nonce = 0;
  readonly sent: Array<{ to: string; amount: bigint; txid: string }> = [];

  constructor(
    private readonly addr: string,
    initialBalance: bigint,
  ) {
    this.bal = initialBalance;
  }

  address(): string {
    return this.addr;
  }

  async balance(): Promise<bigint> {
    return this.bal;
  }

  async transfer(to: string, amount: bigint): Promise<string> {
    if (amount <= 0n) throw new Error("transfer amount must be positive");
    if (amount > this.bal) throw new Error("insufficient balance");
    this.bal -= amount;
    const seed = `${this.addr}:${to}:${amount}:${this.nonce++}`;
    const txid = "0xfake" + bytesToHex(keccak_256(utf8ToBytes(seed))).slice(0, 58);
    this.sent.push({ to, amount, txid });
    return txid;
  }
}
