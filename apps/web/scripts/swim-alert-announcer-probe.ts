// Server-free proof: pnpm --filter @hta/web exec tsx scripts/swim-alert-announcer-probe.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, type Stats } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Locator } from "@playwright/test";
import { requireManualContext, requirePrivateLocation } from "./swim-acceptance-guards";
import { requireSwimBrowserCache, requireSwimBrowserInstallation } from "./swim-browser-stage";
import { publishAcceptanceSummary } from "./swim-acceptance-reporting";
import { classifyAlertNodes, SWIM_ALERT_CODEBOOK } from "./swim-alert-membership";

type Failure = "context" | "cache" | "installation" | "resolve" | "launch" | "assert" | "timeout" | "cleanup";
type Row = {
  shape: string; titleBearing: boolean;
  oldCount: number; correctedCount: number; positiveCount: number; oldGenuineCount: number;
  oldVisible: boolean; correctedVisible: boolean;
  countsMatch: boolean; categoryMatches: boolean; visibilityMatches: boolean; passed: boolean;
};

async function main() {
  const deadline = Date.now() + 55_000;
  const remaining = () => {
    const budget = deadline - Date.now();
    if (budget <= 0) { timedOut = true; throw new Error("timeout"); }
    return budget;
  };
  let browser: Browser | undefined;
  let closing: Promise<void> | undefined;
  let probeDirectory: string | undefined;
  let original: Stats | undefined;
  let stage: Failure = "context";
  let failure: Failure | null = null;
  let timedOut = false;
  let cleanup = true;
  const rows: Row[] = [];
  const pins = { playwright: false, next: false, core: false };
  const summary = process.env.GITHUB_STEP_SUMMARY!;
  const close = () => {
    if (browser && !closing) closing = browser.close();
    return closing;
  };
  const timer = setTimeout(() => {
    timedOut = true;
    failure ??= "timeout";
    void close()?.catch(() => { cleanup = false; });
  }, 60_000);
  try {
    const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."));
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: Math.min(5000, remaining()),
    }).trim();
    requireManualContext(process.env, head);
    assert.equal(realpathSync(process.env.GITHUB_WORKSPACE!), root);
    assert(typeof summary === "string" && summary.length > 0);
    const web = realpathSync(join(root, "apps/web"));
    const temp = realpathSync(process.env.RUNNER_TEMP!);
    assert(lstatSync(temp).isDirectory());
    requirePrivateLocation(join(temp, "swim-announcer-probe"), temp, root);
    probeDirectory = mkdtempSync(join(temp, "swim-announcer-probe-"));
    original = lstatSync(probeDirectory);
    requirePrivateLocation(probeDirectory, temp, root);
    assert(original.isDirectory() && !original.isSymbolicLink() &&
      original.uid === process.getuid?.() && (original.mode & 0o7777) === 0o700 &&
      realpathSync(probeDirectory) === probeDirectory);
    const home = join(probeDirectory, "home");
    const tmp = join(probeDirectory, "tmp");
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(tmp, { mode: 0o700 });
    stage = "cache";
    const cache = requireSwimBrowserCache(process.env, root, probeDirectory);
    // Both the Node launcher and browser use private profiles/artifacts, without inherited proxies/credentials.
    const env = {
      PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp,
      LANG: "C.UTF-8", NODE_ENV: "test", CI: "true", PLAYWRIGHT_BROWSERS_PATH: cache,
    };
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    stage = "installation";
    requireSwimBrowserInstallation(cache, web);
    stage = "resolve";
    const installed = createRequire(join(web, "package.json"));
    const test = createRequire(installed.resolve("@playwright/test/package.json"));
    const playwright = createRequire(test.resolve("playwright/package.json"));
    pins.playwright = installed("@playwright/test/package.json").version === "1.60.0";
    pins.next = installed("next/package.json").version === "16.2.6";
    pins.core = playwright("playwright-core/package.json").version === "1.60.0";
    assert(Object.values(pins).every(Boolean));
    const { chromium } = playwright("playwright-core") as typeof import("@playwright/test");
    const { expect } = installed("@playwright/test") as typeof import("@playwright/test");
    const executable = chromium.executablePath();
    assert(executable.startsWith(`${cache}${sep}`) && realpathSync(executable) === executable);
    stage = "launch";
    browser = await chromium.launch({ env, timeout: Math.min(10_000, remaining()) });
    stage = "assert";
    const page = await browser.newPage();
    const visible = async (locator: Locator) => {
      const timeout = Math.min(1000, remaining());
      try { await expect(locator).toBeVisible({ timeout }); return true; }
      catch { return false; }
    };
    for (const titleBearing of [false, true]) {
      for (const shape of [
        "alone", "inside-main", "outside-main", "light-lookalike", "other-shadow",
        "other-id-in-next-host", "nested-next-host", "multiple-genuine",
      ] as const) {
        page.setDefaultTimeout(remaining());
        await page.setContent("<main></main>");
        await page.evaluate(({ shape, titleBearing }) => {
          const host = document.createElement("next-route-announcer");
          host.style.cssText = "position:absolute";
          const announcer = document.createElement("div");
          announcer.ariaLive = "assertive";
          announcer.id = "__next-route-announcer__";
          announcer.role = "alert";
          announcer.style.cssText = "position:absolute;border:0;height:1px;margin:-1px;padding:0;width:1px;clip:rect(0 0 0 0);overflow:hidden;white-space:nowrap;word-wrap:normal";
          announcer.textContent = titleBearing ? "Synthetic title" : "";
          const shadow = host.attachShadow({ mode: "open" });
          shadow.appendChild(announcer);
          document.body.appendChild(host);
          const main = document.querySelector("main")!;
          const alert = document.createElement("div");
          alert.role = "alert";
          alert.setAttribute("data-probe-genuine", "");
          alert.textContent = "Synthetic validation";
          if (shape === "inside-main" || shape === "multiple-genuine") main.appendChild(alert.cloneNode(true));
          if (shape === "outside-main" || shape === "multiple-genuine") document.body.appendChild(alert.cloneNode(true));
          if (shape === "light-lookalike") {
            alert.id = "__next-route-announcer__";
            document.body.appendChild(alert);
          }
          if (shape === "other-shadow") {
            const other = document.createElement("synthetic-host");
            document.body.appendChild(other);
            other.attachShadow({ mode: "open" }).appendChild(alert);
          }
          if (shape === "other-id-in-next-host") {
            alert.id = "synthetic-other";
            shadow.appendChild(alert);
          }
          if (shape === "nested-next-host") {
            main.appendChild(host);
            announcer.setAttribute("data-probe-genuine", "");
          }
        }, { shape, titleBearing });
        const old = page.getByRole("alert");
        const oldCount = await old.count();
        const { count: correctedCount, category } = await old.evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK);
        // Conservative positive oracle: reserved-ID lookalikes also fail, never falsely pass.
        const positive = old.and(page.locator(":not(#__next-route-announcer__)"));
        const positiveCount = await positive.count();
        const oldGenuineCount = await old.and(page.locator("[data-probe-genuine]")).count();
        const genuineCount = shape === "alone" ? 0 : shape === "multiple-genuine" ? 2 : 1;
        const expectedPositive = shape === "light-lookalike" || shape === "nested-next-host" ? 0 : genuineCount;
        const oldVisible = await visible(old);
        const correctedVisible = await visible(positive);
        const countsMatch = oldCount === (shape === "nested-next-host" ? 1 : genuineCount + 1) &&
          correctedCount === genuineCount && positiveCount === expectedPositive && oldGenuineCount === genuineCount;
        const categoryMatches = category === (genuineCount === 0 ? "absent" : genuineCount > 1 ? "multiple" : "unclassified");
        const visibilityMatches = oldVisible === (shape === "alone" || shape === "nested-next-host") &&
          correctedVisible === (expectedPositive === 1);
        const bounded = (count: number) => Number.isSafeInteger(count) && count >= 0 && count <= 3 ? count : -1;
        rows.push({
          shape, titleBearing, oldCount: bounded(oldCount), correctedCount: bounded(correctedCount),
          positiveCount: bounded(positiveCount), oldGenuineCount: bounded(oldGenuineCount),
          oldVisible, correctedVisible, countsMatch, categoryMatches, visibilityMatches,
          passed: countsMatch && categoryMatches && visibilityMatches,
        });
        assert(rows.at(-1)!.passed);
      }
    }
    remaining();
    assert.equal(rows.length, 16);
    assert(rows.every((row) => row.passed));
    assert(!timedOut);
  } catch {
    failure ??= timedOut ? "timeout" : stage;
  } finally {
    try {
      await close();
    } catch { cleanup = false; }
    try {
      if (probeDirectory) {
        const current = lstatSync(probeDirectory);
        assert(original && current.isDirectory() && !current.isSymbolicLink());
        assert.equal(realpathSync(probeDirectory), probeDirectory);
        assert.equal(current.uid, process.getuid?.());
        assert.equal(current.mode & 0o7777, 0o700);
        assert.equal(current.dev, original.dev);
        assert.equal(current.ino, original.ino);
        rmSync(probeDirectory, { recursive: true });
      }
    } catch { cleanup = false; }
    clearTimeout(timer);
  }
  if (!cleanup) failure ??= "cleanup";
  const success = failure === null && rows.length === 16 && rows.every((row) => row.passed) && cleanup;
  if (!success) process.exitCode = 1;
  // Synthetic proof only: no app cases, database evidence or release authorization.
  publishAcceptanceSummary(summary, "Swim synthetic announcer proof", {
    protocol: "swim-announcer-synthetic-v1", success, pins, executedRows: rows.length, rows,
    allChecks: rows.length === 16 && rows.every((row) => row.passed), cleanup, failure,
  });
}

// The existing publisher writes marked console evidence before attempting the summary file.
void main().catch(() => { process.exitCode = 1; });
