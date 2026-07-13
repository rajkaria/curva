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
import { TerraceNode, signMessage, readReceipts, buildPairRequest } from "@curva/terrace-base";
import qrcode from "./vendor/qr.js";
import {
  deriveVault, randomVault, isValidMnemonic,
  computeDeltas, minTransfers, settlementManifest, settleMyDebts, FakeWallet,
  sealVault, openVault, isSealedVault, RpcVerifier, squareStatus, squareSummary,
} from "@curva/wdk-vault";
import { scheduleMicroRounds } from "@curva/market-catalogue";
import { prefillAttestation, FakeAsr } from "@curva/crowd-oracle";
import { computePayouts } from "@curva/market-kernel";
import { FakeTranslator, suggestMarkets, buildGafferContext, fallbackQuip, QvacLlm } from "@curva/qvac-surfaces";
import {
  terraceVm, marketVm, chatVm, gafferPoolVm, settlementVm,
  positionVm, previewPayout, pnlVm, tallyVm, headerVm,
  marketPickerVm, buildCustomMarket, planMicroRounds, leaderboardVm, escrowVm, recentTerracesVm,
  LANGS, GAFFER_IDLE, countdown, usdt,
  esc, outcomeClass, marketHeadHtml, outcomeRowHtml, chatLineHtml, cdSpanHtml,
  demoBannerHtml, headerWidgetsHtml, positionHtml, previewLineHtml, pnlHtml, tallyHtml,
  leaderboardHtml, escrowHtml,
} from "@curva/terrace-ui";
import { FIXTURES, STATS_BUNDLE, DEMO_TRANSCRIPT } from "../../fixtures/wc2026.js";

const DISPUTE_WINDOW_MS = globalThis.CURVA_RUNTIME?.disputeWindowMs ?? 10 * 60_000;
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

// Real mode (S16): set both fields (and fund the wallet) to enable on-chain
// receipt verification (✓ claimed → ✓✓ verified). Empty = demo mode, disclosed
// in-UI by the banner; the WDK wallet swap is the same config point.
const REAL_MODE = { rpcUrl: "", usdtAddress: "" };

// Runtime injection (S15/T6): the zero-install browser demo runs this exact
// file over a MemoryTerraceNode by setting globalThis.CURVA_RUNTIME before
// import — same UI, same VMs, same fold; only the transport is swapped (and
// the banner says so). In the Pear app this is undefined and everything below
// is the real Autobase/Hyperswarm path.
const RUNTIME = globalThis.CURVA_RUNTIME ?? {};
const openNode = RUNTIME.openNode ?? ((opts) => TerraceNode.open(opts));

// ── Vault (persisted seed; optionally sealed at rest — S16) ──────────────────
/** Unlock gate: a sealed seed never derives until the passphrase opens it. */
function unlockVault(sealed) {
  return new Promise((resolve) => {
    const card = h(`<div class="card stack">
      <h2>Unlock your vault</h2>
      <p class="muted">Your seed is sealed at rest. Enter your passphrase.</p>
      <div class="row"><input id="unlock-pw" type="password" placeholder="passphrase" /><button id="unlock">Unlock</button></div>
    </div>`);
    const input = card.querySelector("#unlock-pw");
    const tryOpen = () => {
      try {
        resolve(openVault(sealed, input.value));
      } catch {
        input.value = "";
        input.placeholder = "wrong passphrase — try again";
      }
    };
    card.querySelector("#unlock").onclick = tryOpen;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryOpen(); });
    app.replaceChildren(card);
    input.focus();
  });
}
async function loadVault() {
  const stored = localStorage.getItem("curva.mnemonic");
  if (stored && isSealedVault(stored)) {
    const mnemonic = await unlockVault(stored);
    return { mnemonic, vault: deriveVault(mnemonic) };
  }
  let mnemonic = stored;
  if (!mnemonic || !isValidMnemonic(mnemonic)) {
    mnemonic = randomVault().mnemonic;
    localStorage.setItem("curva.mnemonic", mnemonic);
  }
  return { mnemonic, vault: deriveVault(mnemonic) };
}
const { mnemonic: seedMnemonic, vault } = await loadVault();

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
// Pairing requests awaiting a human tap (S15) — validated + deduped in terrace-base.
let pendingPairs = [];
const wallet = new FakeWallet(vault.wallet.address, 1000n * 1_000_000n); // demo-funded
// Demo mode is *derived*, not asserted: the banner shows iff the fakes are live.
const demoMode = wallet instanceof FakeWallet;
// On-chain receipt verification (S16): real mode only — a fake txid can never
// earn a ✓✓, and verification failures degrade to "claimed", never "verified".
const receiptVerifier =
  !demoMode && REAL_MODE.rpcUrl && REAL_MODE.usdtAddress ? new RpcVerifier(REAL_MODE) : null;
// txid → verdict. Confirmed/mismatch are final; pending re-queries next render.
const verdictCache = new Map();

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

/** Surface validated pairing requests for one-tap approval (S15). */
function watchPairRequests() {
  node.onPairRequest((req) => {
    pendingPairs.push(req);
    toast(`Pairing request from ${req.name}`);
    markDirty();
  });
}

async function openTerrace() {
  node = await openNode({ storagePath: storageBase + "/terrace-host" });
  role = "opener";
  RUNTIME.onNode?.(node);
  watchPairRequests();
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
  node = await openNode({ storagePath: storageBase + "/terrace-" + key.slice(0, 16), inviteKey: key });
  role = "joiner";
  RUNTIME.onNode?.(node);
  watchPairRequests(); // an authorized joiner can approve the next mate
  await node.joinSwarm();
  // Announce ourselves for one-tap approval — no more hand-copied writer keys.
  node.requestPairing(buildPairRequest(vault.identity, node.localWriterKey(), displayName, Date.now()));
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
  banner.innerHTML = demoMode ? demoBannerHtml(RUNTIME.bannerText) : "";
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

/** Open a custom market on anything — not tied to a fixture. `title`/`outcomesText`
 *  come straight from the form; `buildCustomMarket` validates against the fold's
 *  caps, so we only sign specs `apply` will keep. Closes `mins` minutes out. */
async function openCustomMarket(title, outcomesText, mins) {
  const built = buildCustomMarket({ title, outcomesText });
  if (!built.ok) { toast(built.error); return; }
  const minutes = Number(mins) > 0 ? Number(mins) : 60;
  const ok = await emit({
    t: "market", marketId: marketId(), kind: built.spec.kind, params: built.spec.params,
    cutoffAt: Date.now() + minutes * 60_000, feeBps: 0,
  });
  if (ok) toast(`Opened: ${built.spec.params.title}`);
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

/** The canonical wallet-level transfer manifest for a resolved market — settle
 *  pays from it and receipt verification checks claims against it, so the two
 *  can never disagree about who owes whom. */
function buildTransfers(s, outcomeKey, feeBps) {
  const manifest = computePayouts({ bets: s.bets, resolution: { kind: "outcome", outcomeKey }, feeBps });
  return settlementManifest(
    minTransfers(computeDeltas(manifest, s.stakes)).map((t) => ({ from: s.walletOf(t.from), to: s.walletOf(t.to), amount: t.amount })),
  );
}

async function settle(vm) {
  const s = await settlementVm(node.view(), vm.marketId);
  const transfers = buildTransfers(s, vm.resolution.outcomeKey, vm.feeBps);
  const receipts = await settleMyDebts(transfers, wallet); // only my own debts
  for (const r of receipts) await emit({ t: "receipt", marketId: vm.marketId, manifestLine: r.line, txid: r.txid });
  await updateHeader(); // balance moved
  if (receipts.length) { toast(`Paid ${receipts.length} transfer(s)`); celebrate("🎉"); }
  else toast("Nothing to pay");
}

/** ✓✓ receipts (S16, real mode): verify each claimed txid against the chain. */
async function receiptsLine(kv, vm, s) {
  if (!receiptVerifier || vm.resolution.status !== "resolved") {
    return `Receipts: ${vm.receipts} line(s) settled ✓`;
  }
  const transfers = buildTransfers(s, vm.resolution.outcomeKey, vm.feeBps);
  const rows = await readReceipts(kv, vm.marketId);
  const verdicts = new Map();
  for (const r of rows) {
    if (!r.txid) continue;
    let v = verdictCache.get(r.txid);
    if (v === undefined || v === "pending") {
      const t = transfers[r.line];
      // A receipt for a line outside the manifest claims a transfer that
      // doesn't exist — that is a mismatch, not a verification gap.
      v = t ? await receiptVerifier.verify({ txid: r.txid, from: t.from, to: t.to, amount: t.amount }) : "mismatch";
      verdictCache.set(r.txid, v);
    }
    verdicts.set(r.txid, v);
  }
  return `Receipts: ${squareSummary(squareStatus(transfers.length, rows, verdicts))}`;
}

async function sendChat(text) {
  if (!text.trim()) return;
  await emit({ t: "chat", text, lang });
}

// ── Rendering: VMs → DOM ─────────────────────────────────────────────────────
function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// ── Pairing UX helpers (S15) ─────────────────────────────────────────────────
/** A 📋 button that copies `value` and confirms with a ✓ (never re-renders). */
function copyBtn(value, label) {
  const b = h(`<button class="ghost" style="flex:0 0 auto;padding:4px 10px;font-size:12px">📋 ${esc(label)}</button>`);
  busy(b, async () => {
    await navigator.clipboard.writeText(value);
    const was = b.textContent;
    b.textContent = "✓ copied";
    setTimeout(() => { b.textContent = was; }, 1200);
  });
  return b;
}
/** QR svg for OUR OWN invite key (validated hex — never peer data). */
function qrSvg(text) {
  if (!HEX64.test(text)) return "";
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag(4, 8);
}

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

  // Vault at rest (S16): opt-in passphrase sealing. The demo default stays
  // plaintext and says so; sealing swaps the localStorage seed for a versioned
  // scrypt+XChaCha20-Poly1305 blob and gates the next launch on the passphrase.
  const sealed = isSealedVault(localStorage.getItem("curva.mnemonic") ?? "");
  const vaultCard = h(`<div class="card stack">
    <h2>Vault</h2>
    <div class="row"><span class="pill${sealed ? " ok" : ""}">${sealed ? "🔒 seed sealed at rest" : "demo seed — unencrypted"}</span></div>
    ${sealed
      ? `<div class="row"><input id="seal-cur" type="password" placeholder="current passphrase" /><input id="seal-new" type="password" placeholder="new passphrase" /><button class="ghost" id="reseal">Change</button></div>`
      : `<div class="row"><input id="seal-pw" type="password" placeholder="passphrase" /><button class="ghost" id="seal">Seal vault</button></div>`}
    <p class="muted">Sealing encrypts your seed with your passphrase (scrypt + XChaCha20-Poly1305); you'll unlock at launch. There is no recovery without it.</p>
  </div>`);
  if (sealed) {
    busy(vaultCard.querySelector("#reseal"), async () => {
      const cur = vaultCard.querySelector("#seal-cur").value;
      const next = vaultCard.querySelector("#seal-new").value;
      openVault(localStorage.getItem("curva.mnemonic") ?? "", cur); // throws on wrong passphrase
      localStorage.setItem("curva.mnemonic", sealVault(seedMnemonic, next));
      toast("Passphrase changed 🔒");
    });
  } else {
    busy(vaultCard.querySelector("#seal"), async () => {
      const pw = vaultCard.querySelector("#seal-pw").value;
      localStorage.setItem("curva.mnemonic", sealVault(seedMnemonic, pw));
      toast("Vault sealed 🔒");
      markDirty();
    });
  }
  stage.appendChild(vaultCard);

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
    <div><div class="muted">Invite key (share to let mates join)</div><div class="mono">${esc(t.invite)}</div><div class="row" id="invite-actions" style="margin-top:6px"></div></div>
    <details><summary class="muted">Show invite QR</summary><div id="invite-qr" style="margin-top:8px;background:#fff;display:inline-block;border-radius:8px;line-height:0">${qrSvg(t.invite)}</div></details>
    <div><div class="muted">Your writer key (mates get one-tap approval; paste stays as fallback)</div><div class="mono">${esc(t.writerKey)}</div><div class="row" id="writer-actions" style="margin-top:6px"></div></div>
    <div class="row"><input id="authk" placeholder="authorize a mate's writer key" /><button class="ghost" id="auth">Authorize</button></div>
  </div>`);
  busy(invite.querySelector("#setname"), () => setName(invite.querySelector("#displayname").value));
  busy(invite.querySelector("#auth"), () => authorizeWriter(invite.querySelector("#authk").value));
  invite.querySelector("#invite-actions").appendChild(copyBtn(t.invite, "copy invite"));
  invite.querySelector("#writer-actions").appendChild(copyBtn(t.writerKey, "copy writer key"));
  stage.appendChild(invite);

  // Pairing requests (S15): signature-verified in terrace-base; one tap calls
  // the same addWriter as the paste flow. Names are peer data — esc() as ever.
  if (pendingPairs.length && t.writable) {
    const pair = h(`<div class="card stack"><h2>Pairing requests</h2></div>`);
    for (const req of pendingPairs) {
      const row = h(`<div class="row"><span style="flex:1">Approve <b>${esc(req.name)}</b> <span class="muted mono">fan-${esc(req.author.slice(2, 6))}</span>?</span></div>`);
      const ok = h(`<button>Approve</button>`);
      busy(ok, async () => {
        await node.addWriter(req.writerKey);
        pendingPairs = pendingPairs.filter((p) => p !== req);
        toast(`Authorized ${req.name} ✓`);
        markDirty();
      });
      const no = h(`<button class="ghost">Ignore</button>`);
      no.onclick = () => { pendingPairs = pendingPairs.filter((p) => p !== req); markDirty(); };
      row.appendChild(ok);
      row.appendChild(no);
      pair.appendChild(row);
    }
    stage.appendChild(pair);
  }

  // Create your own market — the protocol isn't football-only. Any peer opens a
  // market on anything (a question + its outcomes) and shares this terrace with
  // their crowd; the same crowd oracle settles it by attestation.
  const custom = h(`<div class="card stack">
    <h2>Create your own market</h2>
    <p class="muted">Not just football — ask anything. Your crowd settles it by attestation.</p>
    <input id="custom-title" placeholder="Question, e.g. Will we ship by Friday?" />
    <input id="custom-outcomes" value="YES, NO" placeholder="outcomes, comma-separated" />
    <div class="row tight"><input id="custom-mins" type="number" min="1" step="1" value="60" style="width:6em" /><span class="muted">min to close</span></div>
    <button class="ghost" id="custom-create">Open market</button>
  </div>`);
  busy(custom.querySelector("#custom-create"), () => openCustomMarket(
    custom.querySelector("#custom-title").value,
    custom.querySelector("#custom-outcomes").value,
    custom.querySelector("#custom-mins").value,
  ));
  stage.appendChild(custom);

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
  if (vm.receipts) resCard.appendChild(h(`<div class="square">${esc(await receiptsLine(kv, vm, s))}</div>`));
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
