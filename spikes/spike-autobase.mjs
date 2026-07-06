// S0a — Autobase spike: 2 writers, deterministic Hyperbee view, convergence.
// Proves the parimutuel-as-CRDT mechanics: bets fold into identical pools on both peers.
import Corestore from "corestore";
import Autobase from "autobase";
import Hyperbee from "hyperbee";
import b4a from "b4a";
import { rmSync } from "fs";

rmSync("./.store", { recursive: true, force: true });

function open(store) {
  return new Hyperbee(store.get("view"), {
    keyEncoding: "utf-8",
    valueEncoding: "json",
    extension: false,
  });
}

async function apply(nodes, view, host) {
  for (const node of nodes) {
    const v = node.value;
    if (v.type === "add-writer") {
      await host.addWriter(b4a.from(v.key, "hex"), { indexer: true });
      continue;
    }
    if (v.type === "bet") {
      const k = `pool!${v.marketId}!${v.outcome}`;
      const cur = (await view.get(k))?.value ?? 0;
      await view.put(k, cur + v.amount);
      await view.put(`bet!${v.marketId}!${v.nonce}`, v);
    }
  }
}

const opts = { open, apply, valueEncoding: "json" };

const storeA = new Corestore("./.store/a");
const A = new Autobase(storeA, null, opts);
await A.ready();

const storeB = new Corestore("./.store/b");
const B = new Autobase(storeB, A.key, opts);
await B.ready();

// replicate the two corestores directly (in-process "swarm")
const s1 = storeA.replicate(true);
const s2 = storeB.replicate(false);
s1.pipe(s2).pipe(s1);
s1.on("error", () => {});
s2.on("error", () => {});

// A (the terrace opener) adds B as a writer
await A.append({ type: "add-writer", key: b4a.toString(B.local.key, "hex") });
await A.update();

// wait until B is writable
for (let i = 0; i < 100 && !B.writable; i++) {
  await B.update();
  await new Promise((r) => setTimeout(r, 100));
}
if (!B.writable) throw new Error("B never became writable");
console.log("✓ writer added via log message; B is writable");

// both peers bet — different writers, no coordination
await A.append({ type: "bet", marketId: "fra-bra", outcome: "HOME", amount: 10_000_000, nonce: "a1" });
await B.append({ type: "bet", marketId: "fra-bra", outcome: "AWAY", amount: 5_000_000, nonce: "b1" });
await B.append({ type: "bet", marketId: "fra-bra", outcome: "HOME", amount: 2_000_000, nonce: "b2" });

// let it settle
for (let i = 0; i < 50; i++) {
  await A.update();
  await B.update();
  await new Promise((r) => setTimeout(r, 100));
  const a = (await A.view.get("pool!fra-bra!HOME"))?.value;
  const b = (await B.view.get("pool!fra-bra!HOME"))?.value;
  if (a === 12_000_000 && b === 12_000_000) break;
}

async function snapshot(base) {
  const out = {};
  for await (const { key, value } of base.view.createReadStream({ gt: "pool!", lt: "pool!~" }))
    out[key] = value;
  return out;
}

const [pa, pb] = [await snapshot(A), await snapshot(B)];
console.log("peer A pools:", pa);
console.log("peer B pools:", pb);

const converged = JSON.stringify(pa) === JSON.stringify(pb);
const correct = pa["pool!fra-bra!HOME"] === 12_000_000 && pa["pool!fra-bra!AWAY"] === 5_000_000;
console.log(converged && correct ? "✅ S0a GREEN — deterministic convergence across 2 writers" : "❌ S0a RED");
process.exit(converged && correct ? 0 : 1);
