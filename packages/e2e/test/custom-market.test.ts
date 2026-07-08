/**
 * The general-platform proof: a market that has nothing to do with football goes
 * the full distance on the exact same rails — create → bet → lock → attest →
 * crowd-quorum resolve → conserved payout. No ASR, no fixture, no score: just a
 * question, its outcomes, and the crowd. This is the football skin coming off.
 */
import { describe, expect, test } from "vitest";
import {
  foldMessages,
  isLocked,
  randomIdentity,
  readAttestationLog,
  readMarket,
  readValidBets,
  signMessage,
  type Identity,
  type Msg,
} from "@curva/terrace-base";
import { resolveMarket } from "@curva/crowd-oracle";
import { computePayouts } from "@curva/market-kernel";
import { customMarket } from "@curva/market-catalogue";

const USDT = 1_000_000n;

const ana = randomIdentity();
const bo = randomIdentity();
const cai = randomIdentity();

const sign = (id: Identity, fields: Record<string, unknown>): Msg =>
  signMessage({ v: 1, author: id.idKey, ...fields } as unknown as Parameters<typeof signMessage>[0], id.privKey);

describe("a non-football custom market, end-to-end", () => {
  test("crowd quorum settles an office YES/NO market and money conserves to the micro", async () => {
    const cutoffAt = 10_000;
    const attestTs = cutoffAt + 5_000;
    const disputeWindowMs = 600_000;
    const spec = customMarket("Will we ship the release by Friday?", ["YES", "NO"]);

    const kv = await foldMessages([
      sign(ana, { t: "hello", name: "Ana", walletAddr: "0xana", ts: 1 }),
      sign(bo, { t: "hello", name: "Bo", walletAddr: "0xbo", ts: 1 }),
      sign(cai, { t: "hello", name: "Cai", walletAddr: "0xcai", ts: 1 }),
      sign(ana, { t: "market", marketId: "office1", kind: spec.kind, params: spec.params, cutoffAt, feeBps: 0, ts: 2 }),
      sign(ana, { t: "bet", marketId: "office1", outcomeKey: "YES", amount: 100n * USDT, nonce: "a", ts: 100 }),
      sign(bo, { t: "bet", marketId: "office1", outcomeKey: "YES", amount: 40n * USDT, nonce: "b", ts: 100 }),
      sign(cai, { t: "bet", marketId: "office1", outcomeKey: "NO", amount: 60n * USDT, nonce: "c", ts: 100 }),
      sign(ana, { t: "lock", marketId: "office1", ts: cutoffAt }),
      // A late NO bet after the lock must be fenced out.
      sign(cai, { t: "bet", marketId: "office1", outcomeKey: "NO", amount: 500n * USDT, nonce: "late", ts: cutoffAt + 1 }),
      // No ASR for a custom market — the crowd one-taps YES by hand.
      sign(ana, { t: "attest", marketId: "office1", outcomeKey: "YES", evidence: { confidence: 0.95 }, ts: attestTs }),
      sign(bo, { t: "attest", marketId: "office1", outcomeKey: "YES", evidence: { confidence: 0.95 }, ts: attestTs }),
      sign(cai, { t: "attest", marketId: "office1", outcomeKey: "YES", evidence: { confidence: 0.95 }, ts: attestTs }),
    ]);

    // It's a custom market, it locked, and the late 500-USDt bet is gone.
    expect((await readMarket(kv, "office1"))?.kind).toBe("custom");
    expect(await isLocked(kv, "office1")).toBe(true);
    const validBets = await readValidBets(kv, "office1");
    expect(validBets).toHaveLength(3);

    // The dual-⅔ crowd oracle resolves YES after the dispute window — same rule as football.
    const events = await readAttestationLog(kv, "office1");
    const stakeByWriter = new Map<string, bigint>();
    for (const b of validBets) stakeByWriter.set(b.bettorId, (stakeByWriter.get(b.bettorId) ?? 0n) + b.stake);
    const resolved = resolveMarket({ events, stakeByWriter, now: attestTs + disputeWindowMs, disputeWindowMs });
    expect(resolved).toMatchObject({ status: "resolved", outcomeKey: "YES" });

    // The NO stake funds the YES winners; every micro is accounted for.
    const manifest = computePayouts({ bets: validBets, resolution: { kind: "outcome", outcomeKey: "YES" }, feeBps: 0 });
    expect(manifest.grossTotal).toBe(200n * USDT);
    expect(manifest.payoutTotal + manifest.feeTotal).toBe(manifest.grossTotal);
  });
});
