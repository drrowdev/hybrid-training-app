import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for the RPC smoke suite. Lives in its own directory
 * so the default `pnpm test` runner (which picks up `src/**\/*.test.ts`)
 * does NOT include these — they only run via `pnpm test:rpc-smoke`
 * and the CI `rpc-smoke` job.
 *
 * Network round trips to Supabase + serial test execution → bump the
 * per-test timeout well above the unit-test default.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../src"),
    },
  },
  test: {
    environment: "node",
    include: ["*.smoke.test.ts"],
    dir: __dirname,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: true,
    // Serial — concurrent runs against a shared e2e Supabase project
    // would race on the synthetic user / cleanup sweeps.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
