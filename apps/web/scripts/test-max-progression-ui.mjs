import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(createRequire(require.resolve("vitest/package.json")).resolve("vite"));
const { build } = viteRequire("esbuild");
const root = fileURLToPath(new URL("..", import.meta.url));
const output = await build({
  stdin: { contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { AppShell } from "./src/components/shell/AppShell";
    import { TodayDashboard } from "./src/components/today/TodayDashboard";
    import { TmSuggestionBanner } from "./src/components/today/TmSuggestionBanner";
    import { ScheduledMaxProgressionToggle } from "./src/components/settings/ScheduledMaxProgressionToggle";
    import { TmSection } from "./src/components/training-maxes/TmSection";
    import { PageHeader } from "./src/components/ui/PageHeader";
    import "./src/app/globals.css";
    const root = createRoot(document.getElementById("root"));
    const names = ["Bench Press", "Back Squat", "Deadlift"];
    const old = [80, 120, 150], proposed = [81.5, 122.5, 152.5];
    const rows = names.map((movementName, index) => ({
      id: String(index), movementName, currentTmKg: old[index], suggestedTmKg: proposed[index],
      formula: null, setWeightKg: null, setReps: null, sessionPerformedAt: null,
    }));
    const workout = { id: "strength", date: "2026-09-28", title: "Squat and press", program: "Strength",
      programId: "program", kind: "strength", week: 4, weeks: 6, done: false, href: "#workout",
      minutes: 55, action: "Start workout", state: "not_started", items: [
        { movementId: "squat", movementName: "Back Squat", kind: "main", sets: 3, reps: 5, percentTm: 80 },
        { movementId: "bench", movementName: "Bench Press", kind: "main", sets: 3, reps: 5, percentTm: 80 },
      ] };
    const secondWorkout = { ...workout, id: "hinge", date: "2026-10-01", title: "Deadlift and press",
      items: [{ movementId: "deadlift", movementName: "Deadlift", kind: "main", sets: 3, reps: 5, percentTm: 80 }] };
    let key = 0;
    window.reset = () => { window.maxes = [...old]; window.calls = []; window.mode = "success"; };
    window.reset();
    const decide = async (form, accept) => {
      const ids = form.getAll("suggestionId");
      window.calls.push({ ids, accept });
      if (window.mode === "delay") await new Promise(resolve => window.finish = resolve);
      if (window.mode === "error") return { ok: false, error: "This max has changed. Reload Today." };
      if (accept) ids.forEach(id => window.maxes[Number(id)] = proposed[Number(id)]);
      return { ok: true };
    };
    const shell = children => <AppShell displayName="Martin" signOutAction={async () => { throw new Error("Unexpected sign out"); }}>{children}</AppShell>;
    window.showToday = () => {
      window.route = "/app";
      root.render(shell(<TodayDashboard today="2026-09-28" workouts={[workout]} weekWorkouts={[workout, secondWorkout]}
        hasProgram multiplePrograms={false} quickWorkout={null} promptPlacement="after-workouts"
        prompt={<TmSuggestionBanner key={++key} oneRm suggestions={rows}
          acceptAction={form => decide(form, true)} dismissAction={form => decide(form, false)} />} />));
    };
    window.showSettings = () => {
      window.route = "/app/settings/training-maxes"; window.setting = true;
      root.render(shell(<div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 20 }}>
        <PageHeader title="1-rep maxes" back={{ href: "/app/settings", label: "Settings" }} />
        <ScheduledMaxProgressionToggle key={++key} initial action={async form => {
          if (window.mode === "error") return { ok: false, error: "Couldn't save this setting. Try again." };
          window.setting = form.get("enabled") === "true"; return { ok: true };
        }} />
        <TmSection units="metric" requiredGroups={[]} otherRows={rows.map((row, i) => ({
          id: row.id, movementId: row.id, movementName: row.movementName, movementSlug: row.id,
          oneRmKg: window.maxes[i], tmPercentOverride: null, effectivePercent: 100, tmKg: window.maxes[i],
          updatedAt: "2026-09-07", systemLoad: false, source: "entered", derivedFromSessionId: null,
          derivedFromSetLogId: null, derivedFormula: null, derivedAt: null,
        }))} otherRowSourceSets={{}} pickerGroups={[]} bodyweightKg={80}
          upsertAction={async () => { throw new Error("Unexpected manual edit"); }}
          deleteAction={async () => { throw new Error("Unexpected delete"); }}
          lockAction={async () => { throw new Error("Unexpected lock"); }} />
      </div>));
    };
  `, loader: "tsx", resolveDir: root },
  bundle: true, write: false, outdir: "in-memory-max-ui", format: "iife", platform: "browser",
  jsx: "automatic", logLevel: "warning", conditions: ["style"],
  define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": path.join(root, "src") },
  plugins: [{
    name: "unexercised-boundaries",
    setup(builder) {
      builder.onResolve({ filter: /^(next\/(?:link|navigation)|@\/components\/cmd-k\/CommandPaletteProvider|@\/components\/plan\/ThisWeekRail|\.\/WorkoutOptions)$/ },
        args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
        contents: args.path === "next/link"
          ? 'import {createElement} from "react"; export default ({href,...props}) => createElement("a",{...props,href});'
          : args.path === "next/navigation"
          ? 'export const usePathname=()=>window.route; export const useRouter=()=>({refresh(){},push(){throw new Error("Unexpected navigation");}});'
          : args.path.includes("CommandPaletteProvider")
          ? 'export const useCommandPalette=()=>({open(){throw new Error("Unexpected search");}});'
          : args.path.includes("ThisWeekRail")
          ? 'export const ThisWeekRail=()=>{throw new Error("Unexpected week drawer");};'
          : 'export const WorkoutOptions=()=>{throw new Error("Unexpected options");};',
        loader: "js", resolveDir: root,
      }));
    },
  }],
});
const script = output.outputFiles.find(file => file.path.endsWith(".js"))?.text;
const css = output.outputFiles.find(file => file.path.endsWith(".css"))?.text;
assert.ok(script && css);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().url() === "https://max-ui.test/"
    ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' })
    : route.abort());
  await page.goto("https://max-ui.test/");
  await page.addStyleTag({ content: css });
  for (const [family, file, variable, weight] of [
    ["Geist", "Geist", "sans", "100 900"], ["JetBrains Mono", "JetBrainsMono", "mono", "100 800"],
    ["Oswald", "Oswald", "display", "400 700"], ["Saira Stencil One", "SairaStencilOne", "stencil", "400"],
  ]) {
    const data = await readFile(path.join(root, "src", "app", "fonts", `${file}.woff2`));
    await page.addStyleTag({ content: `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2");font-weight:${weight}}:root{--font-${variable}:"${family}"}` });
  }
  await page.addScriptTag({ content: script });
  const directory = process.env.UI_REVIEW_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  async function screenshot(name) {
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow");
    if (directory) await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
  }
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { window.reset(); window.showToday(); });
    await expect(page.getByRole("heading", { name: "Increase 1RMs", exact: true })).toBeVisible();
    const workouts = await page.getByTestId("today-workouts").boundingBox();
    const prompt = await page.getByTestId("today-prompt").boundingBox();
    assert.ok(workouts && prompt && prompt.y >= workouts.y + workouts.height);
    await expect(page.getByTestId("today-week-strip").getByText("Deadlift and press", { exact: true })).toBeVisible();
    const liftRow = page.getByTestId("tm-suggestion-0");
    const accept = await liftRow.getByRole("button", { name: "Accept Bench Press" }).boundingBox();
    const decline = await liftRow.getByRole("button", { name: "Decline Bench Press" }).boundingBox();
    const lift = await liftRow.getByRole("heading").boundingBox();
    assert.ok(accept && decline && lift && accept.height >= 44 && decline.height >= 44);
    assert.ok(accept.y < lift.y + lift.height && decline.y < lift.y + lift.height, "Buttons share the lift row");
    assert.equal(await page.getByTestId("tm-suggestion-banner").locator("button.primary").count(), 1);
    await screenshot(`today-proposals-${width}`);
    await page.getByRole("button", { name: "Accept Bench Press", exact: true }).click();
    await expect(page.getByRole("button", { name: "Accept Bench Press", exact: true })).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.maxes), [81.5, 120, 150]);
    assert.deepEqual(await page.evaluate(() => window.calls), [{ ids: ["0"], accept: true }]);
    await screenshot(`today-accepted-one-${width}`);
    await page.getByRole("button", { name: "Decline Back Squat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Decline Back Squat", exact: true })).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.maxes), [81.5, 120, 150]);
    await page.getByRole("button", { name: "Accept all", exact: true }).click();
    await expect(page.getByTestId("tm-suggestion-banner")).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.maxes), [81.5, 120, 152.5]);
    assert.deepEqual(await page.evaluate(() => window.calls), [
      { ids: ["0"], accept: true }, { ids: ["1"], accept: false }, { ids: ["2"], accept: true },
    ]);
    await page.evaluate(() => { window.reset(); window.showToday(); });
    await page.getByRole("button", { name: "Accept all", exact: true }).click();
    await expect(page.getByTestId("tm-suggestion-banner")).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.maxes), [81.5, 122.5, 152.5]);
    assert.deepEqual(await page.evaluate(() => window.calls), [{ ids: ["0", "1", "2"], accept: true }]);
    await page.evaluate(() => { window.reset(); window.showToday(); });
    await page.getByRole("button", { name: "Decline all", exact: true }).click();
    await expect(page.getByTestId("tm-suggestion-banner")).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.maxes), [80, 120, 150]);
    assert.deepEqual(await page.evaluate(() => window.calls), [{ ids: ["0", "1", "2"], accept: false }]);
    await page.evaluate(() => { window.reset(); window.showSettings(); });
    const toggle = page.getByRole("switch");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await screenshot(`settings-switch-${width}`);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    assert.equal(await page.evaluate(() => window.setting), false);
    await page.evaluate(() => { window.mode = "error"; });
    await toggle.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  }
  await page.evaluate(() => { window.reset(); window.showToday(); window.mode = "delay"; });
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await expect(page.getByRole("button", { name: "Decline all", exact: true })).toBeDisabled();
  await page.evaluate(() => { window.mode = "error"; window.finish(); });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept Bench Press", exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.maxes), [80, 120, 150]);
  assert.deepEqual(errors, []);
  console.log("Max progression browser controls: passed (375px, 1280px; synthetic actions, no database).");
} finally {
  await browser.close();
}
