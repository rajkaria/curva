/**
 * TIFO — the Pear app.
 *
 * A thin DOM shell over @tifo/terrace-ui: every string on screen comes from a
 * tested view-model, every piece of markup built from peer strings goes
 * through the tested html helpers, and all money/consensus math lives in the
 * pure packages. This file is wiring: node lifecycle, action handlers, and a
 * versioned render loop.
 *
 * Render loop (S12): the 1s tick calls render() only when the view version
 * moved or local UI state changed — zero Hyperbee scans, zero DOM work while
 * idle. Renders are serialized by a mutex with a trailing re-run, and the DOM
 * swap is deferred while the user is typing in an input (values are restored
 * across swaps via stable ids), so background gossip can't wipe a half-typed
 * message or stake. A separate 1s ticker updates only the countdown text nodes
 * and the header (peer count / balance) — no full re-render, so live clocks and
 * presence never wipe an in-progress input (S13).
 *
 * Demo/offline mode (default): settlement uses FakeWallet and the oracle uses a
 * bundled commentary transcript via FakeAsr — now labelled in-UI by the demo
 * banner (S13). Real mode (a funded WDK wallet + a downloaded QVAC model) swaps
 * the adapters with no protocol change; the banner disappears automatically.
 * Pairing uses the spec-sanctioned paste-a-key flow (BlindPairing roadmap: S15).
 */
import { TerraceNode, signMessage } from "@tifo/terrace-base";
import {
  deriveVault, randomVault, isValidMnemonic,
  computeDeltas, minTransfers, settlementManifest, settleMyDebts, FakeWallet,
} from "@tifo/wdk-vault";
import { matchResult } from "@tifo/market-catalogue";
import { prefillAttestation, FakeAsr } from "@tifo/crowd-oracle";
import { computePayouts } from "@tifo/market-kernel";
import { FakeTranslator, suggestMarkets } from "@tifo/qvac-surfaces";
import {
  terraceVm, marketVm, chatVm, gafferVm, settlementVm,
  positionVm, previewPayout, pnlVm, tallyVm, headerVm,
  LANGS, countdown, usdt,
  esc, outcomeClass, marketHeadHtml, outcomeRowHtml, chatLineHtml, cdSpanHtml,
  demoBannerHtml, headerWidgetsHtml, positionHtml, previewLineHtml, pnlHtml, tallyHtml,
} from "@tifo/terrace-ui";
import { FIXTURES, STATS_BUNDLE, DEMO_TRANSCRIPT } from "../../fixtures/wc2026.js";

const DISPUTE_WINDOW_MS = 10 * 60_000;
// Stable per-terrace storage: the local writer core must survive restarts, or
// the host has to re-authorize this peer after every launch.
const storageBase = globalThis.Pear?.config?.storage ?? "./store";
const translator = new FakeTranslator();
const app = document.getElementById("app");
const headWidgets = document.getElementById("head-widgets");
const banner = document.getElementById("banner");

// Nation flags for the bundled fixtures — our own constants (never peer data).
const TEAM_EMOJI = { France: "🇫🇷", Brazil: "🇧🇷", Argentina: "🇦🇷", England: "🇬🇧" };
const teamEmoji = (name) => TEAM_EMOJI[name] ?? "⚽";

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

// ── Runtime state ─────────────────────────────────────────────────────────────
let node = null;
let role = "none"; // none | opener | joiner | joiner-active
let screen = "home";
let selectedMarket = null;
let toastMsg = "";
const wallet = new FakeWallet(vault.wallet.address, 1000n * 1_000_000n); // demo-funded
// Demo mode is *derived*, not asserted: the banner shows iff the fakes are live.
const demoMode = wallet instanceof FakeWallet;

const shortId = () => "fan-" + vault.identity.idKey.slice(2, 6);
// Local, non-replicated UI prefs (name + chat language), persisted.
let displayName = localStorage.getItem("tifo.name") || shortId();
localStorage.setItem("tifo.name", displayName);
let lang = localStorage.getItem("tifo.lang") || "en";
let chatPinnedToBottom = true; // autoscroll unless the reader has scrolled up

/** The uiState every VM sees — assembled fresh per render pass. */
function uiState() {
  return {
    now: Date.now(),
    writable: node?.writable() ?? false,
    role,
    inviteKey: node?.key() ?? "",
    writerKey: node?.localWriterKey() ?? "",
    viewerId: vault.identity.idKey,
    viewerLang: lang,
    disputeWindowMs: DISPUTE_WINDOW_MS,
  };
}

function toast(m) {
  toastMsg = m;
  markDirty();
  setTimeout(() => { toastMsg = ""; markDirty(); }, 2200);
}

/** A one-shot full-screen flourish — the terrace is square. */
function celebrate(emoji = "🎉") {
  const el = document.createElement("div");
  el.className = "celebrate";
  el.textContent = emoji;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

/** Single-flight guard for async button handlers: no double-spend double-clicks,
 *  and every failure surfaces as a toast instead of an unhandled rejection. */
function busy(btn, fn) {
  btn.onclick = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } catch (err) { toast("⚠ " + (err?.message ?? err)); } finally { btn.disabled = false; }
  };
}

// ── Message emit (build → sign → append) ─────────────────────────────────────
// Returns true only if the message was actually appended.
async function emit(fields) {
  if (!node || !node.writable()) {
    toast("Read-only — ask the host to authorize your writer key");
    return false;
  }
  const unsigned = { v: 1, author: vault.identity.idKey, ts: Date.now(), ...fields };
  await node.append(signMessage(unsigned, vault.identity.privKey));
  await node.update();
  scheduleRender(); // the version already moved — don't wait for the tick
  return true;
}
const emitHello = () => emit({ t: "hello", name: displayName, walletAddr: vault.wallet.address });
// Ids carry an author suffix + local counter: two peers acting in the same
// millisecond must never collide (first-wins would silently eat one of them).
let uidCounter = 0;
const uid = () => Date.now().toString(36) + "-" + vault.identity.idKey.slice(2, 8) + "-" + (uidCounter++).toString(36);
const marketId = () => "m-" + uid();

// ── Identity prefs ────────────────────────────────────────────────────────────
async function setName(n) {
  const name = n.trim() || shortId();
  displayName = name;
  localStorage.setItem("tifo.name", name);
  await updateHeader();
  if (node?.writable()) await emitHello(); // re-announce so peers see the new name
  toast("Name set");
}
function setLang(l) {
  lang = l;
  localStorage.setItem("tifo.lang", l);
  markDirty(); // re-render translates every line into the new language
}

// ── Terrace lifecycle ─────────────────────────────────────────────────────────
const HEX64 = /^[0-9a-f]{64}$/i;

async function openTerrace() {
  node = await TerraceNode.open({ storagePath: storageBase + "/terrace-host" });
  role = "opener";
  await node.joinSwarm();
  await emitHello();
  screen = "terrace";
  startPolling();
  markDirty();
}
async function joinTerrace(inviteKey) {
  const key = inviteKey.trim();
  if (!HEX64.test(key)) return toast("That doesn't look like an invite key (64 hex chars)");
  node = await TerraceNode.open({ storagePath: storageBase + "/terrace-" + key.slice(0, 16), inviteKey: key });
  role = "joiner";
  await node.joinSwarm();
  screen = "terrace";
  startPolling();
  markDirty();
}
async function authorizeWriter(writerKey) {
  const key = writerKey.trim();
  if (!HEX64.test(key)) return toast("That doesn't look like a writer key (64 hex chars)");
  await node.addWriter(key);
  toast("Authorized ✓");
}

// ── Render loop: versioned, serialized, focus-safe ───────────────────────────
let viewVersion = -1;   // last rendered view version
let stateDirty = true;  // local uiState changed since last render
let rendering = false;  // mutex: a render pass is in flight
let renderQueued = false; // trailing flag: re-run once the current pass ends
let deferredForFocus = false; // at most one render parked behind a focused input

/** Local state changed (navigation, toast, role) — render at next opportunity. */
function markDirty() {
  stateDirty = true;
  scheduleRender();
}

function focusedAppInput() {
  const el = document.activeElement;
  return el && el.tagName === "INPUT" && app.contains(el) ? el : null;
}

/**
 * The only entry point to render(). Serializes async renders (mutex +
 * trailing re-run — two passes never interleave) and defers the DOM swap
 * while an input inside #app has focus, resuming on blur.
 */
function scheduleRender() {
  const focused = focusedAppInput();
  if (focused) {
    if (!deferredForFocus) {
      deferredForFocus = true;
      focused.addEventListener(
        "blur",
        () => { deferredForFocus = false; scheduleRender(); },
        { once: true },
      );
    }
    return;
  }
  if (rendering) { renderQueued = true; return; }
  rendering = true;
  (async () => {
    try {
      do { renderQueued = false; await render(); } while (renderQueued);
    } catch (err) {
      console.error("render failed", err);
    } finally {
      rendering = false;
    }
  })();
}

/** Update the countdown text nodes in place — no re-render, so it's focus-safe. */
function tickCountdowns() {
  const now = Date.now();
  for (const el of document.querySelectorAll("[data-cd-to]")) {
    const to = Number(el.getAttribute("data-cd-to"));
    const prefix = el.getAttribute("data-cd-prefix") || "";
    el.textContent = prefix + countdown(to - now);
  }
}

/** Refresh the header widgets (name, balance, presence) + demo banner. */
async function updateHeader() {
  const balance = await wallet.balance();
  const vm = headerVm({
    displayName,
    walletAddr: vault.wallet.address,
    balance,
    peerCount: node?.peerCount() ?? 0,
    demoMode,
  });
  headWidgets.innerHTML = headerWidgetsHtml(vm);
  banner.innerHTML = demoMode ? demoBannerHtml() : "";
}

let polling = null;
function startPolling() {
  if (polling) return;
  polling = setInterval(async () => {
    if (!node) return;
    // Time- and presence-driven surfaces move every second regardless of the
    // view version, and touch no inputs — so they run every tick, cheaply.
    tickCountdowns();
    await updateHeader();
    await node.update();
    if (role === "joiner" && node.writable()) {
      // Became writable → announce identity once.
      role = "joiner-active";
      stateDirty = true;
      await emitHello();
    }
    // The whole point of S12: zero render work while nothing changed.
    if (node.version() === viewVersion && !stateDirty) return;
    scheduleRender();
  }, 1000);
}
globalThis.Pear?.teardown?.(async () => { clearInterval(polling); await node?.close(); });

// ── Markets ────────────────────────────────────────────────────────────────────
async function openMarketFromFixture(fx) {
  const spec = matchResult(fx.home, fx.away);
  const ok = await emit({ t: "market", marketId: marketId(), kind: spec.kind, params: spec.params, cutoffAt: Date.now() + 90 * 60_000, feeBps: 0 });
  if (ok) toast("Market opened");
}
async function placeBet(vm, outcomeKey, usdtAmount) {
  if (!Number.isFinite(usdtAmount) || usdtAmount <= 0 || usdtAmount > 1e9) return toast("Enter a stake above 0");
  const amount = BigInt(Math.round(usdtAmount * 1_000_000));
  const ok = await emit({ t: "bet", marketId: vm.marketId, outcomeKey, amount, nonce: "bet-" + uid() });
  if (ok) toast(`Bet ${usdtAmount} USDt on ${outcomeKey}`);
}
async function lockMarket(vm) { if (await emit({ t: "lock", marketId: vm.marketId })) toast("Locked"); }

async function attestFromAsr(vm) {
  const asr = new FakeAsr(DEMO_TRANSCRIPT); // offline demo path
  const transcript = await asr.transcribe();
  const pre = prefillAttestation(transcript, {
    outcomes: vm.outcomes.map((o) => o.key),
    homeTeam: vm.meta.homeTeam ?? "HOME",
    awayTeam: vm.meta.awayTeam ?? "AWAY",
  });
  if (!pre) return toast("No score heard — attest manually below");
  const ok = await emit({ t: "attest", marketId: vm.marketId, outcomeKey: pre.outcomeKey, evidence: { asrScore: pre.asrScore, confidence: pre.confidence } });
  if (ok) toast(`Attested ${pre.asrScore}`);
}
/** Manual attest — the same signed `attest` message the ASR path emits. */
async function attestManual(vm, outcomeKey) {
  const ok = await emit({ t: "attest", marketId: vm.marketId, outcomeKey, evidence: { confidence: 1, manual: true } });
  if (ok) toast(`Attested ${outcomeKey}`);
}

async function settle(vm) {
  const s = await settlementVm(node.view(), vm.marketId);
  const manifest = computePayouts({
    bets: s.bets,
    resolution: { kind: "outcome", outcomeKey: vm.resolution.outcomeKey },
    feeBps: vm.feeBps,
  });
  const transfers = settlementManifest(
    minTransfers(computeDeltas(manifest, s.stakes)).map((t) => ({ from: s.walletOf(t.from), to: s.walletOf(t.to), amount: t.amount })),
  );
  const receipts = await settleMyDebts(transfers, wallet); // only my own debts
  for (const r of receipts) await emit({ t: "receipt", marketId: vm.marketId, manifestLine: r.line, txid: r.txid });
  await updateHeader(); // balance moved
  if (receipts.length) { toast(`Paid ${receipts.length} transfer(s)`); celebrate("🎉"); }
  else toast("Nothing to pay");
}

async function sendChat(text) {
  if (!text.trim()) return;
  await emit({ t: "chat", text, lang });
}

// ── Rendering: VMs → DOM ─────────────────────────────────────────────────────
function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// Input values survive the swap: snapshot by stable id, restore after —
// but only within the same screen+market (never leak a stake across markets).
const viewKey = () => `${screen}:${selectedMarket}`;
let lastViewKey = "";
function snapshotInputs() {
  const snap = new Map();
  for (const el of app.querySelectorAll("input[id]")) snap.set(el.id, el.value);
  return snap;
}
function restoreInputs(snap) {
  for (const [id, value] of snap) {
    const el = app.querySelector(`#${CSS.escape(id)}`);
    if (el) el.value = value;
  }
}

async function render() {
  viewVersion = node?.version() ?? -1;
  stateDirty = false;
  const snap = lastViewKey === viewKey() ? snapshotInputs() : null;

  // Build the whole screen off-DOM, swap once: no partial states, and the
  // focus guard has a single well-defined swap point.
  const stage = document.createDocumentFragment();
  if (toastMsg) stage.appendChild(h(`<div class="toast">${esc(toastMsg)}</div>`));
  if (screen === "home") renderHome(stage);
  else if (screen === "terrace") await renderTerrace(stage);
  else if (screen === "market") await renderMarket(stage);

  app.replaceChildren(stage);
  lastViewKey = viewKey();
  if (snap) restoreInputs(snap);
  tickCountdowns(); // set fresh countdown nodes to the right value immediately
  const chat = app.querySelector("#chat");
  if (chat && chatPinnedToBottom) chat.scrollTop = chat.scrollHeight;
}

function renderHome(stage) {
  const card = h(`<div class="card stack">
    <h2>Start</h2>
    <button id="open">Open a terrace</button>
    <div class="row"><input id="invite" placeholder="paste invite key to join" /><button class="ghost" id="join">Join</button></div>
    <p class="muted">A terrace is a serverless market among the fans watching. No host, no cloud, your keys.</p>
  </div>`);
  busy(card.querySelector("#open"), openTerrace);
  busy(card.querySelector("#join"), () => joinTerrace(card.querySelector("#invite").value));
  stage.appendChild(card);
}

async function renderTerrace(stage) {
  const kv = node.view();
  const state = uiState();
  const t = await terraceVm(kv, state);

  const invite = h(`<div class="card stack">
    <h2>This terrace</h2>
    <div class="row"><span class="pill">${esc(t.role)}</span><span class="pill">${t.writable ? "writer" : "read-only"}</span></div>
    <div class="row"><input id="displayname" value="${esc(displayName)}" placeholder="your name" /><button class="ghost" id="setname">Set name</button></div>
    <div><div class="muted">Invite key (share to let mates join)</div><div class="mono">${esc(t.invite)}</div></div>
    <div><div class="muted">Your writer key (send to the host to be authorized)</div><div class="mono">${esc(t.writerKey)}</div></div>
    <div class="row"><input id="authk" placeholder="authorize a mate's writer key" /><button class="ghost" id="auth">Authorize</button></div>
  </div>`);
  busy(invite.querySelector("#setname"), () => setName(invite.querySelector("#displayname").value));
  busy(invite.querySelector("#auth"), () => authorizeWriter(invite.querySelector("#authk").value));
  stage.appendChild(invite);

  // New market from a bundled fixture + hunch suggestions.
  const opener = h(`<div class="card stack"><h2>Open a market</h2></div>`);
  for (const fx of FIXTURES) {
    const b = h(`<button class="ghost">${teamEmoji(fx.home)} ${esc(fx.home)} vs ${teamEmoji(fx.away)} ${esc(fx.away)}</button>`);
    busy(b, () => openMarketFromFixture(fx));
    opener.appendChild(b);
    const s = suggestMarkets(fx.home, fx.away, STATS_BUNDLE).slice(1, 2)[0];
    if (s) opener.appendChild(h(`<div class="muted">↳ ${esc(s.reason)}</div>`));
  }
  stage.appendChild(opener);

  // Live markets.
  const list = h(`<div class="card stack"><h2>Markets (${t.markets.length})</h2></div>`);
  for (const item of t.markets) {
    const closes = item.closesAt !== null ? cdSpanHtml(item.closesAt, "closes in ", item.closesLabel) : esc(item.closesLabel);
    const btn = h(`<button class="ghost" style="text-align:left">${esc(item.title)} <span class="muted">· ${closes}</span></button>`);
    btn.onclick = () => { selectedMarket = item.marketId; screen = "market"; markDirty(); };
    list.appendChild(btn);
  }
  if (!t.markets.length) list.appendChild(h(`<p class="muted">No markets yet.</p>`));
  stage.appendChild(list);

  await renderChatCard(stage, kv, state);
}

async function renderMarket(stage) {
  const kv = node.view();
  const state = uiState();
  const vm = await marketVm(kv, state, selectedMarket);
  if (!vm) { screen = "terrace"; return renderTerrace(stage); }
  const me = state.viewerId;
  const s = await settlementVm(kv, selectedMarket); // kernel bets + stakes, read once

  const back = h(`<button class="ghost" id="back">← terrace</button>`);
  back.onclick = () => { screen = "terrace"; markDirty(); };
  stage.appendChild(back);

  stage.appendChild(h(marketHeadHtml(vm)));

  // Your position — what you have at risk.
  const posCard = h(`<div class="card stack"><h2>Your position</h2></div>`);
  posCard.appendChild(h(positionHtml(await positionVm(kv, selectedMarket, me))));
  stage.appendChild(posCard);

  // Pool odds + bet, with a live payout preview under each stake input.
  const oddsCard = h(`<div class="card stack"><h2>Pool odds</h2></div>`);
  vm.outcomes.forEach((o, i) => {
    oddsCard.appendChild(h(outcomeRowHtml(o)));
    if (vm.canBet) {
      const bet = h(`<div class="stack">
        <div class="row tight"><input id="stake-${i}" type="number" min="1" step="1" value="10" /><button>Bet ${esc(o.key)}</button></div>
        <div id="preview-${i}"></div>
      </div>`);
      const input = bet.querySelector("input");
      const preview = bet.querySelector(`#preview-${i}`);
      const refresh = () => {
        const n = Number(input.value);
        preview.innerHTML =
          Number.isFinite(n) && n > 0
            ? previewLineHtml(o.key, usdt(previewPayout(s.bets, vm.feeBps, o.key, BigInt(Math.round(n * 1_000_000)), me)))
            : "";
      };
      input.addEventListener("input", refresh);
      refresh();
      busy(bet.querySelector("button"), () => placeBet(vm, o.key, Number(input.value)));
      oddsCard.appendChild(bet);
    }
  });
  stage.appendChild(oddsCard);

  // Resolution + settle + your P&L.
  const res = vm.resolution;
  const finalizes =
    vm.finalizesLabel && vm.finalizesAt !== null
      ? ` <span class="muted">${cdSpanHtml(vm.finalizesAt, "finalizes in ", vm.finalizesLabel)}</span>`
      : "";
  const resCard = h(`<div class="card stack">
    <h2>Resolution</h2>
    <div>Status: <b>${esc(res.status)}</b> ${res.outcomeKey ? '<span class="' + outcomeClass(res.outcomeKey) + '">' + esc(res.outcomeKey) + "</span>" : ""}${finalizes}</div>
  </div>`);
  if (vm.canLock) { const b = h(`<button class="ghost">Lock (whistle)</button>`); busy(b, () => lockMarket(vm)); resCard.appendChild(b); }
  if (vm.canSettle) { const b = h(`<button>Settle in USDt</button>`); busy(b, () => settle(vm)); resCard.appendChild(b); }
  if (res.status === "resolved") {
    const manifest = computePayouts({ bets: s.bets, resolution: { kind: "outcome", outcomeKey: res.outcomeKey }, feeBps: vm.feeBps });
    resCard.appendChild(h(pnlHtml(pnlVm(manifest, s.stakes, me))));
  }
  if (vm.receipts) resCard.appendChild(h(`<div class="square">Receipts: ${vm.receipts} line(s) settled ✓</div>`));
  stage.appendChild(resCard);

  // Attestation — live quorum standings + who voted, plus how to attest.
  const attCard = h(`<div class="card stack"><h2>Attestation</h2></div>`);
  attCard.appendChild(h(tallyHtml(await tallyVm(kv, selectedMarket, s.stakes))));
  if (state.writable) {
    const asr = h(`<button class="ghost">🎙 Attest from ASR</button>`);
    busy(asr, () => attestFromAsr(vm));
    attCard.appendChild(asr);
    const details = h(`<details class="stack"><summary class="muted">Attest manually</summary><div class="row wrap" style="margin-top:8px"></div></details>`);
    const box = details.querySelector("div");
    for (const o of vm.outcomes) { const b = h(`<button class="ghost">${esc(o.key)}</button>`); busy(b, () => attestManual(vm, o.key)); box.appendChild(b); }
    attCard.appendChild(details);
  }
  stage.appendChild(attCard);

  await renderChatCard(stage, kv, state);
}

async function renderChatCard(stage, kv, state) {
  const quip = await gafferVm(kv, selectedMarket);
  const lines = await chatVm(kv, state, translator);
  const langOpts = LANGS.map((l) => `<option value="${esc(l.code)}"${l.code === lang ? " selected" : ""}>${esc(l.label)}</option>`).join("");
  const card = h(`<div class="card stack"><h2>Terrace</h2>
    <div class="gaffer">🎩 ${esc(quip)}</div>
    <div class="chat" id="chat"></div>
    <div class="row"><input id="msg" placeholder="say something…" /><select id="lang" style="flex:0 0 auto;width:auto">${langOpts}</select><button id="send">Send</button></div>
  </div>`);
  const chat = card.querySelector("#chat");
  for (const line of lines) chat.appendChild(h(chatLineHtml(line)));
  chat.addEventListener("scroll", () => {
    chatPinnedToBottom = chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 8;
  });
  const msg = card.querySelector("#msg");
  const send = async () => { const v = msg.value; msg.value = ""; chatPinnedToBottom = true; await sendChat(v); };
  msg.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
  card.querySelector("#lang").addEventListener("change", (e) => setLang(e.target.value));
  busy(card.querySelector("#send"), send);
  stage.appendChild(card);
}

updateHeader();
scheduleRender();
