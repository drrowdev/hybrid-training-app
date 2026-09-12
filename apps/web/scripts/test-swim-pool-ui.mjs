import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Reuse Vitest's locked compiler; no app server, environment files or HTTP backend.
const require = createRequire(import.meta.url);
const viteRequire = createRequire(createRequire(require.resolve("vitest/package.json")).resolve("vite"));
const { build } = viteRequire("esbuild");
const root = fileURLToPath(new URL("..", import.meta.url));
const stages = [];
let browser, stage = "bundle", status = "failed", code = "unexpected";
try {
  const output = await build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { PoolEditor } from "./src/components/swim/PoolEditor";
        import { SetupForm } from "./src/components/swim/SetupForm";
        import styles from "./src/components/swim/Swim.module.css";
        import "./src/app/globals.css";
        const root = createRoot(document.getElementById("root"));
        const long = { numerator: 50, denominator: 1, unit: "m" };
        const short = { numerator: 25, denominator: 1, unit: "m" };
        window.requests = []; window.applied = []; window.mode = "success";
        window.previewPool = async (input) => {
          window.requests.push(input);
          if (window.mode === "delay") await new Promise(resolve => window.resolvePreview = resolve);
          if (window.mode === "error") return { error: "This repeat does not fit the selected pool.", errorCode: "validation" };
          return { ok: true, preview: { ...input, id: "synthetic-preview", courseLabel: "25 m",
            changes: [{ id: "workout", date: "2026-09-14", beforeCourse: "50 m", afterCourse: "25 m",
              distance: "400 m", beforeLengths: 8, afterLengths: 16 }] } };
        };
        let key = 0;
        window.showSetup = () => root.render(<main className={styles.page}><SetupForm key={++key} today="2026-09-14" /></main>);
        window.showEditor = () => root.render(<main className={styles.page}><section className={styles.section}>
          <h2>Swimming</h2><PoolEditor key={++key} busy={false} context={{
            planId: "00000000-0000-4000-8000-000000000001", revision: 1, defaultCourse: long,
            workout: { id: "00000000-0000-4000-8000-000000000002", revision: 1, course: long },
          }} onApply={preview => window.applied.push(preview)} />
        </section></main>);
      `,
      loader: "tsx", resolveDir: root,
    },
    bundle: true, write: false, outdir: "in-memory-swim-ui", format: "iife", platform: "browser",
    jsx: "automatic", logLevel: "warning",
    conditions: ["style"],
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": `${root}src` },
    plugins: [{
      name: "synthetic-actions",
      setup(build) {
        build.onResolve({ filter: /^(?:@\/lib\/swim\/actions|next\/navigation)$/ }, (args) => ({ path: args.path, namespace: "test" }));
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents: args.path === "next/navigation"
            ? "export const useRouter = () => ({ push() { throw new Error('Unexpected navigation'); }, refresh() {} });"
            : "export const previewSwimPoolEdit = input => window.previewPool(input); export const createSwimPlan = () => { throw new Error('Unexpected save'); }; export const previewSwimPlan = createSwimPlan;",
          loader: "js",
        }));
      },
    }],
  });
  const script = output.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = output.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  assert.ok(script && css);
  stages.push(stage);
  stage = "browser";
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  page.setDefaultTimeout(10_000);
  const failures = [];
  page.on("pageerror", () => failures.push("page-error"));
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });

  stage = "new-programme-default";
  await page.evaluate(() => window.showSetup());
  await page.getByRole("combobox", { name: "Pool length", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Pool length", exact: true }).inputValue(), "50m");
  stages.push(stage);

  for (const width of [375, 1280]) {
    stage = `review-and-confirm-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { window.showEditor(); window.mode = "success"; window.applied = []; });
    await page.getByText("Change pool", { exact: true }).click();
    const select = page.getByRole("combobox", { name: "Pool length", exact: true });
    await select.selectOption("25m");
    await page.getByRole("button", { name: "Preview pool change", exact: true }).click();
    const save = page.getByRole("button", { name: "Save pool", exact: true });
    await save.waitFor();
    stage = `preview-read-only-${width}`;
    assert.equal(await page.evaluate(() => window.applied.length), 0);
    stage = `distance-visible-${width}`;
    assert.match(await page.locator("li").first().innerText(), /\b400 m(?:\s|$)/);
    stage = `lengths-visible-${width}`;
    assert.ok(await page.getByText("8 → 16 lengths", { exact: true }).isVisible());
    stage = `no-overflow-${width}`;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    stage = `explicit-save-${width}`;
    await save.click();
    assert.equal(await page.evaluate(() => window.applied.length), 1);
    stage = `preview-invalidation-${width}`;
    await select.selectOption("50m");
    assert.equal(await save.count(), 0);
    stages.push(stage);
  }
  stage = "obsolete-preview-and-error";
  await page.evaluate(() => { window.showEditor(); window.mode = "delay"; });
  await page.getByText("Change pool", { exact: true }).click();
  await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("25m");
  await page.getByRole("button", { name: "Preview pool change", exact: true }).click();
  await page.waitForFunction(() => typeof window.resolvePreview === "function");
  await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("50m");
  await page.evaluate(() => window.resolvePreview());
  await page.getByRole("button", { name: "Preview pool change", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Save pool", exact: true }).count(), 0);
  await page.evaluate(() => { window.mode = "error"; });
  await page.getByRole("button", { name: "Preview pool change", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "Save pool", exact: true }).count(), 0);
  assert.deepEqual(failures, []);
  stages.push(stage);
  status = "passed";
} catch (error) {
  code = error?.code === "ERR_ASSERTION" ? "assertion"
    : /Executable doesn't exist/.test(error?.message ?? "") ? "missing-browser"
      : error?.name === "TimeoutError" ? "timeout" : "unexpected";
} finally {
  if (browser) {
    try { await browser.close(); }
    catch { if (status !== "failed") { stage = "browser-cleanup"; code = "cleanup"; } status = "failed"; }
  }
}
console.log(JSON.stringify({ scope: "swim-pool-ui-synthetic", status, stages, ...(status === "failed" ? { stage, code } : {}) }));
if (status !== "passed" && process.env.GITHUB_ACTIONS === "true") console.log(`::error title=Swimming pool controls::${stage} [${code}]`);
if (status !== "passed") process.exitCode = 1;
