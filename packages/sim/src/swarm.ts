/**
 * A faithful, deterministic model of an Autobase swarm — without the network.
 *
 * Each peer holds a set of *envelopes* (a signed message + its transport
 * metadata). An envelope's identity is `${author}:${localSeq}` — exactly a
 * Hypercore writer key + block index — so redelivery dedups. Every peer
 * linearizes its envelope set the same way: sort by (lamport, author, localSeq).
 * Lamport clocks make that order causally faithful — a message created after a
 * peer has seen a `lock` gets a higher lamport and therefore linearizes after
 * it, which is exactly what the cutoff fence needs.
 *
 * Because linearization is a pure function of the envelope *set*, any two peers
 * holding the same set materialize a byte-identical view — that is the whole
 * convergence proof, and it holds under any gossip order, partition, or heal.
 * The real Autobase (proven in the S0a spike) provides this same guarantee on
 * the wire; the sim lets us fuzz the protocol headless in CI.
 */
import {
  foldMessages,
  signMessage,
  viewDigest,
  type Msg,
  type UnsignedMsg,
  type DistributiveOmit,
  type Identity,
  type MemoryKV,
} from "@tifo/terrace-base";

/** What a caller supplies to append: a message minus the fields the peer fills in. */
export type AppendMsg = DistributiveOmit<Msg, "sig" | "author" | "v"> & { v?: 1 };

export interface Envelope {
  readonly id: string; // `${author}:${localSeq}` — the Hypercore (key, seq) identity
  readonly msg: Msg;
  readonly author: string;
  readonly localSeq: number;
  readonly lamport: number;
}

/** Deterministic total order over an envelope set — every peer computes the same. */
export function linearize(envelopes: Iterable<Envelope>): Msg[] {
  return [...envelopes]
    .sort((a, b) =>
      a.lamport !== b.lamport
        ? a.lamport - b.lamport
        : a.author !== b.author
          ? a.author < b.author
            ? -1
            : 1
          : a.localSeq - b.localSeq,
    )
    .map((e) => e.msg);
}

export class SimPeer {
  readonly id: Identity;
  readonly name: string;
  private clock = 0;
  private localSeq = 0;
  private readonly envelopes = new Map<string, Envelope>();

  constructor(id: Identity, name: string) {
    this.id = id;
    this.name = name;
  }

  /** Sign and append a message to this peer's own log; returns its envelope. */
  append(unsigned: AppendMsg): Envelope {
    const msg = signMessage(
      { ...unsigned, v: 1, author: this.id.idKey } as UnsignedMsg,
      this.id.privKey,
    );
    this.clock += 1;
    const env: Envelope = {
      id: `${this.id.idKey}:${this.localSeq}`,
      msg,
      author: this.id.idKey,
      localSeq: this.localSeq,
      lamport: this.clock,
    };
    this.localSeq += 1;
    this.envelopes.set(env.id, env);
    return env;
  }

  /** Receive an envelope from another peer (idempotent; advances the Lamport clock). */
  receive(env: Envelope): void {
    if (this.envelopes.has(env.id)) return;
    this.envelopes.set(env.id, env);
    this.clock = Math.max(this.clock, env.lamport) + 1;
  }

  has(id: string): boolean {
    return this.envelopes.has(id);
  }

  all(): Envelope[] {
    return [...this.envelopes.values()];
  }

  async view(): Promise<MemoryKV> {
    return foldMessages(linearize(this.envelopes.values()));
  }

  async digest(): Promise<string> {
    return viewDigest(await this.view());
  }
}

export class Swarm {
  readonly peers: SimPeer[] = [];
  /** Undelivered (env, targetPeerIndex) pairs — the "in flight" set. */
  private readonly inflight: Array<{ env: Envelope; to: number }> = [];

  addPeer(id: Identity, name: string): SimPeer {
    const peer = new SimPeer(id, name);
    this.peers.push(peer);
    return peer;
  }

  /** Queue an envelope for delivery to every other peer (models gossip). */
  broadcast(from: SimPeer, env: Envelope): void {
    this.peers.forEach((p, i) => {
      if (p !== from) this.inflight.push({ env, to: i });
    });
  }

  /** Append on a peer and immediately queue gossip to all others. */
  emit(peer: SimPeer, unsigned: AppendMsg): Envelope {
    const env = peer.append(unsigned);
    this.broadcast(peer, env);
    return env;
  }

  /** Deliver all in-flight messages whose target index passes `partition`. */
  flush(partition: (peerIndex: number) => boolean = () => true): void {
    const held: Array<{ env: Envelope; to: number }> = [];
    for (const item of this.inflight) {
      if (partition(item.to)) this.peers[item.to]!.receive(item.env);
      else held.push(item);
    }
    this.inflight.length = 0;
    this.inflight.push(...held);
  }

  pendingCount(): number {
    return this.inflight.length;
  }

  /** True iff every peer has materialized the identical view. */
  async converged(): Promise<boolean> {
    if (this.peers.length === 0) return true;
    const digests = await Promise.all(this.peers.map((p) => p.digest()));
    return digests.every((d) => d === digests[0]);
  }

  async digests(): Promise<string[]> {
    return Promise.all(this.peers.map((p) => p.digest()));
  }
}
