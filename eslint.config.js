import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["spikes/**", "node_modules/**", "**/dist/**"] },
  ...tseslint.configs.recommended,
);
