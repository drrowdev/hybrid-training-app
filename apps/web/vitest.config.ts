import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
    // A handful of action tests dynamically `import("../actions")`, a large
    // module. Under parallel worker-thread contention that first transform
    // can exceed the 5s default, and — since a timed-out test's in-flight
    // promise keeps running rather than being cancelled — its delayed
    // resolution can leak into a later test's shared mock state. Raising the
    // ceiling gives busy/CI runners headroom without slowing fast tests.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
