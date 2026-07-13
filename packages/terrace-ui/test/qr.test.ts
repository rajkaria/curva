// @vitest-environment jsdom
/**
 * S15 U8 — the vendored QR encoder (apps/terrace/vendor/qr.js) must stay
 * byte-identical to the audited npm original, and the SVG it renders must
 * encode the exact key string (proven by comparing the emitted module grid
 * against the npm package's own matrix for the same input).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import upstream from "qrcode-generator";
import vendored from "../../../apps/terrace/vendor/qr.js";

const INVITE_KEY = "9f".repeat(32); // a 64-hex terrace invite key

function svgOf(qr: typeof upstream, text: string): string {
  const code = qr(0, "M");
  code.addData(text);
  code.make();
  return code.createSvgTag(4, 8);
}

describe("vendored QR encoder", () => {
  test("is byte-identical to the npm original below the attribution header", () => {
    // vitest runs from the repo root; both paths live in the workspace tree.
    const vendorPath = resolve("apps/terrace/vendor/qr.js");
    const upstreamPath = resolve("node_modules/qrcode-generator/dist/qrcode.mjs");
    const vendorBody = readFileSync(vendorPath, "utf8").split("*/\n").slice(1).join("*/\n");
    expect(vendorBody).toBe(readFileSync(upstreamPath, "utf8"));
  });

  test("the QR svg encodes the exact invite key (module grid matches upstream)", () => {
    const svg = svgOf(vendored as typeof upstream, INVITE_KEY);
    expect(svg).toBe(svgOf(upstream, INVITE_KEY));
    // and it is sensitive to the payload — one flipped character, different code
    expect(svg).not.toBe(svgOf(upstream, INVITE_KEY.slice(0, -1) + "0"));
  });

  test("the svg parses in a DOM and draws a real module grid", () => {
    document.body.innerHTML = svgOf(vendored as typeof upstream, INVITE_KEY);
    const svg = document.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelector("path")!.getAttribute("d")!.length).toBeGreaterThan(100);
  });
});
