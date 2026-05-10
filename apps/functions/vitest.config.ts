import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    conditions: ["node", "require", "default"],
  },
});
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@proofline/policy": path.resolve(__dirname, "../../packages/policy/src/index.ts"),
      "@proofline/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
    },
  },
});
