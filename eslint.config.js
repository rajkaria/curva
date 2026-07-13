import tseslint from "typescript-eslint";

export default tseslint.config(
  // vendor/ is third-party code checked in verbatim (see the file headers) —
  // linting it would force edits that break the byte-identity test.
  { ignores: ["spikes/**", "node_modules/**", "**/dist/**", "**/vendor/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_`-prefixed args are the convention for interface-parity no-ops
      // (e.g. MemoryTerraceNode's pairing surface).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
