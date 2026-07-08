/**
 * Curva — the Pear app.
 *
 * A thin DOM shell over @curva/terrace-ui: every string on screen comes from a
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
import { TerraceNode, signMessage } from "@curva/terrace-base";
import {
  deriveVault, randomVault, isValidMnemonic,
  computeDeltas, minTransfers, settlementManifest, settleMyDebts, FakeWallet,
} from "@curva/wdk-vault";
import { scheduleMicroRounds } from "@curva/market-catalogue";
import { prefillAttestation, FakeAsr } from "@curva/crowd-oracle";
import { computePayouts } from "@curva/market-kernel";
import { FakeTranslator, suggestMarkets, buildGafferContext, fallbackQuip, QvacLlm } from "@curva/qvac-surfaces";
import {
  terraceVm, marketVm, chatVm, gafferPoolVm, settlementVm,
  positionVm, previewPayout, pnlVm, tallyVm, headerVm,
  marketPickerVm, planMicroRounds, leaderboardVm, escrowVm, recentTerracesVm,
  LANGS, GAFFER_IDLE, countdown, usdt,
  esc, outcomeClass, marketHeadHtml, outcomeRowHtml, chatLineHtml, cdSpanHtml,
  demoBannerHtml, headerWidgetsHtml, positionHtml, previewLineHtml, pnlHtml, tallyHtml,
  leaderboardHtml, escrowHtml,
} from "@curva/terrace-ui";
import { FIXTURES, STATS_BUNDLE, DEMO_TRANSCRIPT } from "../../fixtures/wc2026.js";

const DISPUTE_WINDOW_MS = 10 * 60_000;
// Micro-rounds: a fresh 10-minute goal-in-window pool every 10 minutes, so the
// terrace never runs out of something live to trade (the live-demo killer).
const MICRO_ROUND_MS = 10 * 60_000;
const MICRO_ROUND_COUNT = 9; // a 90-minute match
// Where the QVAC Gaffer model would load from in real mode — the lazy import of
// @qvac/sdk fails cleanly in demo mode, so the Gaffer stays on templates.
const GAFFER_MODEL_SRC = "./models/llama-3.2-1b-q4_0.gguf";
// Stable per-terrace storage: the local writer core must survive restarts, or
// the host has to re-authorize this peer after every launch.
const storageBase = globalThis.Pear?.config?.storage ?? "./store";
const translator = new FakeTranslator();
const app = document.getElementById("app");
const headWidgets = document.getElementById("head-widgets");
const banner = document.getElementById("banner");

// Nation flags for the bundled bracket — our own constants (never peer data).
const TEAM_EMOJI = {
  France: "🇫🇷", Brazil: "🇧🇷", Argentina: "🇦🇷", England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", Spain: "🇪🇸", Germany: "🇩🇪",
  Portugal: "🇵🇹", Netherlands: "🇳🇱", Belgium: "🇧🇪", Croatia: "🇭🇷", Italy: "🇮🇹", Uruguay: "🇺🇾",
  USA: "🇺🇸", Mexico: "🇲🇽", Japan: "🇯🇵", Morocco: "🇲🇦",
};
const teamEmoji = (name) => TEAM_EMOJI[name] ?? "⚽";

// ── Vault (persisted seed) ───────────────────────────────────────────────────
function loadVault() {
  let mnemonic = localStorage.getItem("curva.mnemonic");
  if (!mnemonic || !isValidMnemonic(mnemonic)) {
    mnemonic = randomVault().mnemonic;
    localStorage.setItem("curva.mnemonic", mnemonic);
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
// Opener-side micro-round scheduler: { fixtureId, matchStart, rounds } or null.
let liveRounds = null;
// Gaffer model: lazy QVAC LLM + its load state (off | loading | ready | failed).
let gafferLlm = null;
let gafferState = "off";
const wallet = new FakeWallet(vault.wallet.address, 1000n * 1_000_000n); // demo-funded
// Demo mode is *derived*, not asserted: the banner shows iff the fakes are live.
const demoMode = wallet instanceof FakeWallet;

const shortId = () => "fan-" + vault.identity.idKey.slice(2, 6);
// Local, non-replicated UI prefs (name + chat language), persisted.
let displayName = localStorage.getItem("curva.name") || shortId();
localStorage.setItem("curva.name", displayName);
let lang = localStorage.getItem("curva.lang") || "en";
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
  localStorage.setItem("curva.name", name);
  await updateHeader();
  if (node?.writable()) await emitHello(); // re-announce so peers see the new name
  toast("Name set");
}
function setLang(l) {
  lang = l;
  localStorage.setItem("curva.lang", l);
  markDirty(); // re-render translates every line into the new language
}

// ── Recent terraces (persisted, never replicated) ─────────────────────────────
function loadRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem("curva.terraces") || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
/** Remember (or bump) a terrace so the home screen can offer one-tap rejoin. */
function rememberTerrace(key, name, entryRole) {
  if (!key) return;
  const list = loadRecents().filter((e) => e && e.key !== key);
  list.push({ key, name, role: entryRole, lastSeen: Date.now() });
  localStorage.setItem("curva.terraces", JSON.stringify(list.slice(-20)));
}
async function rejoinTerrace(entry) {
  // A host has a single durable store; a joiner reconnects by invite key.
  if (entry.role === "opener") return openTerrace();
  return joinTerrace(entry.key);
}

// ── Terrace lifecycle ─────────────────────────────────────────────────────────
const HEX64 = /^[0-9a-f]{64}$/i;

async function openTerrace() {
  node = await TerraceNode.open({ storagePath: storageBase + "/terrace-host" });
  role = "opener";
  await node.joinSwarm();
  await emitHello();
  rememberTerrace(node.key(), "Your terrace", "opener");
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
  rememberTerrace(key, "Terrace " + key.slice(0, 8), "joiner");
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
    // Opener's micro-round scheduler: open/lock the rounds due at this instant.
    await tickMicroRounds();
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
/** Kickoff → cutoff (ms). Falls back to +90min if a fixture has no valid time. */
function fixtureCutoff(fx) {
  const k = Date.parse(fx.kickoff);
  return Number.isFinite(k) ? k : Date.now() + 90 * 60_000;
}
/** Open any catalogue market for a fixture — the picker and the hunch suggestions
 *  both route through here, so cutoff (from kickoff) and escaping stay in one place. */
async function openMarketFromSpec(fx, spec) {
  const ok = await emit({
    t: "market", marketId: marketId(), kind: spec.kind, params: spec.params, cutoffAt: fixtureCutoff(fx), feeBps: 0,
  });
  if (ok) toast(`Opened: ${spec.params.title}`);
}

// ── Micro-rounds (opener-side scheduler) ─────────────────────────────────────
function startLiveRounds(fx) {
  // "Kickoff" is one round out, so the first window is immediately bettable
  // rather than opening already-closed.
  const matchStart = Date.now() + MICRO_ROUND_MS;
  liveRounds = {
    fixtureId: fx.id,
    matchStart,
    rounds: scheduleMicroRounds(matchStart, { roundMs: MICRO_ROUND_MS, count: MICRO_ROUND_COUNT }),
  };
  toast(`Live rounds on for ${fx.home} vs ${fx.away}`);
  markDirty();
}
function stopLiveRounds() {
  liveRounds = null;
  toast("Live rounds off");
  markDirty();
}
/**
 * Each tick, reconcile the view against what the plan says should exist/lock at
 * `now` — emit only the missing `market`/`lock` messages. Deterministic ids +
 * first-market-wins make re-emits (and two openers racing) idempotent.
 */
async function tickMicroRounds() {
  if (!liveRounds || !node?.writable()) return;
  const plan = planMicroRounds(liveRounds.fixtureId, liveRounds.rounds, Date.now());
  const list = await terraceVm(node.view(), uiState());
  const seen = new Map(list.markets.map((m) => [m.marketId, m]));
  for (const item of plan) {
    const existing = seen.get(item.marketId);
    if (!existing) {
      await emit({ t: "market", marketId: item.marketId, kind: item.spec.kind, params: item.spec.params, cutoffAt: item.cutoffAt, feeBps: 0 });
    }
    if (item.shouldLock && !(existing && existing.locked)) {
      await emit({ t: "lock", marketId: item.marketId });
    }
  }
}

// ── Gaffer LLM (lazy, honest about which path spoke) ─────────────────────────
async function loadGaffer() {
  gafferState = "loading";
  markDirty();
  try {
    gafferLlm = await QvacLlm.load({ modelSrc: GAFFER_MODEL_SRC, onProgress: () => {} });
    gafferState = "ready";
    toast("Gaffer model loaded ⚡");
  } catch {
    gafferLlm = null;
    gafferState = "failed";
    toast("No local model — Gaffer stays on templates");
  }
  markDirty();
}
/** The quip + which path produced it, so the 🎩/🎩⚡ glyph never lies. */
async function gafferSpeak(kv) {
  const pool = await gafferPoolVm(kv, selectedMarket);
  if (!pool) return { text: GAFFER_IDLE, live: false };
  if (gafferLlm) {
    try {
      const out = (await gafferLlm.complete(buildGafferContext(pool))).trim();
      if (out) return { text: out, live: true };
    } catch { /* fall through to the template */ }
  }
  return { text: fallbackQuip(pool), live: false };
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

  // Recent terraces — one-tap rejoin. Durable storage dirs (S11) make this real.
  const recents = recentTerracesVm(loadRecents(), Date.now());
  if (recents.length) {
    const rc = h(`<div class="card stack"><h2>Recent terraces</h2></div>`);
    for (const r of recents) {
      const btn = h(`<button class="ghost" style="text-align:left">${esc(r.name)} <span class="muted">· ${esc(r.role)} · ${esc(r.seenLabel)}</span></button>`);
      busy(btn, () => rejoinTerrace(r));
      rc.appendChild(btn);
    }
    stage.appendChild(rc);
  }
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

  // Open a market — the full catalogue per fixture (collapsed so the whole
  // bracket fits), each option a tappable button carrying the exact factory spec.
  const opener = h(`<div class="card stack"><h2>Open a market</h2></div>`);
  for (const fx of FIXTURES) {
    const live = liveRounds && liveRounds.fixtureId === fx.id;
    const det = h(`<details class="stack"><summary>${teamEmoji(fx.home)} ${esc(fx.home)} vs ${teamEmoji(fx.away)} ${esc(fx.away)} <span class="pill">${esc(fx.round ?? "match")}</span>${live ? ' <span class="pill ok">LIVE</span>' : ""}</summary></details>`);

    const picks = h(`<div class="row wrap" style="margin-top:8px"></div>`);
    for (const opt of marketPickerVm(fx)) {
      const b = h(`<button class="ghost">${esc(opt.label)}</button>`);
      busy(b, () => openMarketFromSpec(fx, opt.spec));
      picks.appendChild(b);
    }
    det.appendChild(picks);

    // Tappable hunch suggestions (F3): the top two, each opening that exact spec.
    for (const s of suggestMarkets(fx.home, fx.away, STATS_BUNDLE).slice(1, 3)) {
      const b = h(`<button class="ghost" style="text-align:left">↳ ${esc(s.reason)}</button>`);
      busy(b, () => openMarketFromSpec(fx, s.spec));
      det.appendChild(b);
    }

    // Opener-only micro-round toggle (F2).
    if (role === "opener") {
      const lr = h(`<button class="ghost">${live ? "■ Stop live rounds" : "▶ Live rounds (10-min goal markets)"}</button>`);
      busy(lr, () => (live ? stopLiveRounds() : startLiveRounds(fx)));
      det.appendChild(lr);
    }
    opener.appendChild(det);
  }
  stage.appendChild(opener);

  // Live markets — open micro-rounds float to the top (grouping in terraceVm).
  const list = h(`<div class="card stack"><h2>Markets (${t.markets.length})</h2></div>`);
  for (const item of t.markets) {
    const closes = item.closesAt !== null ? cdSpanHtml(item.closesAt, "closes in ", item.closesLabel) : esc(item.closesLabel);
    const tag = item.liveRound ? '<span class="pill ok">LIVE</span> ' : "";
    const btn = h(`<button class="ghost" style="text-align:left">${tag}${esc(item.title)} <span class="muted">· ${closes}</span></button>`);
    btn.onclick = () => { selectedMarket = item.marketId; screen = "market"; markDirty(); };
    list.appendChild(btn);
  }
  if (!t.markets.length) list.appendChild(h(`<p class="muted">No markets yet.</p>`));
  stage.appendChild(list);

  // Leaderboard (F4) — realized P&L across every settled market.
  stage.appendChild(h(`<div class="card stack"><h2>Leaderboard</h2>${leaderboardHtml(await leaderboardVm(kv, state))}</div>`));

  // Trust tiers (F5) — Mates active, steward escrow on standby. See TRUST.md.
  const trust = h(`<div class="card stack"><h2>Trust</h2></div>`);
  trust.appendChild(h(escrowHtml(await escrowVm(kv, state))));
  trust.appendChild(h(`<div class="muted">Two tiers, no company custodian — how they work: TRUST.md.</div>`));
  stage.appendChild(trust);

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
  const { text: quip, live } = await gafferSpeak(kv);
  const lines = await chatVm(kv, state, translator);
  const langOpts = LANGS.map((l) => `<option value="${esc(l.code)}"${l.code === lang ? " selected" : ""}>${esc(l.label)}</option>`).join("");
  // Gaffer control: honest about which path spoke (🎩 template vs 🎩⚡ live model).
  const gafferCtl =
    gafferState === "loading"
      ? '<span class="muted">loading model…</span>'
      : gafferState === "ready"
        ? '<span class="pill ok">⚡ model on</span>'
        : `<button class="ghost" id="loadgaffer" style="flex:0 0 auto;padding:4px 10px;font-size:12px">${gafferState === "failed" ? "🎩 retry model" : "🎩 load model"}</button>`;
  const card = h(`<div class="card stack"><h2>Terrace</h2>
    <div class="row"><div class="gaffer" style="flex:1">${live ? "🎩⚡" : "🎩"} ${esc(quip)}</div>${gafferCtl}</div>
    <div class="chat" id="chat"></div>
    <div class="row"><input id="msg" placeholder="say something…" /><select id="lang" style="flex:0 0 auto;width:auto">${langOpts}</select><button id="send">Send</button></div>
  </div>`);
  const loadBtn = card.querySelector("#loadgaffer");
  if (loadBtn) busy(loadBtn, loadGaffer);
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
