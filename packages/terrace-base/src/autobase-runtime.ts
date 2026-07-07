/**
 * Production runtime: the same `applyMessage` fold, wired to a real Autobase +
 * Hyperbee + Hyperswarm. This is what the Pear app runs; the pure sim
 * (@tifo/sim) is the *tested* convergence proof, and the S0a spike already
 * demonstrated real two-writer Autobase convergence on the wire.
 *
 * The heavy Pears SDKs are loaded through `dynImport` (a `string`-argument
 * `import()`, which TypeScript types as `Promise<any>`) so this package
 * typechecks and its pure fold stays testable without pulling corestore/
 * autobase/hyperswarm into CI. The Pear app declares them as real deps.
 *
 * Pairing (mates trust model): the invite is the Autobase key. A joiner opens
 * its own Autobase bootstrapped from that key, connects on the Hyperswarm topic,
 * and sends its local writer key; the opener appends an `add-writer` plumbing
 * node authorizing it. "Anyone with the invite can write" is exactly the
 * private-pool semantics we want — the invite is the capability.
 */
import { applyMessage } from "./apply.js";
import type { KV } from "./view.js";
import type { Msg } from "./protocol.js";

// A single, contained escape hatch for the untyped Pears SDK surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const dynImport = (m: string): Promise<Any> => import(m);

/** Plumbing node (unsigned) that authorizes a new Autobase writer. */
interface AddWriterNode {
  readonly type: "add-writer";
  readonly key: string;
}
type Node = Msg | AddWriterNode;

/** Wrap a Hyperbee instance as the KV the fold writes through. */
class HyperbeeKV implements KV {
  constructor(private readonly bee: Any) {}

  async get(key: string): Promise<unknown | undefined> {
    const node = await this.bee.get(key);
    return node ? node.value : undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    await this.bee.put(key, value);
  }
  async del(key: string): Promise<void> {
    await this.bee.del(key);
  }
  async *list(range?: { gte?: string; lt?: string }): AsyncIterable<{ key: string; value: unknown }> {
    const opts: Record<string, string> = {};
    if (range?.gte !== undefined) opts["gte"] = range.gte;
    if (range?.lt !== undefined) opts["lt"] = range.lt;
    for await (const { key, value } of this.bee.createReadStream(opts)) {
      yield { key: typeof key === "string" ? key : key.toString(), value };
    }
  }
}

export interface TerraceOptions {
  readonly storagePath: string;
  /** Existing terrace key (hex) to join; omit to create a fresh terrace. */
  readonly inviteKey?: string;
}

export class TerraceNode {
  private store: Any;
  private base: Any;
  private swarm: Any;
  /** Live Hyperswarm connections — the P2P presence the UI shows as a peer count. */
  private readonly connections = new Set<Any>();

  private constructor(private readonly opts: TerraceOptions) {}

  static async open(opts: TerraceOptions): Promise<TerraceNode> {
    const node = new TerraceNode(opts);
    await node.boot();
    return node;
  }

  private async boot(): Promise<void> {
    const Corestore = (await dynImport("corestore")).default;
    const Autobase = (await dynImport("autobase")).default;
    const Hyperbee = (await dynImport("hyperbee")).default;
    const b4a = (await dynImport("b4a")).default;

    this.store = new Corestore(this.opts.storagePath);
    const bootstrap = this.opts.inviteKey ? b4a.from(this.opts.inviteKey, "hex") : null;

    this.base = new Autobase(this.store, bootstrap, {
      valueEncoding: "json",
      open: (store: Any) =>
        new Hyperbee(store.get("view"), {
          keyEncoding: "utf-8",
          valueEncoding: "json",
          extension: false,
        }),
      apply: async (nodes: Any[], view: Any, host: Any) => {
        const kv = new HyperbeeKV(view);
        for (const node of nodes) {
          const v = node.value as Node;
          if (v && (v as AddWriterNode).type === "add-writer") {
            await host.addWriter(b4a.from((v as AddWriterNode).key, "hex"), { indexer: true });
            continue;
          }
          // The linearized index lives in the view itself (meta!seq), so it
          // survives restarts and rolls back atomically on Autobase truncate.
          await applyMessage(kv, v as Msg);
        }
      },
    });
    await this.base.ready();
  }

  /** The invite key others use to join this terrace. */
  key(): string {
    return this.base.key.toString("hex");
  }

  view(): KV {
    return new HyperbeeKV(this.base.view);
  }

  /**
   * The view's version (Hyperbee's core length). Strictly increases whenever
   * apply has written anything, so a render loop can compare versions and do
   * ZERO work — no Hyperbee scans, no DOM — while nothing has changed.
   */
  version(): number {
    return Number(this.base.view?.version ?? 0);
  }

  writable(): boolean {
    return this.base.writable;
  }

  /** Append a signed protocol message to this peer's own input. */
  async append(msg: Msg): Promise<void> {
    await this.base.append(msg);
  }

  /** Opener-only: authorize a joiner's writer key (from the pairing handshake). */
  async addWriter(writerKeyHex: string): Promise<void> {
    await this.base.append({ type: "add-writer", key: writerKeyHex } satisfies AddWriterNode);
  }

  /** The local writer key a joiner sends to the opener to be authorized. */
  localWriterKey(): string {
    return this.base.local.key.toString("hex");
  }

  /** Join the Hyperswarm topic for this terrace and replicate to peers. */
  async joinSwarm(): Promise<void> {
    const Hyperswarm = (await dynImport("hyperswarm")).default;
    this.swarm = new Hyperswarm();
    this.swarm.on("connection", (conn: Any) => {
      this.store.replicate(conn);
      // Track presence: the "kill the host, the market lives" demo is only
      // legible if the peer count is visible and updates as peers come and go.
      this.connections.add(conn);
      conn.once("close", () => this.connections.delete(conn));
    });
    const topic = this.base.discoveryKey;
    this.swarm.join(topic, { server: true, client: true });
    await this.swarm.flush();
  }

  /** Number of live peer connections on this terrace's swarm. */
  peerCount(): number {
    return this.connections.size;
  }

  async update(): Promise<void> {
    await this.base.update();
  }

  async close(): Promise<void> {
    if (this.swarm) await this.swarm.destroy();
    await this.base.close();
    await this.store.close();
  }
}
