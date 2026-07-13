/**
 * MemoryTerraceNode (S15 T6) — the {@link TerraceNode} surface with no
 * Autobase, no Hyperswarm, no disk: appends run the SAME `applyMessage` fold
 * over a {@link MemoryKV}. This is the zero-install browser demo's runtime —
 * the real protocol, view readers, and render layer execute unchanged in any
 * browser; only the transport is faked (and the demo says so in its banner).
 *
 * Single-linearizer by construction: every append (from the viewer or a
 * scripted co-fan bot) applies immediately in arrival order, which is one
 * valid linearization of the log — the fold's own validation still drops
 * anything hostile, exactly as on-device. Peer presence is scriptable so the
 * demo's header shows a living terrace.
 */
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { applyMessage } from "./apply.js";
import type { PairRequest } from "./pairing.js";
import type { Msg } from "./protocol.js";
import { MemoryKV, type KV } from "./view.js";

export interface MemoryTerraceOptions {
  /** Terrace key to report from {@link MemoryTerraceNode.key}; random if omitted. */
  readonly inviteKey?: string;
}

export class MemoryTerraceNode {
  private readonly kv = new MemoryKV();
  private readonly inviteKey: string;
  private readonly writerKey: string;
  private peers = 0;

  private constructor(opts: MemoryTerraceOptions) {
    this.inviteKey = opts.inviteKey ?? bytesToHex(randomBytes(32));
    this.writerKey = bytesToHex(randomBytes(32));
  }

  /** Same shape as TerraceNode.open — async for drop-in symmetry. */
  static async open(opts: MemoryTerraceOptions = {}): Promise<MemoryTerraceNode> {
    return new MemoryTerraceNode(opts);
  }

  key(): string {
    return this.inviteKey;
  }

  view(): KV {
    return this.kv;
  }

  /** MemoryKV's mutation counter — moves on every applied put, and on the
   *  `meta!seq` bump even for dropped messages, mirroring the device. */
  version(): number {
    return this.kv.version();
  }

  writable(): boolean {
    return true; // everyone writes in the in-memory demo — no pairing to wait on
  }

  async append(msg: Msg): Promise<void> {
    await applyMessage(this.kv, msg);
  }

  /** No authorization step exists in memory — accepted silently. */
  async addWriter(_writerKeyHex: string): Promise<void> {}

  localWriterKey(): string {
    return this.writerKey;
  }

  async joinSwarm(): Promise<void> {}

  /** Pairing surface parity: everyone already writes, so both are no-ops. */
  onPairRequest(_cb: (req: PairRequest) => void): void {}
  requestPairing(_req: PairRequest): void {}

  /** Scripted presence: the demo bots "connect" so the header shows a crowd. */
  peerCount(): number {
    return this.peers;
  }
  connectPeer(): void {
    this.peers++;
  }
  disconnectPeer(): void {
    this.peers = Math.max(0, this.peers - 1);
  }

  async update(): Promise<void> {}

  async close(): Promise<void> {}
}
