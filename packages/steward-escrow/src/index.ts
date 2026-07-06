/**
 * @tifo/steward-escrow — Tier-2 escrow: no company custodian, three mates ARE
 * the custodian. Deterministic 2-of-3 election, per-peer on-chain deposit
 * verification, and threshold co-signing of payouts. Pure protocol over a chain
 * adapter; the real chain reader and multisig broadcast are runtime wiring.
 */
export * from "./election.js";
export * from "./deposit.js";
export * from "./multisig.js";
