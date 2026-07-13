/**
 * Curva browser demo (S15/T6) — the REAL app, one swapped transport.
 *
 * This is not a mockup: it dynamic-imports the actual Pear app shell
 * (apps/terrace/app.js), which renders through the tested @curva/terrace-ui
 * layer and folds messages through the same signed-protocol `applyMessage` as
 * the device build. The ONLY substitution is the runtime injected below:
 * MemoryTerraceNode (in-memory view, no Autobase/Hyperswarm) plus three
 * scripted co-fans so a single browser shows a living terrace. The banner
 * discloses exactly that; the wire path is the Pear app.
 */
import { MemoryTerraceNode } from "@curva/terrace-base";
import { FIXTURES } from "../../../fixtures/wc2026.js";
import { startBots } from "./bots.js";

// Stage the bundled bracket into this visitor's near future so every market
// in the picker opens live (the real fixture dates may already be behind us).
FIXTURES.forEach((fx, i) => {
  fx.kickoff = new Date(Date.now() + (i + 1) * 45 * 60_000).toISOString();
});

globalThis.CURVA_RUNTIME = {
  openNode: (opts) => MemoryTerraceNode.open(opts),
  onNode: (node) => {
    globalThis.__curvaDemoNode = node; // console-inspectable — it's a demo
    startBots(node);
  },
  bannerText: "BROWSER DEMO — in-memory swarm + FakeWallet funds · the real wire path is the Pear app",
  // A 20s dispute window so a judge sees provisional → resolved inside one sitting.
  disputeWindowMs: 20_000,
};

await import("../../../apps/terrace/app.js");
