/**
 * @curva/qvac-surfaces — the on-device QVAC surfaces.
 *
 * Pure prompt/routing/ranking logic (Gaffer context, translate routing, hunch
 * suggestions) tested with fakes; the real QVAC LLM/translation is lazy-loaded
 * and device-only. None of this touches the money path — banter, translation,
 * and suggestions only.
 */
export * from "./llm.js";
export * from "./gaffer.js";
export * from "./translate.js";
export * from "./suggest.js";
