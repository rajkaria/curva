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
  chatLineHtml,
  esc,
  marketHeadHtml,
  outcomeClass,
  outcomeRowHtml,
  renderCard,
} from "../src/html.js";
import type { ChatLineVm, MarketVm, OutcomeVm } from "../src/vm.js";

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
    outcomes: [outcome()],
    resolution: { status: "open" },
    finalizesLabel: null,
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
