/**
 * @curva/terrace-ui — the app's tested render layer.
 *
 * View-models turn the replicated view + local uiState into plain data
 * (vm.ts); formatters make the display strings exact (format.ts); the html
 * helpers are the single place peer strings become markup, escaping enforced
 * by construction (html.ts). The Pear app is a thin DOM shell over these.
 */
export * from "./format.js";
export * from "./vm.js";
export * from "./html.js";
