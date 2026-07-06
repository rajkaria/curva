import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve @tifo/* to TypeScript source (the `development` export condition)
  // so tests run straight off source with no build step.
  resolve: {
    conditions: ["development"],
  },
  test: {
    include: ["packages/**/test/**/*.test.ts"],
  },
});
