import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import {
  BROWSER_LIMITS, requireBrowserEnvironment, requirePrivateBrowserPaths, SWIM_BROWSER_CASES,
} from "./scripts/swim-browser-acceptance";

const paths = requireBrowserEnvironment(process.env);
requirePrivateBrowserPaths(paths, __dirname);

export default defineConfig({
  testDir: "./e2e",
  testMatch: [...new Set(SWIM_BROWSER_CASES.map(({ file }) => resolve(__dirname, file)))],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: BROWSER_LIMITS.testTimeout,
  globalTimeout: BROWSER_LIMITS.globalTimeout,
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["json", { outputFile: paths.reportPath }]],
  outputDir: paths.outputDir,
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{
    name: "mobile-chromium",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 375, height: 812 },
      isMobile: false,
      hasTouch: true,
    },
  }],
});
