import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@movement/protocol": resolve(import.meta.dirname, "packages/protocol/src/index.ts"),
      "@movement/layout-core": resolve(import.meta.dirname, "packages/layout-core/src/index.ts"),
      "@movement/rules-engine": resolve(import.meta.dirname, "packages/rules-engine/src/index.ts"),
      "@movement/kwin-adapter": resolve(import.meta.dirname, "apps/kwin-adapter/src/index.ts"),
      "@movement/runtime-simulator": resolve(import.meta.dirname, "apps/runtime-simulator/src/index.ts")
    }
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"]
  }
});
