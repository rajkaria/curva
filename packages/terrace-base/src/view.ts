/**
 * The view is a sorted key→JSON store — an abstraction over Hyperbee.
 *
 * The fold ({@link ./apply}) writes only through this interface, so the exact
 * same fold runs over an in-memory map (tests, sim, fuzzer) and over a real
 * Hyperbee inside an Autobase `apply` callback (the Pear app). `list` yields
 * entries in ascending key order, matching Hyperbee's `createReadStream`, which
 * is what makes every derived read deterministic across peers.
 */
export interface KV {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  /** Ascending-key entries in the half-open range [gte, lt). */
  list(range?: { gte?: string; lt?: string }): AsyncIterable<{ key: string; value: unknown }>;
}

/** Range covering every key with the given prefix. */
export function prefix(p: string): { gte: string; lt: string } {
  return { gte: p, lt: p + "￿" };
}

export class MemoryKV implements KV {
  private readonly map = new Map<string, unknown>();

  async get(key: string): Promise<unknown | undefined> {
    return this.map.get(key);
  }

  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async *list(range?: { gte?: string; lt?: string }): AsyncIterable<{ key: string; value: unknown }> {
    const gte = range?.gte ?? "";
    const lt = range?.lt ?? "￿￿";
    const keys = [...this.map.keys()].filter((k) => k >= gte && k < lt).sort();
    for (const key of keys) yield { key, value: this.map.get(key) };
  }

  /** Every entry, sorted — used for convergence fingerprints. */
  async dump(): Promise<Array<{ key: string; value: unknown }>> {
    const out: Array<{ key: string; value: unknown }> = [];
    for await (const entry of this.list()) out.push(entry);
    return out;
  }
}
