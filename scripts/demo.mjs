#!/usr/bin/env node
/**
 * The scripted-swarm demo (§13 backup) — runs the entire Curva pipeline headless
 * with no external services, and prints a narrated transcript. Judges run:
 *
 *   npm install && npm run build && npm run demo
 *
 * This exercises the real packages (derive → terrace → trade → kill-host → lock
 * → on-device ASR attest → crowd-quorum resolve → net → self-custodial settle →
 * receipts), so the thesis is verifiable in one command even without Pear, QVAC
 * models, a funded wallet, or a network.
 */
import { runTerraceDemo } from "@curva/e2e";

const result = await runTerraceDemo();
console.log("\n⚽  Curva — the serverless terrace market\n" + "─".repeat(60));
for (const line of result.log) console.log(line);
console.log("─".repeat(60));
console.log(
  `\nconverged: ${result.converged} · resolved: ${result.resolvedOutcome} · ` +
    `conserved: ${result.conserved} · everyone square: ${result.everyoneSquare}\n`,
);
process.exit(result.converged && result.everyoneSquare && result.conserved ? 0 : 1);
