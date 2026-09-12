import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

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
        import { SwimImportConnection } from "./src/components/swim/SwimImportConnection";
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
        window.importMode = "success"; window.clipboardMode = "success";
        window.importKey = "swim_" + "a".repeat(43); window.connectCalls = 0; window.disconnectCalls = [];
        window.connection = {
          id: "00000000-0000-4000-8000-000000000003",
          created_at: "2026-09-14T12:00:00Z", revoked_at: null,
        };
        window.connectDashboard = async () => {
          window.connectCalls++;
          if (window.importMode === "delay") await new Promise(resolve => window.resolveConnect = resolve);
          if (window.importMode === "throw") throw new Error("Synthetic unavailable action");
          if (window.importMode === "error") return { ok: false, error: "Could not create the key." };
          return { ok: true, id: window.connection.id, key: window.importKey };
        };
        window.disconnectDashboard = async (id) => {
          window.disconnectCalls.push(id);
          if (window.importMode === "error") return { ok: false, error: "Could not disconnect." };
          return { ok: true };
        };
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
          writeText: async value => {
            if (window.clipboardMode === "error") throw new Error("Synthetic clipboard refusal");
            window.copiedKey = value;
          },
        } });
        window.showConnection = (enabled, active) => root.render(
          <main className={styles.page}><SwimImportConnection key={++key}
            enabled={enabled} connection={active ? window.connection : null} /></main>
        );
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
        build.onResolve({ filter: /^(?:@\/lib\/swim\/(?:actions|import-actions)|next\/navigation)$/ }, (args) => ({ path: args.path, namespace: "test" }));
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents: args.path === "next/navigation"
            ? "export const useRouter = () => ({ push() { throw new Error('Unexpected navigation'); }, refresh() {} });"
            : args.path === "@/lib/swim/import-actions"
              ? "export const connectSwimDashboard = () => window.connectDashboard(); export const disconnectSwimDashboard = id => window.disconnectDashboard(id);"
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

  for (const width of [375, 1280]) {
    stage = `connection-create-copy-disconnect-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      window.showConnection(true, false); window.importMode = "delay";
      window.clipboardMode = "success"; window.connectCalls = 0; window.disconnectCalls = [];
    });
    const create = page.getByRole("button", { name: "Create import key", exact: true });
    await create.click();
    await page.waitForFunction(() => typeof window.resolveConnect === "function");
    stage = `connection-pending-${width}`;
    assert.equal(await create.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.connectCalls), 1);
    await page.evaluate(() => { window.resolveConnect(); window.resolveConnect = undefined; window.importMode = "success"; });
    const key = page.getByRole("textbox", { name: "Import key", exact: true });
    await key.waitFor();
    stage = `connection-key-readonly-${width}`;
    assert.equal(await key.getAttribute("readonly"), "");
    stage = `connection-key-value-${width}`;
    assert.equal(await key.inputValue(), await page.evaluate(() => window.importKey));
    assert.equal(await create.count(), 0);
    stage = `connection-no-overflow-${width}`;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByRole("button", { name: "Copy key", exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    stage = `connection-copied-key-${width}`;
    assert.equal(await page.evaluate(() => window.copiedKey), await key.inputValue());
    const disconnect = page.getByRole("button", { name: "Disconnect dashboard", exact: true });
    await page.evaluate(() => { window.importMode = "error"; });
    await disconnect.click();
    await page.getByRole("alert").waitFor();
    stage = `connection-failed-revocation-retains-key-${width}`;
    assert.equal(await key.inputValue(), await page.evaluate(() => window.importKey));
    stage = `connection-failed-revocation-allows-retry-${width}`;
    await expect(disconnect).toBeEnabled();
    await page.evaluate(() => { window.importMode = "success"; });
    await disconnect.click();
    await create.waitFor();
    stage = `connection-revocation-clears-key-${width}`;
    assert.equal(await key.count(), 0);
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.disconnectCalls), [
      "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000003",
    ]);
    stages.push(stage);
  }

  stage = "connection-key-not-restored-and-disabled-revocation";
  await page.evaluate(() => window.showConnection(false, true));
  await page.getByRole("button", { name: "Disconnect dashboard", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Import key", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Create import key", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Disconnect dashboard", exact: true }).click();
  await page.getByText("No active key", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button").count(), 0);
  stages.push(stage);

  stage = "connection-failure-and-clipboard-recovery";
  await page.evaluate(() => { window.showConnection(true, false); window.importMode = "error"; });
  await page.getByRole("button", { name: "Create import key", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Import key", exact: true }).count(), 0);
  await page.evaluate(() => { window.importMode = "throw"; });
  await page.getByRole("button", { name: "Create import key", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Import key", exact: true }).count(), 0);
  await page.evaluate(() => { window.importMode = "success"; window.clipboardMode = "error"; });
  await page.getByRole("button", { name: "Create import key", exact: true }).click();
  const importKey = page.getByRole("textbox", { name: "Import key", exact: true });
  await importKey.waitFor();
  await page.getByRole("button", { name: "Copy key", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await importKey.focus();
  assert.deepEqual(await importKey.evaluate(input => [input.selectionStart, input.selectionEnd]), [0, 48]);
  assert.equal(await page.getByRole("button", { name: "Copied", exact: true }).count(), 0);
  await page.evaluate(() => { window.clipboardMode = "success"; });
  await page.getByRole("button", { name: "Copy key", exact: true }).click();
  await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
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
