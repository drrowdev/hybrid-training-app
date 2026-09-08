// Server-free proof: pnpm --filter @hta/web exec tsx scripts/swim-alert-announcer-probe.ts
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "@playwright/test";

async function main() {
  const installed = createRequire(import.meta.url);
  const versions = {
    playwright: installed("@playwright/test/package.json").version,
    next: installed("next/package.json").version,
  };
  assert.equal(versions.playwright, "1.60.0");
  assert.equal(versions.next, "16.2.6");
  console.log(JSON.stringify(versions));
  const cache = mkdtempSync(join(realpathSync(tmpdir()), "swim-announcer-probe-"));
  const original = lstatSync(cache);
  assert.equal(original.mode & 0o7777, 0o700);
  process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
  // Load only after selecting the uniquely owned cache. Never substitute an executable/channel.
  const { chromium, expect } = installed("@playwright/test") as typeof import("@playwright/test");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "", HOME: cache, TMPDIR: cache,
    LANG: "C.UTF-8", NODE_ENV: "test", CI: "true", PLAYWRIGHT_BROWSERS_PATH: cache,
  };
  const deadline = Date.now() + 55_000;
  const remaining = () => {
    const budget = deadline - Date.now();
    assert(budget > 0);
    return budget;
  };
  let browser: Browser | undefined;
  let success = false;
  let timedOut = false;
  const setup = { missingBundle: false, installed: false, launched: false, installTimedOut: false, downloadFailed: false };
  const timer = setTimeout(() => {
    timedOut = true;
    void browser?.close().catch(() => {});
  }, 60_000);
  try {
    try {
      browser = await chromium.launch({ env, timeout: Math.min(10_000, remaining()) });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Executable doesn't exist")) throw error;
      setup.missingBundle = true;
      // Only a missing bundled browser permits installation, through the already pinned CLI.
      await new Promise<void>((resolve, reject) => {
        execFile(process.execPath, [installed.resolve("@playwright/test/cli"), "install", "chromium"], {
          env, timeout: Math.min(40_000, remaining()), maxBuffer: 1024 * 1024,
        }, (error, stdout, stderr) => {
          if (error) {
            setup.installTimedOut = error.killed === true;
            setup.downloadFailed = /Failed to download|Download failed/.test(`${stdout}\n${stderr}`);
            reject(error);
          } else {
            setup.installed = true;
            resolve();
          }
        });
      });
      browser = await chromium.launch({ env, timeout: Math.min(10_000, remaining()) });
    }
    setup.launched = true;
    const page = await browser.newPage();
    assert.equal(page.url(), "about:blank");
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
          if (shape === "nested-next-host") main.appendChild(host);
        }, { shape, titleBearing });
        const old = page.getByRole("alert");
        const oldCount = await old.count();
        const correctedCount = await old.evaluateAll((nodes) => nodes.filter((node) => {
          const root = node.getRootNode();
          return !(root instanceof ShadowRoot && root.host.localName === "next-route-announcer" &&
            root.host.parentNode === document.body && node.id === "__next-route-announcer__");
        }).length);
        // Conservative positive oracle: reserved-ID lookalikes also fail, never falsely pass.
        const positive = old.and(page.locator(":not(#__next-route-announcer__)"));
        const positiveCount = await positive.count();
        const genuineCount = shape === "alone" ? 0 : shape === "multiple-genuine" ? 2 : 1;
        assert.equal(oldCount, shape === "nested-next-host" ? 1 : genuineCount + 1);
        assert.equal(correctedCount, genuineCount);
        assert.equal(positiveCount,
          shape === "light-lookalike" || shape === "nested-next-host" ? 0 : genuineCount);
        let oldVisible: boolean | undefined;
        let correctedVisible: boolean | undefined;
        if (shape === "alone" || shape === "inside-main") {
          remaining();
          try {
            await expect(old).toBeVisible();
            oldVisible = true;
          } catch { oldVisible = false; }
          assert.equal(oldVisible, shape === "alone");
          if (shape === "inside-main") {
            remaining();
            await expect(positive).toBeVisible();
            correctedVisible = true;
          }
        }
        console.log(JSON.stringify({
          shape, titleBearing, oldCount, correctedCount, positiveCount, oldVisible, correctedVisible,
        }));
      }
    }
    assert(!timedOut);
    success = true;
  } finally {
    try {
      await browser?.close();
    } finally {
      clearTimeout(timer);
      console.log(JSON.stringify({ ...setup, timedOut }));
    }
    if (success) {
      const current = lstatSync(cache);
      assert(current.isDirectory() && !current.isSymbolicLink());
      assert.equal(realpathSync(cache), cache);
      assert.equal(current.uid, process.getuid?.());
      assert.equal(current.mode & 0o7777, 0o700);
      assert.equal(current.dev, original.dev);
      assert.equal(current.ino, original.ino);
      rmSync(cache, { recursive: true });
    }
  }
}

void main().then(
  () => console.log(JSON.stringify({ success: true })),
  () => {
    // Preserve partial synthetic evidence, never print exception payloads or private cache paths.
    console.log(JSON.stringify({ success: false }));
    process.exitCode = 1;
  },
);
