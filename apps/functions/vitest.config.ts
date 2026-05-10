import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    conditions: ["node", "require", "default"],
    alias: {
      "@proofline/policy": path.resolve(
        __dirname,
        "../../packages/policy/src/index.ts"
      ),
      "@proofline/types": path.resolve(
        __dirname,
        "../../packages/types/src/index.ts"
      ),
      "@proofline/verification": path.resolve(
        __dirname,
        "../../packages/verification/src/index.ts"
      ),
      "@proofline/anchoring": path.resolve(
        __dirname,
        "../../packages/anchoring/src/index.ts"
      ),
      "@proofline/canonical": path.resolve(
        __dirname,
        "../../packages/canonical/src/index.ts"
      ),
    },
  },
});