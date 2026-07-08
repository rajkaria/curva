/**
 * @curva/crowd-oracle — the on-device oracle.
 *
 * Pure and tested: quorum math (./quorum) with the dual ⅔ safety property and
 * dispute-window void, and rule-based score extraction (./extract) that
 * pre-fills a signable attestation. The QVAC ASR adapter (./asr) is the only
 * device-only, lazily-loaded surface. AI assists, humans sign, quorum decides —
 * no model output ever resolves money.
 */
export * from "./quorum.js";
export * from "./extract.js";
export * from "./asr.js";
