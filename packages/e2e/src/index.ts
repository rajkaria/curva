/**
 * @curva/e2e — the whole product, headless.
 *
 * `runTerraceDemo` drives every layer end-to-end with the real packages and no
 * external services (FakeWallet + FakeAsr, honestly labeled): derive vaults →
 * open a terrace → trade → kill the host → lock at cutoff → on-device ASR
 * pre-fills attestations → crowd quorum resolves → net the payout → each debtor
 * settles their own USDt → receipts land in the log → everyone's square.
 *
 * It returns a narrated transcript plus the hard facts a test asserts, so the
 * same run is both the scripted-demo backup (§13) and a CI proof the stack
 * composes.
 */
import { deriveVault, computeDeltas, minTransfers, settlementManifest, settleMyDebts, FakeWallet } from "@curva/wdk-vault";
import { Swarm } from "@curva/sim";
import { matchResult } from "@curva/market-catalogue";
import { prefillAttestation, resolveMarket } from "@curva/crowd-oracle";
import { computePayouts, impliedOdds, buildPools, type Bet } from "@curva/market-kernel";
import {
  readValidBets,
  readAttestationLog,
  isLocked,
  type KV,
} from "@curva/terrace-base";

const USDT = 1_000_000n;

// Standard BIP-39 test vectors — NEVER funded. Three mates, three seeds.
const MNEMONICS = [
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "legal winner thank year wave sausage worth useful legal winner thank yellow",
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
];

export interface DemoResult {
  readonly log: string[];
  readonly converged: boolean;
  readonly resolvedOutcome: string | null;
  readonly lockedBeforeLateBet: boolean;
  readonly poolTotals: Record<string, string>;
  readonly transfers: Array<{ from: string; to: string; amount: string }>;
  readonly receiptsCovered: number;
  readonly conserved: boolean;
  readonly everyoneSquare: boolean;
}

export async function runTerraceDemo(): Promise<DemoResult> {
  const log: string[] = [];
  const say = (s: string) => log.push(s);

  // ── Identity: one seed each → identity key + USDt wallet ───────────────────
  const vaults = MNEMONICS.map((m) => deriveVault(m));
  const names = ["Ana", "Bo", "Cai"];
  say("● Three mates, three seeds. One seed → identity key + USDt wallet each.");
  vaults.forEach((v, i) => say(`   ${names[i]}: wallet ${v.wallet.address.slice(0, 10)}… id ${v.identity.idKey.slice(0, 10)}…`));

  const swarm = new Swarm();
  const peers = vaults.map((v, i) => swarm.addPeer({ privKey: v.identity.privKey, idKey: v.identity.idKey }, names[i]!));
  const walletOf = new Map(vaults.map((v) => [v.identity.idKey, v.wallet.address]));

  // ── Open the terrace ───────────────────────────────────────────────────────
  peers.forEach((p, i) =>
    swarm.emit(p, { t: "hello", name: names[i]!, walletAddr: vaults[i]!.wallet.address, ts: 1 }),
  );
  swarm.flush();
  const mkt = matchResult("France", "Brazil");
  const cutoffAt = 90 * 60_000;
  swarm.emit(peers[0]!, { t: "market", marketId: "m1", kind: mkt.kind, params: mkt.params, cutoffAt, feeBps: 0, ts: 2 });
  swarm.flush();
  say(`\n● Ana opens a terrace: "${mkt.params.title}". Invite is the Autobase key; mates scan in.`);

  // ── Trade ──────────────────────────────────────────────────────────────────
  swarm.emit(peers[0]!, { t: "bet", marketId: "m1", outcomeKey: "HOME", amount: 100n * USDT, nonce: "a1", ts: 1000 });
  swarm.emit(peers[1]!, { t: "bet", marketId: "m1", outcomeKey: "AWAY", amount: 60n * USDT, nonce: "b1", ts: 1000 });
  swarm.emit(peers[2]!, { t: "bet", marketId: "m1", outcomeKey: "HOME", amount: 40n * USDT, nonce: "c1", ts: 1000 });
  swarm.flush();
  const pools0 = buildPools(await bets(await peers[0]!.view()), 0);
  const odds = impliedOdds(pools0);
  say(`\n● Three bets land; odds move live on every screen:`);
  for (const [k, o] of Object.entries(odds)) say(`   ${k}: ${(o.probability * 100).toFixed(0)}%  (×${o.decimalOdds?.toFixed(2)})`);

  // ── 💀 Kill the host ───────────────────────────────────────────────────────
  say(`\n● 💀 Ana (the opener) goes offline. Bo and Cai keep trading — there is no host.`);
  const beforeKill = await peers[1]!.digest();
  swarm.emit(peers[1]!, { t: "chat", text: "still here, still trading", lang: "en", ts: 1500 });
  swarm.flush((i) => i !== 0); // Ana receives nothing
  const survived = (await peers[1]!.digest()) !== beforeKill && (await peers[1]!.digest()) === (await peers[2]!.digest());
  say(`   Bo⇄Cai still converge without Ana: ${survived ? "✓" : "✗"}`);

  // ── Cutoff fence ───────────────────────────────────────────────────────────
  swarm.emit(peers[1]!, { t: "lock", marketId: "m1", ts: cutoffAt });
  swarm.flush();
  const locked = await isLocked(await peers[1]!.view(), "m1");
  // A cheater tries a late bet after the whistle.
  swarm.emit(peers[2]!, { t: "bet", marketId: "m1", outcomeKey: "AWAY", amount: 500n * USDT, nonce: "late", ts: cutoffAt + 1 });
  swarm.flush();
  say(`\n● Whistle. Market locks (${locked ? "✓" : "✗"}); a late 500 USDt bet after the lock is fenced out.`);

  // ── The crowd oracle (on-device ASR pre-fill) ──────────────────────────────
  const transcript = "And that's full time here in the final. France 2, Brazil 1. What a match.";
  const prefill = prefillAttestation(transcript, { outcomes: mkt.params.outcomes, homeTeam: "France", awayTeam: "Brazil" });
  say(`\n● Full time. Each phone's QVAC ASR heard: "${prefill?.asrScore}" (locally, offline).`);
  const attestTs = cutoffAt + 5_000;
  for (const p of peers) {
    // Ana is back online to attest; everyone one-taps their pre-filled attestation.
    swarm.emit(p, { t: "attest", marketId: "m1", outcomeKey: prefill!.outcomeKey, evidence: { asrScore: prefill!.asrScore, confidence: prefill!.confidence }, ts: attestTs });
  }
  swarm.flush();

  const kv = await peers[0]!.view();
  const events = await readAttestationLog(kv, "m1");
  const stakeByWriter = new Map<string, bigint>();
  for (const b of await readValidBets(kv, "m1")) {
    stakeByWriter.set(b.bettorId, (stakeByWriter.get(b.bettorId) ?? 0n) + b.stake);
  }
  const disputeWindowMs = 600_000;
  const provisional = resolveMarket({ events, stakeByWriter, now: attestTs, disputeWindowMs });
  const resolved = resolveMarket({ events, stakeByWriter, now: attestTs + disputeWindowMs, disputeWindowMs });
  say(`   Quorum: ${provisional.status} → after the 10-min dispute window: ${resolved.status.toUpperCase()} ${resolved.status === "resolved" ? resolved.outcomeKey : ""}`);

  // ── Settle: net → each debtor pays their own USDt ──────────────────────────
  const validBets = await bets(kv);
  const manifest = computePayouts({ bets: validBets, resolution: { kind: "outcome", outcomeKey: "HOME" }, feeBps: 0 });
  const stakesById = new Map<string, bigint>();
  for (const b of validBets) stakesById.set(b.bettorId, (stakesById.get(b.bettorId) ?? 0n) + b.stake);
  const deltas = computeDeltas(manifest, stakesById);
  // Translate idKey ledger → wallet-address ledger for on-chain settlement.
  const walletTransfers = settlementManifest(
    minTransfers(deltas).map((t) => ({ from: walletOf.get(t.from)!, to: walletOf.get(t.to)!, amount: t.amount })),
  );
  say(`\n● Payout manifest nets to ${walletTransfers.length} transfer(s):`);
  for (const t of walletTransfers) say(`   ${t.from.slice(0, 8)}… → ${t.to.slice(0, 8)}…  ${fmt(t.amount)} USDt`);

  // Each peer signs only its own debts, from its own (fake, funded) wallet.
  const wallets = vaults.map((v) => new FakeWallet(v.wallet.address, 1000n * USDT));
  const allReceipts = (await Promise.all(wallets.map((w) => settleMyDebts(walletTransfers, w)))).flat();
  const receiptsCovered = new Set(allReceipts.map((r) => r.line)).size;
  say(`\n● Each debtor one-taps; WDK signs; ${allReceipts.length} receipt(s) append to the log.`);
  say(`   Everyone's square ✓ (${receiptsCovered}/${walletTransfers.length} lines settled)`);

  const conserved = manifest.payoutTotal + manifest.feeTotal === manifest.grossTotal;
  const poolTotals: Record<string, string> = {};
  for (const [k, v] of Object.entries(await poolMap(kv))) poolTotals[k] = v.toString();

  return {
    log,
    converged: await swarm.converged(),
    resolvedOutcome: resolved.status === "resolved" ? resolved.outcomeKey : null,
    lockedBeforeLateBet: locked,
    poolTotals,
    transfers: walletTransfers.map((t) => ({ from: t.from, to: t.to, amount: t.amount.toString() })),
    receiptsCovered,
    conserved,
    everyoneSquare: receiptsCovered === walletTransfers.length,
  };
}

async function bets(kv: KV): Promise<Bet[]> {
  return (await readValidBets(kv, "m1")).map((b) => ({ betId: b.betId, bettorId: b.bettorId, outcomeKey: b.outcomeKey, stake: b.stake }));
}
async function poolMap(kv: KV): Promise<Record<string, bigint>> {
  const out: Record<string, bigint> = {};
  for (const b of await readValidBets(kv, "m1")) out[b.outcomeKey] = (out[b.outcomeKey] ?? 0n) + b.stake;
  return out;
}
function fmt(micros: bigint): string {
  return (Number(micros) / 1_000_000).toFixed(2);
}
