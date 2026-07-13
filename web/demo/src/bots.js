/**
 * Scripted co-fans for the browser demo — the "live terrace" half of S15/T6.
 *
 * Each bot is a full protocol citizen: its own secp256k1 identity, its own
 * FakeWallet, and every action is a SIGNED protocol message appended through
 * the same fold as a real peer's — bets while a market is open, an attestation
 * after the whistle (they vote the pool-leading outcome, so the dual-⅔ quorum
 * forms on what the crowd actually traded), receipts for the transfers they
 * owe once the market resolves. Nothing here bypasses validation; a bot's
 * message that breaks a rule would be dropped exactly like a hostile peer's.
 */
import {
  randomIdentity, signMessage,
  readMarkets, readPools, readAttestationLog, isLocked,
} from "@curva/terrace-base";
import { resolveMarket } from "@curva/crowd-oracle";
import { computePayouts } from "@curva/market-kernel";
import {
  computeDeltas, minTransfers, settlementManifest, settleMyDebts, FakeWallet,
} from "@curva/wdk-vault";
import { settlementVm } from "@curva/terrace-ui";

const USDT = 1_000_000n;
const TICK_MS = 2_500;

const PERSONAS = [
  { name: "Marta", lang: "pt", quips: ["Vamos!", "Que jogo…", "Hoje tem gol, sinto no ar."] },
  { name: "Kenji", lang: "ja", quips: ["いい試合だ", "この流れは危ない", "決定力が全てだよ"] },
  { name: "Luca", lang: "it", quips: ["Forza!", "Che partita, ragazzi", "Il pareggio non basta mai."] },
];

const rand = (n) => Math.floor(Math.random() * n);
const chance = (p) => Math.random() < p;

class Bot {
  constructor(persona) {
    this.persona = persona;
    this.identity = randomIdentity();
    this.wallet = new FakeWallet("0x" + this.identity.idKey.slice(2, 42), 500n * USDT);
    this.bets = new Set();
    this.attested = new Set();
    this.settled = new Set();
    this.saidHello = false;
  }

  async emit(node, fields) {
    const unsigned = { v: 1, author: this.identity.idKey, ts: Date.now(), ...fields };
    await node.append(signMessage(unsigned, this.identity.privKey));
  }

  async hello(node) {
    await this.emit(node, { t: "hello", name: this.persona.name, walletAddr: this.wallet.address() });
    this.saidHello = true;
  }

  async tick(node, disputeWindowMs) {
    if (!this.saidHello) return;
    const kv = node.view();
    const now = Date.now();

    if (chance(0.06)) {
      const q = this.persona.quips[rand(this.persona.quips.length)];
      await this.emit(node, { t: "chat", text: q, lang: this.persona.lang });
    }

    for (const m of await readMarkets(kv)) {
      const locked = await isLocked(kv, m.marketId);

      if (!locked && now <= m.cutoffAt && !this.bets.has(m.marketId) && chance(0.55)) {
        const outcomes = m.params.outcomes;
        const outcomeKey = outcomes[rand(outcomes.length)];
        const amount = BigInt(5 + rand(26)) * USDT;
        await this.emit(node, {
          t: "bet", marketId: m.marketId, outcomeKey, amount,
          nonce: "bot-" + this.identity.idKey.slice(2, 8) + "-" + m.marketId,
        });
        this.bets.add(m.marketId);
        continue;
      }

      if (locked && !this.attested.has(m.marketId) && chance(0.6)) {
        // Vote what the terrace traded: the pool-leading outcome. Three bots
        // agreeing is what lets the judge watch the dual-⅔ quorum form.
        const pools = await readPools(kv, m.marketId);
        const leader =
          Object.entries(pools).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))[0]?.[0] ??
          m.params.outcomes[0];
        await this.emit(node, {
          t: "attest", marketId: m.marketId, outcomeKey: leader, evidence: { confidence: 0.9 },
        });
        this.attested.add(m.marketId);
        continue;
      }

      if (locked && !this.settled.has(m.marketId)) {
        const s = await settlementVm(kv, m.marketId);
        const events = await readAttestationLog(kv, m.marketId);
        const res = resolveMarket({ events, stakeByWriter: s.stakes, now, disputeWindowMs });
        if (res.status !== "resolved") continue;
        const manifest = computePayouts({
          bets: s.bets, resolution: { kind: "outcome", outcomeKey: res.outcomeKey }, feeBps: m.feeBps,
        });
        const transfers = settlementManifest(
          minTransfers(computeDeltas(manifest, s.stakes)).map((t) => ({
            from: s.walletOf(t.from), to: s.walletOf(t.to), amount: t.amount,
          })),
        );
        const receipts = await settleMyDebts(transfers, this.wallet);
        for (const r of receipts) {
          await this.emit(node, { t: "receipt", marketId: m.marketId, manifestLine: r.line, txid: r.txid });
        }
        this.settled.add(m.marketId);
      }
    }
  }
}

/** Bring the terrace to life: three co-fans join, greet, then live on a ticker. */
export function startBots(node) {
  const disputeWindowMs = globalThis.CURVA_RUNTIME?.disputeWindowMs ?? 10 * 60_000;
  const bots = PERSONAS.map((p) => new Bot(p));
  bots.forEach((bot, i) => {
    setTimeout(() => {
      node.connectPeer();
      void bot.hello(node);
    }, 800 + i * 1400);
  });
  setInterval(() => {
    for (const bot of bots) {
      bot.tick(node, disputeWindowMs).catch(() => {
        /* a lost tick is just a quiet fan */
      });
    }
  }, TICK_MS);
}
