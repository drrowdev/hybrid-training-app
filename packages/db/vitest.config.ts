import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["src/**/*.test.ts", "seeds/**/*.test.ts", "__tests__/**/*.test.ts", "scripts/__tests__/**/*.test.ts"],
  },
});
