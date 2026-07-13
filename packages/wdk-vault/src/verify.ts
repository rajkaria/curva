/**
 * Receipt verification (S16 T1) — closes audit finding T1: receipts in the log
 * are self-reported txids, so in real mode a peer could claim a payment it
 * never made. A {@link ReceiptVerifier} checks a claimed transfer against the
 * chain and the "everyone's square" checklist upgrades a line from ✓ (claimed)
 * to ✓✓ (verified) as confirmations land.
 *
 * Verification is a *read-side* concern: no protocol change, no new message —
 * every peer independently verifies the same claims against the same chain.
 * Failure modes degrade toward "claimed", never toward a false "verified":
 * an unmined tx, a dead RPC, or a malformed response all report `pending`.
 * Demo mode uses {@link FakeVerifier} over the fake wallet's ledger.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export type VerifyStatus = "confirmed" | "pending" | "mismatch";

/** A transfer as claimed by a receipt in the log — what verification checks. */
export interface ExpectedTransfer {
  readonly txid: string;
  readonly from: string;
  readonly to: string;
  /** USDt micros (token base units). */
  readonly amount: bigint;
}

export interface ReceiptVerifier {
  verify(expected: ExpectedTransfer): Promise<VerifyStatus>;
}

const eqAddr = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** In-memory verifier over a known ledger — the test double and demo path. */
export class FakeVerifier implements ReceiptVerifier {
  constructor(
    private readonly ledger: ReadonlyArray<{ txid: string; from: string; to: string; amount: bigint }>,
  ) {}

  async verify(expected: ExpectedTransfer): Promise<VerifyStatus> {
    const entry = this.ledger.find((e) => e.txid === expected.txid);
    if (!entry) return "pending";
    const ok =
      eqAddr(entry.from, expected.from) && eqAddr(entry.to, expected.to) && entry.amount === expected.amount;
    return ok ? "confirmed" : "mismatch";
  }
}

// ── The square checklist (pure) ──────────────────────────────────────────────

export type SquareLineStatus = "unpaid" | "claimed" | "verified" | "mismatch";

/**
 * Fold receipts + verifier verdicts into one status per manifest line:
 * no receipt → `unpaid`; a receipt with no verdict (or a pending one, or a
 * dry-run "" txid) → `claimed` (✓); a confirmed verdict → `verified` (✓✓);
 * a mismatch verdict → `mismatch` (⚠). Pure, so the upgrade logic is tested
 * without any RPC.
 */
export function squareStatus(
  manifestLines: number,
  receipts: ReadonlyArray<{ line: number; txid: string }>,
  verdicts: ReadonlyMap<string, VerifyStatus>,
): SquareLineStatus[] {
  const byLine = new Map(receipts.map((r) => [r.line, r.txid]));
  return Array.from({ length: manifestLines }, (_, line) => {
    const txid = byLine.get(line);
    if (txid === undefined) return "unpaid";
    if (txid === "") return "claimed"; // dry run — nothing on chain to check
    const verdict = verdicts.get(txid);
    if (verdict === "confirmed") return "verified";
    if (verdict === "mismatch") return "mismatch";
    return "claimed";
  });
}

// ── Real-mode verifier over the disclosed RPC ────────────────────────────────

/** keccak("Transfer(address,address,uint256)") — the ERC-20 Transfer topic. */
const TRANSFER_TOPIC = "0x" + bytesToHex(keccak_256(utf8ToBytes("Transfer(address,address,uint256)")));

export interface RpcVerifierConfig {
  readonly rpcUrl: string;
  /** USDt token contract address on the chosen chain. */
  readonly usdtAddress: string;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchFn?: typeof fetch;
}

interface RpcLog {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
}

/**
 * Verify a claimed USDt transfer via `eth_getTransactionReceipt`: the tx must
 * be mined and successful, and must carry a Transfer log on the USDt contract
 * whose from/to/amount match the claim exactly.
 */
export class RpcVerifier implements ReceiptVerifier {
  constructor(private readonly config: RpcVerifierConfig) {}

  async verify(expected: ExpectedTransfer): Promise<VerifyStatus> {
    let receipt: { status?: string; logs?: readonly RpcLog[] } | null;
    try {
      const fetchFn = this.config.fetchFn ?? fetch;
      const res = await fetchFn(this.config.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionReceipt",
          params: [expected.txid],
        }),
      });
      const body = (await res.json()) as { result?: { status?: string; logs?: readonly RpcLog[] } | null };
      receipt = body.result ?? null;
    } catch {
      return "pending"; // RPC down / malformed — degrade to claimed, never falsely verify
    }
    if (receipt === null || typeof receipt !== "object") return "pending"; // not mined yet
    if (receipt.status !== "0x1") return "mismatch"; // reverted — the money never moved

    const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
    const matches = logs.some((log) => {
      try {
        return (
          eqAddr(log.address, this.config.usdtAddress) &&
          log.topics[0] === TRANSFER_TOPIC &&
          topicAddr(log.topics[1]) === expected.from.slice(2).toLowerCase() &&
          topicAddr(log.topics[2]) === expected.to.slice(2).toLowerCase() &&
          BigInt(log.data) === expected.amount
        );
      } catch {
        return false;
      }
    });
    return matches ? "confirmed" : "mismatch";
  }
}

/** The 20-byte address inside a 32-byte log topic, lowercase, no 0x. */
function topicAddr(topic: string | undefined): string {
  return (topic ?? "").slice(-40).toLowerCase();
}

/** One human line for the receipts card, e.g. "✓✓ 2 verified · ✓ 1 claimed". */
export function squareSummary(statuses: readonly SquareLineStatus[]): string {
  if (statuses.length === 0) return "no transfers";
  const count = (s: SquareLineStatus) => statuses.filter((x) => x === s).length;
  const parts: string[] = [];
  if (count("verified")) parts.push(`✓✓ ${count("verified")} verified`);
  if (count("claimed")) parts.push(`✓ ${count("claimed")} claimed`);
  if (count("mismatch")) parts.push(`⚠ ${count("mismatch")} mismatch`);
  if (count("unpaid")) parts.push(`${count("unpaid")} unpaid`);
  return parts.join(" · ");
}
