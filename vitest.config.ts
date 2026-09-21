import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@tessera/protocol": resolve(__dirname, "packages/protocol/src/index.ts"),
      "@tessera/layout-core": resolve(__dirname, "packages/layout-core/src/index.ts"),
      "@tessera/rules-engine": resolve(__dirname, "packages/rules-engine/src/index.ts"),
      "@tessera/kwin-adapter": resolve(__dirname, "apps/kwin-adapter/src/index.ts"),
      "@tessera/runtime-simulator": resolve(__dirname, "apps/runtime-simulator/src/index.ts")
    }
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"]
  }
});
