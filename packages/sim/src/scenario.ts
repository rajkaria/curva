/**
 * A deterministic scenario runner over the swarm model — the substrate for the
 * fuzzer. A `Scenario` is a peer count, a market, and a list of actions (bets,
 * locks, attestations, mid-stream writer joins, partition toggles, flushes).
 * `runScenario` executes it and heals the partition at the end, so any invariant
 * that must hold "eventually" can be asserted on the final converged state.
 *
 * There is no `Math.random` here — all randomness comes from the fast-check
 * arbitraries that generate scenarios, keeping every run reproducible and
 * shrinkable.
 */
import { randomIdentity } from "@curva/terrace-base";
import { Swarm } from "./swarm.js";

export type Action =
  | { readonly kind: "bet"; readonly peer: number; readonly outcome: string; readonly amount: bigint; readonly ts: number }
  | { readonly kind: "lock"; readonly peer: number; readonly ts: number }
  | { readonly kind: "attest"; readonly peer: number; readonly outcome: string; readonly ts: number }
  | { readonly kind: "join"; readonly name: string }
  | { readonly kind: "setPartition"; readonly reachable: readonly boolean[] }
  | { readonly kind: "flush" };

export interface Scenario {
  readonly peerCount: number;
  readonly outcomes: readonly string[];
  readonly cutoffAt: number;
  readonly feeBps: number;
  readonly actions: readonly Action[];
}

export const MARKET_ID = "m1";

export async function runScenario(scenario: Scenario): Promise<Swarm> {
  const swarm = new Swarm();
  for (let i = 0; i < scenario.peerCount; i++) swarm.addPeer(randomIdentity(), `p${i}`);

  // Everyone announces identity, then peer 0 opens the market.
  for (const p of swarm.peers) swarm.emit(p, { t: "hello", name: p.name, walletAddr: "0x" + p.name, ts: 1 });
  swarm.flush();
  swarm.emit(swarm.peers[0]!, {
    t: "market",
    marketId: MARKET_ID,
    kind: "match-result",
    params: { title: "FRA v BRA", outcomes: [...scenario.outcomes] },
    cutoffAt: scenario.cutoffAt,
    feeBps: scenario.feeBps,
    ts: 2,
  });
  swarm.flush();

  let reachable: readonly boolean[] = swarm.peers.map(() => true);
  let nonce = 0;

  const inRange = (i: number) => i >= 0 && i < swarm.peers.length;

  for (const action of scenario.actions) {
    switch (action.kind) {
      case "bet":
        if (inRange(action.peer))
          swarm.emit(swarm.peers[action.peer]!, {
            t: "bet",
            marketId: MARKET_ID,
            outcomeKey: action.outcome,
            amount: action.amount,
            nonce: `n${nonce++}`,
            ts: action.ts,
          });
        break;
      case "lock":
        if (inRange(action.peer))
          swarm.emit(swarm.peers[action.peer]!, { t: "lock", marketId: MARKET_ID, ts: action.ts });
        break;
      case "attest":
        if (inRange(action.peer))
          swarm.emit(swarm.peers[action.peer]!, {
            t: "attest",
            marketId: MARKET_ID,
            outcomeKey: action.outcome,
            evidence: { confidence: 1 },
            ts: action.ts,
          });
        break;
      case "join": {
        const p = swarm.addPeer(randomIdentity(), action.name);
        reachable = [...reachable, true];
        swarm.backfillTo(swarm.peers.length - 1); // the joiner replicates the base
        swarm.emit(p, { t: "hello", name: action.name, walletAddr: "0x" + action.name, ts: 3 });
        break;
      }
      case "setPartition":
        reachable = swarm.peers.map((_, i) => action.reachable[i] ?? true);
        break;
      case "flush":
        swarm.flush((i) => reachable[i] ?? true);
        break;
    }
  }

  // Heal: every peer reachable, drain everything still in flight.
  for (let i = 0; i < 3 && swarm.pendingCount() > 0; i++) swarm.flush();
  return swarm;
}
