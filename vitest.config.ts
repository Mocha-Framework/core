import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    name: "core",
    include: ["**/__tests__/**/*.vitest.test.ts"],
    exclude: ["**/node_modules/**", "**/core.test.ts"],
  },
  resolve: {
    alias: {
      "@mocha/core": resolve(__dirname, "src/index.ts"),
      "@mocha/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
