/**
 * TIFO — the Pear app.
 *
 * Wires the tested TIFO packages to a real Autobase/Hyperswarm runtime and a
 * vanilla-DOM UI. Everything money- or consensus-related lives in the packages
 * (pure, fuzz-tested); this file is glue + rendering only.
 *
 * Demo/offline mode (default): settlement uses FakeWallet and the oracle uses a
 * bundled commentary transcript via FakeAsr — both clearly labelled in-UI. Real
 * mode (a funded WDK wallet + a downloaded QVAC model) swaps the adapters with
 * no protocol change. Pairing uses the spec-sanctioned paste-a-key flow
 * (BlindPairing is the frictionless roadmap).
 */
import {
  TerraceNode, signMessage,
  readMarkets, readPools, readValidBets, readAttestationLog, readIdentities, readChat, isLocked,
} from "@tifo/terrace-base";
import {
  deriveVault, randomVault, isValidMnemonic,
  computeDeltas, minTransfers, settlementManifest, settleMyDebts, FakeWallet,
} from "@tifo/wdk-vault";
import { matchResult } from "@tifo/market-catalogue";
import { prefillAttestation, resolveMarket, FakeAsr } from "@tifo/crowd-oracle";
import { computePayouts, impliedOdds, buildPools } from "@tifo/market-kernel";
import { fallbackQuip, FakeTranslator, renderForViewer, suggestMarkets } from "@tifo/qvac-surfaces";
import { FIXTURES, STATS_BUNDLE, DEMO_TRANSCRIPT } from "../../fixtures/wc2026.js";

const DISPUTE_WINDOW_MS = 10 * 60_000;
const storageRoot = (globalThis.Pear?.config?.storage ?? "./store") + "/terrace-" + Date.now();
const translator = new FakeTranslator();
const app = document.getElementById("app");

// ── Vault (persisted seed) ───────────────────────────────────────────────────
function loadVault() {
  let mnemonic = localStorage.getItem("tifo.mnemonic");
  if (!mnemonic || !isValidMnemonic(mnemonic)) {
    mnemonic = randomVault().mnemonic;
    localStorage.setItem("tifo.mnemonic", mnemonic);
  }
  return { mnemonic, vault: deriveVault(mnemonic) };
}
const { vault } = loadVault();
document.getElementById("who-name").textContent = "you";
document.getElementById("who-addr").textContent = vault.wallet.address.slice(0, 12) + "…";

// ── Runtime state ─────────────────────────────────────────────────────────────
let node = null;
let role = "none"; // none | opener | joiner
let screen = "home";
let selectedMarket = null;
let toastMsg = "";
const wallet = new FakeWallet(vault.wallet.address, 1000n * 1_000_000n); // demo-funded

function toast(m) { toastMsg = m; render(); setTimeout(() => { toastMsg = ""; render(); }, 2200); }

// ── Message emit (build → sign → append) ─────────────────────────────────────
async function emit(fields) {
  const unsigned = { v: 1, author: vault.identity.idKey, ts: Date.now(), ...fields };
  await node.append(signMessage(unsigned, vault.identity.privKey));
  await node.update();
}
const emitHello = () => emit({ t: "hello", name: shortId(), walletAddr: vault.wallet.address });
const shortId = () => "fan-" + vault.identity.idKey.slice(2, 6);
const marketId = () => "m-" + Date.now().toString(36);

// ── Terrace lifecycle ─────────────────────────────────────────────────────────
async function openTerrace() {
  node = await TerraceNode.open({ storagePath: storageRoot });
  role = "opener";
  await node.joinSwarm();
  await emitHello();
  screen = "terrace";
  startPolling();
  render();
}
async function joinTerrace(inviteKey) {
  node = await TerraceNode.open({ storagePath: storageRoot, inviteKey: inviteKey.trim() });
  role = "joiner";
  await node.joinSwarm();
  screen = "terrace";
  startPolling();
  render();
}
async function authorizeWriter(writerKey) {
  await node.addWriter(writerKey.trim());
  toast("Authorized ✓");
}

let polling = null;
function startPolling() {
  if (polling) return;
  polling = setInterval(async () => {
    if (!node) return;
    await node.update();
    if (role === "joiner" && node.writable()) {
      // Became writable → announce identity once.
      role = "joiner-active";
      await emitHello();
    }
    if (screen === "terrace" || screen === "market") render();
  }, 1000);
}
globalThis.Pear?.teardown?.(async () => { clearInterval(polling); await node?.close(); });

// ── Markets ────────────────────────────────────────────────────────────────────
async function openMarketFromFixture(fx) {
  const spec = matchResult(fx.home, fx.away);
  await emit({ t: "market", marketId: marketId(), kind: spec.kind, params: spec.params, cutoffAt: Date.now() + 90 * 60_000, feeBps: 0 });
  toast("Market opened");
}
async function placeBet(m, outcomeKey, usdt) {
  const amount = BigInt(Math.round(usdt * 1_000_000));
  await emit({ t: "bet", marketId: m.marketId, outcomeKey, amount, nonce: "bet-" + Date.now().toString(36) });
  toast(`Bet ${usdt} USDt on ${outcomeKey}`);
}
async function lockMarket(m) { await emit({ t: "lock", marketId: m.marketId }); toast("Locked"); }

async function attestFromAsr(m) {
  const asr = new FakeAsr(DEMO_TRANSCRIPT); // offline demo path
  const transcript = await asr.transcribe();
  const meta = m.params.meta ?? {};
  const pre = prefillAttestation(transcript, { outcomes: m.params.outcomes, homeTeam: meta.homeTeam ?? "HOME", awayTeam: meta.awayTeam ?? "AWAY" });
  if (!pre) return toast("No score heard — attest manually");
  await emit({ t: "attest", marketId: m.marketId, outcomeKey: pre.outcomeKey, evidence: { asrScore: pre.asrScore, confidence: pre.confidence } });
  toast(`Attested ${pre.asrScore}`);
}

async function settle(m, outcomeKey) {
  const kv = node.view();
  const bets = (await readValidBets(kv, m.marketId)).map((b) => ({ betId: b.betId, bettorId: b.bettorId, outcomeKey: b.outcomeKey, stake: b.stake }));
  const manifest = computePayouts({ bets, resolution: { kind: "outcome", outcomeKey }, feeBps: m.feeBps });
  const stakes = new Map();
  for (const b of bets) stakes.set(b.bettorId, (stakes.get(b.bettorId) ?? 0n) + b.stake);
  const identities = await readIdentities(kv);
  const walletOf = (idKey) => identities.get(idKey)?.walletAddr ?? idKey;
  const transfers = settlementManifest(
    minTransfers(computeDeltas(manifest, stakes)).map((t) => ({ from: walletOf(t.from), to: walletOf(t.to), amount: t.amount })),
  );
  const receipts = await settleMyDebts(transfers, wallet); // only my own debts
  for (const r of receipts) await emit({ t: "receipt", marketId: m.marketId, manifestLine: r.line, txid: r.txid });
  toast(receipts.length ? `Paid ${receipts.length} transfer(s)` : "Nothing to pay");
}

async function sendChat(text) {
  if (!text.trim()) return;
  await emit({ t: "chat", text, lang: "en" });
}

// ── Rendering ────────────────────────────────────────────────────────────────
function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function pct(n) { return Math.round(n * 100); }

async function render() {
  app.replaceChildren();
  if (toastMsg) app.appendChild(h(`<div class="toast">${toastMsg}</div>`));
  if (screen === "home") return renderHome();
  if (screen === "terrace") return renderTerrace();
  if (screen === "market") return renderMarket();
}

function renderHome() {
  const card = h(`<div class="card stack">
    <h2>Start</h2>
    <button id="open">Open a terrace</button>
    <div class="row"><input id="invite" placeholder="paste invite key to join" /><button class="ghost" id="join">Join</button></div>
    <p class="muted">A terrace is a serverless market among the fans watching. No host, no cloud, your keys.</p>
  </div>`);
  card.querySelector("#open").onclick = openTerrace;
  card.querySelector("#join").onclick = () => joinTerrace(card.querySelector("#invite").value);
  app.appendChild(card);
}

async function renderTerrace() {
  const invite = h(`<div class="card stack">
    <h2>This terrace</h2>
    <div class="row"><span class="pill">${role}</span><span class="pill">${node.writable() ? "writer" : "read-only"}</span></div>
    <div><div class="muted">Invite key (share to let mates join)</div><div class="mono">${node.key()}</div></div>
    <div><div class="muted">Your writer key (send to the host to be authorized)</div><div class="mono">${node.localWriterKey()}</div></div>
    <div class="row"><input id="authk" placeholder="authorize a mate's writer key" /><button class="ghost" id="auth">Authorize</button></div>
  </div>`);
  invite.querySelector("#auth").onclick = () => authorizeWriter(invite.querySelector("#authk").value);
  app.appendChild(invite);

  // New market from a bundled fixture + hunch suggestions.
  const opener = h(`<div class="card stack"><h2>Open a market</h2></div>`);
  for (const fx of FIXTURES) {
    const b = h(`<button class="ghost">${fx.home} vs ${fx.away}</button>`);
    b.onclick = () => openMarketFromFixture(fx);
    opener.appendChild(b);
    const s = suggestMarkets(fx.home, fx.away, STATS_BUNDLE).slice(1, 2)[0];
    if (s) opener.appendChild(h(`<div class="muted">↳ ${s.reason}</div>`));
  }
  app.appendChild(opener);

  // Live markets.
  const kv = node.view();
  const markets = await readMarkets(kv);
  const list = h(`<div class="card stack"><h2>Markets (${markets.length})</h2></div>`);
  for (const m of markets) {
    const btn = h(`<button class="ghost" style="text-align:left">${m.params.title}</button>`);
    btn.onclick = () => { selectedMarket = m.marketId; screen = "market"; render(); };
    list.appendChild(btn);
  }
  if (!markets.length) list.appendChild(h(`<p class="muted">No markets yet.</p>`));
  app.appendChild(list);

  renderChat(kv);
}

async function renderMarket() {
  const kv = node.view();
  const m = (await readMarkets(kv)).find((x) => x.marketId === selectedMarket);
  if (!m) { screen = "terrace"; return render(); }

  const gross = await readPools(kv, m.marketId);
  const pools = buildPools(await betList(kv, m), m.feeBps);
  const odds = impliedOdds(pools);
  const locked = await isLocked(kv, m.marketId);

  const back = h(`<button class="ghost" id="back">← terrace</button>`);
  back.onclick = () => { screen = "terrace"; render(); };
  app.appendChild(back);

  const head = h(`<div class="card stack">
    <h2>${m.params.title}</h2>
    <div class="row"><span class="pill">${m.kind}</span><span class="pill">${locked ? "LOCKED" : "OPEN"}</span><span class="pill">fee ${m.feeBps}bps</span></div>
  </div>`);
  app.appendChild(head);

  const oddsCard = h(`<div class="card stack"><h2>Pool odds</h2></div>`);
  for (const key of m.params.outcomes) {
    const o = odds[key] ?? { probability: 0, decimalOdds: null };
    const g = (gross[key] ?? 0n);
    oddsCard.appendChild(h(`<div>
      <div class="row"><span class="${key}">${key}</span><span class="muted">${(Number(g)/1e6).toFixed(0)} USDt</span><span>${o.decimalOdds ? "×"+o.decimalOdds.toFixed(2) : "—"}</span></div>
      <div class="bar"><span class="b${key}" style="width:${pct(o.probability)}%"></span></div>
    </div>`));
    if (!locked && node.writable()) {
      const bet = h(`<div class="row tight"><input type="number" min="0" step="1" value="10" /><button>Bet ${key}</button></div>`);
      bet.querySelector("button").onclick = () => placeBet(m, key, Number(bet.querySelector("input").value));
      oddsCard.appendChild(bet);
    }
  }
  app.appendChild(oddsCard);

  // Resolution + settlement.
  const events = await readAttestationLog(kv, m.marketId);
  const stakes = new Map();
  for (const b of await readValidBets(kv, m.marketId)) stakes.set(b.bettorId, (stakes.get(b.bettorId) ?? 0n) + b.stake);
  const res = resolveMarket({ events, stakeByWriter: stakes, now: Date.now(), disputeWindowMs: DISPUTE_WINDOW_MS });

  const resCard = h(`<div class="card stack">
    <h2>Resolution</h2>
    <div>Status: <b>${res.status}</b> ${res.outcomeKey ? '<span class="'+res.outcomeKey+'">'+res.outcomeKey+'</span>' : ""}</div>
  </div>`);
  if (node.writable()) {
    if (!locked) { const b = h(`<button class="ghost">Lock (whistle)</button>`); b.onclick = () => lockMarket(m); resCard.appendChild(b); }
    const a = h(`<button class="ghost">🎙 Attest from ASR</button>`); a.onclick = () => attestFromAsr(m); resCard.appendChild(a);
    if (res.status === "resolved") { const s = h(`<button>Settle in USDt</button>`); s.onclick = () => settle(m, res.outcomeKey); resCard.appendChild(s); }
  }
  // Everyone's-square checklist.
  const receipts = await import("@tifo/terrace-base").then((mod) => mod.readReceipts(kv, m.marketId));
  if (receipts.length) resCard.appendChild(h(`<div class="square">Receipts: ${receipts.length} line(s) settled ✓</div>`));
  app.appendChild(resCard);

  renderChat(kv);
}

async function betList(kv, m) {
  return (await readValidBets(kv, m.marketId)).map((b) => ({ betId: b.betId, bettorId: b.bettorId, outcomeKey: b.outcomeKey, stake: b.stake }));
}

async function renderChat(kv) {
  const gaffer = await gafferQuipFromView(kv);
  const card = h(`<div class="card stack"><h2>Terrace</h2><div class="gaffer">🎩 ${gaffer}</div><div class="chat" id="chat"></div>
    <div class="row"><input id="msg" placeholder="say something…" /><button id="send">Send</button></div></div>`);
  const chat = card.querySelector("#chat");
  for (const line of await readChat(kv)) {
    const shown = await renderForViewer({ text: line.text, lang: line.lang }, "en", translator);
    chat.appendChild(h(`<div class="line"><span class="muted">${line.author.slice(2, 6)}</span> ${escapeHtml(shown)}</div>`));
  }
  card.querySelector("#send").onclick = async () => { await sendChat(card.querySelector("#msg").value); card.querySelector("#msg").value = ""; };
  app.appendChild(card);
}

async function gafferQuipFromView(kv) {
  const markets = await readMarkets(kv);
  const m = markets.find((x) => x.marketId === selectedMarket) ?? markets[0];
  if (!m) return "Open a market and I'll have something to say.";
  const pools = buildPools(await betList(kv, m), m.feeBps);
  const odds = impliedOdds(pools);
  return fallbackQuip({ title: m.params.title, outcomes: m.params.outcomes.map((k) => ({ key: k, pct: pct(odds[k]?.probability ?? 0) })) });
}

function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

render();
