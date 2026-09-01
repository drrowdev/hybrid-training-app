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
    // Server-action suites import the module under test from inside the test
    // body, so the first one absorbs the whole graph's load cost. That is
    // resolution time, not test time, and it exceeds the 5s default whenever
    // the workspace runs its packages in parallel.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
