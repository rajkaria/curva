import { describe, expect, test } from "vitest";
import { runTerraceDemo } from "../src/index.js";

describe("full pipeline end-to-end (the scripted-swarm demo)", () => {
  test("terrace → trade → kill-host → lock → ASR attest → resolve → net → settle", async () => {
    const r = await runTerraceDemo();

    // Every peer materialized the identical view.
    expect(r.converged).toBe(true);

    // Pools reflect the valid bets; the fenced late 500-USDt AWAY bet is absent.
    expect(r.poolTotals["HOME"]).toBe((140n * 1_000_000n).toString());
    expect(r.poolTotals["AWAY"]).toBe((60n * 1_000_000n).toString());
    expect(r.lockedBeforeLateBet).toBe(true);

    // The crowd oracle resolved HOME and it survived the dispute window.
    expect(r.resolvedOutcome).toBe("HOME");

    // Settlement nets Bo's loss to the two HOME winners, and every line is paid.
    expect(r.transfers.length).toBeGreaterThan(0);
    expect(r.everyoneSquare).toBe(true);
    expect(r.receiptsCovered).toBe(r.transfers.length);

    // Money is conserved to the micro.
    expect(r.conserved).toBe(true);
  });
});
