/**
 * @curva/terrace-base — the P2P market protocol.
 *
 * Pure over a {@link KV} view: the signed message codec, the deterministic
 * `apply` fold, the cutoff fence, and the derived-state readers all run headless
 * with an in-memory view (tests, sim, fuzzer). The real Autobase + Hyperbee
 * wiring lives in the Pear app and calls {@link applyMessage} inside Autobase's
 * apply callback over the same code path.
 */
export * from "./identity.js";
export * from "./protocol.js";
export * from "./view.js";
export * from "./apply.js";
export * from "./pairing.js";
export { TerraceNode, type TerraceOptions } from "./autobase-runtime.js";
export { MemoryTerraceNode, type MemoryTerraceOptions } from "./memory-runtime.js";
