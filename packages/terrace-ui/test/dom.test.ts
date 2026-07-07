// @vitest-environment jsdom
/// <reference lib="dom" />
/**
 * DOM-layer regression suite (jsdom) — S11's escaping discipline, now enforced
 * by construction: VMs carry raw peer strings, and the ONLY way markup is
 * built from them is the html-string helpers here. These tests instantiate the
 * helpers' output as real DOM and prove hostile payloads stay inert text.
 */
import { describe, expect, test } from "vitest";
import {
  barClass,
  cdSpanHtml,
  chatLineHtml,
  esc,
  headerWidgetsHtml,
  marketHeadHtml,
  outcomeClass,
  outcomeRowHtml,
  pnlHtml,
  positionHtml,
  previewLineHtml,
  renderCard,
  tallyHtml,
} from "../src/html.js";
import type { ChatLineVm, HeaderVm, MarketVm, OutcomeVm, PnlVm, PositionVm, TallyVm } from "../src/vm.js";

const HOSTILE = '<img src=x onerror=alert(1)>"><script>boom()</script>';

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

function outcome(over: Partial<OutcomeVm> = {}): OutcomeVm {
  return {
    key: "HOME",
    gross: 12_000_000n,
    grossLabel: "12.00",
    probability: 0.7,
    pct: 71,
    oddsLabel: "×1.42",
    ...over,
  };
}

function mkt(over: Partial<MarketVm> = {}): MarketVm {
  return {
    marketId: "m1",
    title: "FRA v BRA",
    kind: "match-result",
    meta: {},
    feeBps: 0,
    locked: false,
    statusLabel: "OPEN",
    closesLabel: "closes in 1:30:00",
    closesAt: 5_400_000,
    outcomes: [outcome()],
    resolution: { status: "open" },
    finalizesLabel: null,
    finalizesAt: null,
    receipts: 0,
    canBet: true,
    canLock: true,
    canSettle: false,
    ...over,
  };
}

describe("esc", () => {
  test("escapes both text and attribute contexts", () => {
    expect(esc(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("outcome/bar class allowlist", () => {
  test("peer strings never become class names", () => {
    expect(outcomeClass(HOSTILE)).toBe("");
    expect(barClass(HOSTILE)).toBe("");
    expect(outcomeClass("HOME")).toBe("HOME");
    expect(barClass("AWAY")).toBe("bAWAY");
  });
});

describe("hostile title stays inert", () => {
  test("marketHeadHtml never parses a hostile title as markup", () => {
    const host = mount(marketHeadHtml(mkt({ title: HOSTILE })));
    expect(host.querySelector("img, script")).toBeNull();
    expect(host.querySelector("h2")!.textContent).toBe(HOSTILE);
  });

  test("renderCard(vm) — the full market card — is inert end to end", () => {
    const host = mount(
      renderCard(mkt({ title: HOSTILE, outcomes: [outcome({ key: HOSTILE, oddsLabel: HOSTILE })] })),
    );
    expect(host.querySelector("img, script")).toBeNull();
    expect(host.textContent).toContain(HOSTILE);
  });
});

describe("outcomeRowHtml", () => {
  test("hostile outcome keys stay text and get no class", () => {
    const host = mount(outcomeRowHtml(outcome({ key: HOSTILE })));
    expect(host.querySelector("img, script")).toBeNull();
    expect(host.querySelector(".bar > span")!.className).toBe("");
  });

  test("bar width comes from the numeric pct only", () => {
    const host = mount(outcomeRowHtml(outcome({ pct: 71 })));
    const bar = host.querySelector(".bar > span") as HTMLElement;
    expect(bar.style.width).toBe("71%");
    expect(bar.className).toBe("bHOME");
  });
});

describe("chatLineHtml", () => {
  test("hostile chat text and names stay inert", () => {
    const line: ChatLineVm = { author: "02ab", name: HOSTILE, text: HOSTILE, lang: "en", ts: 1 };
    const host = mount(chatLineHtml(line));
    expect(host.querySelector("img, script")).toBeNull();
    expect(host.textContent).toContain(HOSTILE);
  });
});

describe("S13 surfaces stay inert under hostile peer strings", () => {
  test("headerWidgetsHtml — a hostile display name never becomes markup", () => {
    const vm: HeaderVm = {
      name: HOSTILE,
      addrShort: "0xabc…",
      wallet: { balance: 1000n, label: "1000.00 USDt" },
      peer: { count: 0, ok: false, label: "no peers" },
      demoMode: true,
    };
    const host = mount(headerWidgetsHtml(vm));
    expect(host.querySelector("img, script")).toBeNull();
    expect(host.textContent).toContain(HOSTILE);
    expect(host.querySelector(".pill.warn")).not.toBeNull(); // amber at 0 peers
  });

  test("positionHtml — hostile outcome keys stay text and get no class", () => {
    const vm: PositionVm = {
      byOutcome: [{ key: HOSTILE, stake: 10_000_000n, stakeLabel: "10.00" }],
      total: 10_000_000n,
      totalLabel: "10.00",
      hasPosition: true,
    };
    const host = mount(positionHtml(vm));
    expect(host.querySelector("img, script")).toBeNull();
    expect(host.textContent).toContain(HOSTILE);
    expect(host.querySelector("span")!.className).toBe(""); // not in the allowlist
  });

  test("previewLineHtml — hostile outcome key is inert, number shown raw", () => {
    const host = mount(previewLineHtml(HOSTILE, "23.40"));
    expect(host.querySelector("img, script")).toBeNull();
    expect(host.textContent).toContain("23.40");
    expect(host.querySelector("span")!.className).toBe("");
  });

  test("pnlHtml — renders the label, swings class on the sign", () => {
    const up: PnlVm = { staked: 10n, payout: 23n, net: 13n, won: true, label: "You're up 13.40 ✓" };
    expect(mount(pnlHtml(up)).querySelector(".square")).not.toBeNull();
    const down: PnlVm = { staked: 10n, payout: 5n, net: -5n, won: false, label: "You're down 5.00" };
    expect(mount(pnlHtml(down)).querySelector(".warn")).not.toBeNull();
  });

  test("cdSpanHtml — carries the target/prefix as data for the DOM ticker", () => {
    const host = mount(cdSpanHtml(5_400_000, "closes in ", "closes in 1:30:00"));
    const span = host.querySelector(".cd") as HTMLElement;
    expect(span.getAttribute("data-cd-to")).toBe("5400000");
    expect(span.getAttribute("data-cd-prefix")).toBe("closes in ");
    expect(span.textContent).toBe("closes in 1:30:00");
  });

  test("tallyHtml — hostile outcome keys and voter names stay inert", () => {
    const vm: TallyVm = {
      totalWriters: 1,
      minWriters: 3,
      thresholdLabel: "needs ≥3 writers, ⅔ of writers & ⅔ of stake",
      outcomes: [
        { key: HOSTILE, writers: 1, stake: 1n, stakePct: 100, writersOk: false, stakeOk: true, meetsQuorum: false, label: "1/1 writers · 100% stake" },
      ],
      voters: [{ writer: "02ab", name: HOSTILE, outcomeKey: HOSTILE }],
      quorumOutcome: null,
      hasAttestations: true,
    };
    const host = mount(tallyHtml(vm));
    expect(host.querySelector("img, script")).toBeNull();
    expect(host.textContent).toContain(HOSTILE);
  });
});
