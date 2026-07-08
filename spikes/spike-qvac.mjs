// S0c — QVAC spike: fully local LLM inference (no cloud, no API key).
// Proves the Curva "terrace pundit" can run on-device: downloads Llama-3.2-1B
// (Q4_0, ~770MB, cached after first run) and generates a market comment.
import { loadModel, LLAMA_3_2_1B_INST_Q4_0, completion, unloadModel } from "@qvac/sdk";

let lastPct = -10;
const modelId = await loadModel({
  modelSrc: LLAMA_3_2_1B_INST_Q4_0,
  onProgress: (p) => {
    const pct = Math.floor((p?.progress ?? 0) * 100);
    if (pct >= lastPct + 10) { lastPct = pct; console.log(`model download/load: ${pct}%`); }
  },
});
console.log("✓ model loaded:", modelId);

const history = [
  {
    role: "system",
    content:
      "You are the Curva terrace pundit. One punchy sentence, football-terrace tone, no hedging.",
  },
  {
    role: "user",
    content:
      "Market: France vs Brazil, World Cup final. Pool: 62% HOME / 38% AWAY. Call it.",
  },
];

const t0 = Date.now();
const result = completion({ modelId, history, stream: true });
let out = "";
for await (const token of result.tokenStream) out += token;
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log("\npundit says:", out.trim());
console.log(`✓ local inference in ${secs}s, ${out.length} chars, zero network calls at inference time`);
await unloadModel({ modelId });
console.log("✅ S0c GREEN — QVAC on-device LLM inference works (Llama-3.2-1B Q4_0)");
process.exit(0);
