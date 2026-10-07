import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(createRequire(require.resolve("vitest/package.json")).resolve("vite"));
const { build } = viteRequire("esbuild");
const root = fileURLToPath(new URL("..", import.meta.url));
const names = [
  ["Bench press", "bench-press-flat"], ["Weighted pull-up", "weighted-pull-up"],
  ["Seated overhead press", "overhead-press-seated"], ["Chest-supported DB row", "chest-supported-db-row"],
  ["Hammer curl", "hammer-curl"], ["Band Triceps Pressdown", "band-triceps-pressdown"],
  ["Wrist curl", "wrist-curl"], ["Reverse wrist curl", "reverse-wrist-curl"],
  ["Elevated Cossack squat", "elevated-cossack-squat"], ["SkiErg", "ski-erg", "ski"],
  ["Sled push", "sled-push"], ["Sled pull", "sled-pull"], ["Row", "row", "row"],
  ["Farmer carry", "farmer-carry"], ["Wall balls", "wall-balls"],
  ["Easy run", "run-easy-z2", "run"], ["Zercher squat", "zercher-squat"],
  ["Barbell forward lunge", "barbell-forward-lunge"], ["Standing calf raise", "standing-calf-raise"],
  ["Core", "dead-bug"], ["Pull-up / chin-up", "pull-up"], ["Lateral / rear delt raise", "lateral-raise"],
  ["Reverse curl", "reverse-curl"], ["Copenhagen hold", "copenhagen-hold"],
  ["Hip flexor raise", "hip-flexor-raise"], ["Single-leg barbell RDL", "single-leg-barbell-rdl"],
];
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const catalog = names.map(([displayName, slug, modality], index) => ({
  id: id(index + 1), displayName, slug, pattern: modality ? "cardio" : "push", ...(modality ? { modality } : {}),
}));
const protocols = [
  { id: id(90), name: "Adductor protocol", summary: "Copenhagen hold · Hip flexor raise" },
  { id: id(91), name: "Single-leg RDL protocol", summary: "Single-leg barbell RDL" },
];
const output = await build({
  stdin: { contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { ProgramBuilder } from "./src/components/program/ProgramBuilder";
    import { TodayDashboard } from "./src/components/today/TodayDashboard";
    import { authoredProgramSchema } from "./src/lib/programs/authored/schema";
    import { compileAuthoredWorkout } from "@hta/domain";
    import { SEED_MOVEMENTS } from "../../packages/db/seeds/movements";
    import { MovementFocusView } from "./src/components/session/MovementFocusView";
    import { isBodyweightCapableEquipment } from "./src/lib/sessions/bodyweight-equipment";
    import "./src/app/globals.css";
    const band = SEED_MOVEMENTS.find(m => m.slug === "band-triceps-pressdown");
    if (!band) throw new Error("Band pressdown missing from shared catalog");
    const catalog = ${JSON.stringify(catalog)}.map(m => m.slug === band.slug
      ? { ...m, displayName: band.displayName, pattern: band.pattern, equipment: band.equipment } : m);
    const protocols = ${JSON.stringify(protocols)};
    const root = createRoot(document.getElementById("root"));
    let key = 0;
    window.maxes = { [catalog[0].id]: 100, [catalog[1].id]: 132, [catalog[2].id]: 60, [catalog[16].id]: 100 };
    window.calls = [];
    window.preview = async input => {
      const parsed = authoredProgramSchema.safeParse(input.definition);
      if (!parsed.success) return { ok: false, error: parsed.error.issues.map(x => x.path.join(".") + ": " + x.message).join("; ") };
      window.calls.push({ action: "preview", input });
      return { ok: true, preview: { id: "preview", revision: "revision", overlaps: [], plannedRest: [], replaces: null } };
    };
    window.save = async input => {
      window.saved = authoredProgramSchema.parse(input.definition);
      window.savedStartedOn = input.startedOn;
      window.calls.push({ action: "save", input });
      return { ok: true, blockId: "${id(99)}" };
    };
    window.showBuilder = (edit = false, options = {}) => root.render(<main style={{maxWidth: 1000, margin: "0 auto", padding: 20}}>
      <ProgramBuilder key={++key} catalog={catalog} rehabProtocols={protocols} today="2026-10-05" commitments={[]}
        activity="hybrid" oneRmByMovementId={window.maxes} bodyweightKg={87}
        {...(edit ? { initial: window.saved, editBlockId: "${id(99)}", initialRevision: "revision",
          initialStartDate: window.savedStartedOn ?? "2026-10-05", canChangeStartDate: true, ...options } : {})} />
    </main>);
    window.compiled = (week, weekday) => compileAuthoredWorkout(
      window.saved.workouts.find(x => x.weekday === weekday), catalog,
      (protocolId, partId) => (protocolId === protocols[0].id ? [catalog[23], catalog[24]] : [catalog[25]]).map(movement => ({
        movementId: movement.id, movementName: movement.displayName, kind: "tendon", sets: 2, reps: 8,
        meta: { authoredPartId: partId, rehab: true },
      })), window.saved.weeks[week], week).items;
    window.showToday = (week) => {
      const workout = { id: "monday", date: "2026-10-05", title: "Upper A", program: window.saved.name,
        programId: "${id(99)}", kind: "hybrid", week: week + 1, weeks: 6, done: false, href: "#start",
        minutes: null, action: "Start workout", state: "not_started", items: window.compiled(week, 0),
        loadContext: { oneRmByMovementId: window.maxes, bodyweightKg: 87 } };
      root.render(<main style={{maxWidth:1000, margin:"0 auto", padding:20}}>
        <TodayDashboard today="2026-10-05" workouts={[workout]} weekWorkouts={[workout]}
          hasProgram multiplePrograms={false} quickWorkout={null} />
      </main>);
    };
    window.showBuilder();
    window.showBandLogger = () => {
      const movement = catalog.find(m => m.slug === band.slug);
      const items = window.compiled(0, 0).filter(item => item.movementId === movement.id);
      const group = { movementId: movement.id, movementName: movement.displayName,
        movementSlug: movement.slug, items, itemIndices: items.map((_, i) => i),
        slotBuckets: { warmup: [], working: [], accessory: items.map((_, i) => i) } };
      root.render(<main style={{maxWidth:600, margin:"0 auto", padding:20}}>
        <MovementFocusView sessionId="${id(98)}" group={group} tmKg={undefined} oneRmKg={undefined}
          loggedItemIndices={new Set()} loggedSetIdByItemIndex={{}} loggedSets={[]} priorBest={undefined}
          addStrengthSet={async fd => { window.bandSet = Object.fromEntries(fd); return { ok: true }; }}
          hapticsEnabled={false} timerSoundEnabled={false} restTimerEnabled={false}
          equipmentTag={movement.equipment} bodyweightCapable={isBodyweightCapableEquipment(movement.equipment)} />
      </main>);
    };
  `, loader: "tsx", resolveDir: root },
  bundle: true, write: false, outdir: "in-memory-builder-ui", format: "iife", platform: "browser",
  jsx: "automatic", logLevel: "warning", conditions: ["style"],
  define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": path.join(root, "src") },
  plugins: [{
    name: "isolated-actions",
    setup(build) {
      build.onResolve({ filter: /^(?:@\/lib\/(?:programs\/authored\/actions|planner\/actions|swim\/actions|sessions\/actions)|@\/components\/plan\/ThisWeekRail|next\/(?:navigation|link))$/ },
        args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
        contents: args.path === "next/navigation"
          ? "export const useRouter = () => ({ push: path => window.destination = path, refresh() {} });"
          : args.path === "next/link"
          ? 'import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }'
          : args.path === "@/components/plan/ThisWeekRail"
          ? "export function ThisWeekRail() { throw new Error('Unexpected schedule drawer'); }"
          : args.path === "@/lib/programs/authored/actions"
          ? "export const previewAuthoredProgram = input => window.preview(input); export const saveAuthoredProgram = input => window.save(input); export const reloadAuthoredProgram = () => { throw new Error('Unexpected reload'); };"
          : args.path === "@/lib/sessions/actions"
          ? "export const deleteSet = () => { throw new Error('Unexpected delete'); };"
          : "const unexpected = () => { throw new Error('Unexpected mutation'); }; export const movePlannedSession = unexpected, previewPlannedMove = unexpected, skipPlannedSession = unexpected, applySwimDateEdit = unexpected, previewSwimDateEdit = unexpected, skipSwimWorkout = unexpected;",
        loader: "js", resolveDir: root,
      }));
    },
  }],
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error); });
  await page.route("**/*", route => route.request().url() === "https://builder.test/"
    ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' })
    : route.abort());
  await page.goto("https://builder.test/");
  await page.addStyleTag({ content: output.outputFiles.find(file => file.path.endsWith(".css")).text });
  for (const [family, file, variable] of [["Geist", "Geist", "sans"], ["JetBrains Mono", "JetBrainsMono", "mono"], ["Oswald", "Oswald", "display"]]) {
    const data = await readFile(path.join(root, "src", "app", "fonts", `${file}.woff2`));
    await page.addStyleTag({ content: `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2");font-weight:100 900}:root{--font-${variable}:"${family}"}` });
  }
  await page.addScriptTag({ content: output.outputFiles.find(file => file.path.endsWith(".js")).text });
  const directory = process.env.UI_REVIEW_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  const strings = {};
  async function capture(name) {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow`);
      if (width === 375) {
        const small = await page.locator("main form").evaluateAll(forms => forms.flatMap(form =>
          [...form.querySelectorAll("button, input:not([type=checkbox]), select, a, summary")].filter(element => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
          }).map(element => element.getAttribute("aria-label") ?? element.textContent)));
        assert.deepEqual(small, [], `${name}: controls need 44px targets`);
      }
      strings[`${name}-${width}`] = await page.locator("main").innerText();
      if (directory) await page.screenshot({ path: path.join(directory, `builder-${name}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 375, height: 812 });
  }
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  async function day(index) {
    const region = page.getByRole("region", { name: dayNames[index], exact: true });
    const toggle = region.getByRole("button").first();
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    return region;
  }
  async function add(index, kind) {
    const region = await day(index);
    await region.getByRole("button", { name: "Add exercise", exact: true }).click();
    await region.getByRole("button", { name: kind, exact: true }).click();
    return region.getByTestId("builder-exercise").last();
  }
  async function pick(scope, name) {
    await scope.getByLabel("Search library", { exact: true }).fill(name);
    await scope.getByRole("button", { name, exact: true }).click();
  }
  async function exercise(index, [name, sets, reps, load = "", main = false]) {
    const part = await add(index, "Exercise");
    await pick(part, name);
    if (main) await part.getByRole("button", { name: "Main lift", exact: true }).click();
    else {
      await part.getByLabel("Sets", { exact: true }).fill(sets);
      await part.getByLabel("Reps", { exact: true }).fill(reps);
      if (load) await part.getByLabel("Load", { exact: true }).fill(load);
    }
    return part;
  }
  async function rehab(index, protocol) {
    const part = await add(index, "Rehab");
    await part.getByRole("combobox", { name: /^Protocol/ }).selectOption({ label: protocol });
  }
  async function circuit(index, title, stations, rounds, runs) {
    const part = await add(index, "Circuit");
    await part.getByLabel("Name", { exact: true }).fill(title);
    await part.getByRole("button", { name: "Different each week", exact: true }).click();
    if (runs) await part.getByRole("checkbox", { name: "Run before each station", exact: true }).check();
    for (let i = 0; i < 6; i++) {
      await part.getByLabel(`Week ${i + 1} rounds`, { exact: true }).fill(String(rounds[i]));
      if (runs) await part.getByLabel(`Week ${i + 1} run metres`, { exact: true }).fill(String(runs[i]));
    }
    for (let i = 0; i < stations.length; i++) {
      if (i >= 2) await part.getByRole("button", { name: "Add station", exact: true }).click();
      const station = part.locator("details").nth(i);
      await station.locator("summary").click();
      const [name, value, distance] = stations[i];
      await pick(station, name);
      if (await station.getByRole("combobox", { name: /^Measure/ }).count()) {
        await station.getByRole("combobox", { name: /^Measure/ }).selectOption(distance ? "distance" : "reps");
      }
      await station.getByLabel(distance ? "Metres" : "Reps", { exact: true }).fill(String(value));
      await station.locator("summary").click();
    }
    return part;
  }
  await page.getByLabel("Program name", { exact: true }).fill("Hybrid strength base");
  const dates = page.locator("summary").filter({ hasText: "weeks · starts" });
  await dates.click();
  await page.getByLabel("Start date", { exact: true }).fill("2026-10-06");
  await expect(dates).toContainText("Tue 6 Oct");
  await page.getByLabel("Start date", { exact: true }).fill("2026-10-05");
  await dates.click();
  const weeks = [["Build", "4", "5", 75], ["Build", "4", "4", 80], ["Build", "3", "3", 85],
    ["Deload", "3", "5", 72.5], ["Build", "3–4", "4", 80], ["Test", "1", "3", 90]];
  for (let i = 0; i < weeks.length; i++) {
    await page.getByRole("button", { name: new RegExp(`^Week ${i + 1}\\b`) }).filter({ hasText: "%" }).click();
    await page.getByRole("button", { name: `Edit week ${i + 1}`, exact: true }).click();
    const editor = page.getByRole("region", { name: `Edit week ${i + 1}`, exact: true });
    await editor.getByRole("button", { name: weeks[i][0], exact: true }).click();
    await editor.getByLabel("Sets", { exact: true }).fill(weeks[i][1]);
    await editor.getByLabel("Reps", { exact: true }).fill(weeks[i][2]);
    await editor.getByLabel("% 1RM", { exact: true }).fill(String(weeks[i][3]));
    await editor.getByRole("button", { name: "Done", exact: true }).click();
  }
  await page.getByRole("button", { name: /^Week 1\b/ }).filter({ hasText: "%" }).click();
  for (const spec of [
    ["Bench press", "", "", "", true], ["Weighted pull-up", "", "", "", true],
    ["Seated overhead press", "2–3", "6–10", "RIR 2–3"], ["Chest-supported DB row", "3", "8–12", "RIR 2"],
    ["Hammer curl", "2", "8–15", "RIR 1–3"], ["Band Triceps Pressdown", "2", "10–20", "RIR 2"],
    ["Wrist curl", "2", "12–20"], ["Reverse wrist curl", "2", "15–25"],
  ]) await exercise(0, spec);
  await rehab(0, protocols[0].name);
  await exercise(1, ["Elevated Cossack squat", "2", "8–12/side"]);
  await circuit(1, "Station circuit", [["SkiErg", 500, true], ["Sled push", 20, true], ["Sled pull", 20, true],
    ["Row", 500, true], ["Farmer carry", 40, true], ["Wall balls", 15, false]], [3, 3, 3, 2, 3, 2]);
  const cardio = await add(2, "Cardio");
  await pick(cardio, "Easy run");
  await cardio.getByLabel("Duration", { exact: true }).fill("40–60");
  await cardio.getByLabel("Effort", { exact: true }).fill("Zone 2");
  const zercher = await exercise(3, ["Zercher squat", "", "", "", true]);
  for (const [week, sets] of [[1, "3"], [2, "3"], [4, "2"], [5, "3"]]) {
    await page.getByRole("button", { name: new RegExp(week === 4 ? "^4 · Deload" : `^Week ${week}\\b`) }).filter({ hasText: "%" }).click();
    await zercher.getByRole("button", { name: `Week ${week} only`, exact: true }).click();
    await zercher.getByLabel("Sets", { exact: true }).fill(sets);
  }
  await page.getByRole("button", { name: /^Week 1\b/ }).filter({ hasText: "%" }).click();
  await rehab(3, protocols[1].name);
  await exercise(3, ["Barbell forward lunge", "2–3", "6–8/leg", "RIR 2"]);
  await exercise(3, ["Standing calf raise", "3", "8–15"]);
  await rehab(3, protocols[0].name);
  await exercise(3, ["Core", "2–3", "8–12"]);
  for (const spec of [
    ["Bench press", "3", "6–8", "70%"], ["Pull-up / chin-up", "3", "6–10", "RIR 2–3"],
    ["Chest-supported DB row", "3", "8–12", "RIR 2"], ["Seated overhead press", "2", "8–12", "65%"],
    ["Lateral / rear delt raise", "2", "12–20"], ["Reverse curl", "2", "8–15", "RIR 1–3"],
    ["Band Triceps Pressdown", "2", "10–20"], ["Wrist curl", "2", "12–20"], ["Reverse wrist curl", "2", "15–25"],
  ]) await exercise(4, spec);
  await circuit(5, "Run + station", [["SkiErg", 500, true], ["Row", 500, true], ["Farmer carry", 80, true], ["Wall balls", 20, false]],
    [4, 4, 4, 3, 5, 3], [700, 800, 1000, 700, 900, 800]);
  for (const [index, name] of ["Upper A", "HYROX A", "Zone 2", "Lower", "Upper B", "HYROX B"].entries()) {
    const region = await day(index);
    await region.locator("summary").filter({ hasText: "Edit day" }).click();
    await region.getByLabel("Workout name", { exact: true }).fill(name);
    await region.locator("summary").filter({ hasText: "Edit day" }).click();
  }
  const saturday = await day(5);
  await saturday.getByTestId("builder-exercise").first().getByRole("button").first().click();
  await capture("circuit");
  await day(0);
  await capture("create");
  await page.getByRole("button", { name: "Edit week 1", exact: true }).click();
  await capture("week-editor");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("region", { name: "Monday", exact: true }).getByTestId("builder-exercise").first().getByRole("button").first().click();
  await capture("main-lift");
  await page.getByRole("button", { name: /^4 · Deload/ }).click();
  const accessory = page.getByRole("region", { name: "Monday", exact: true }).getByTestId("builder-exercise").nth(3);
  await accessory.getByRole("button").first().click();
  await expect(accessory.getByRole("button").first()).toContainText("2 × 8–12");
  await capture("deload-accessory");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.saved?.workouts.length)).toBe(6);
  const compiled = await page.evaluate(() => [0, 3, 5].map(week => window.compiled(week, 0)));
  for (const [index, sets, reps, pct] of [[0, 4, 5, 75], [1, 3, 5, 72.5], [2, 1, 3, 90]]) {
    const bench = compiled[index].filter(item => item.movementId === catalog[0].id);
    assert.equal(bench.length, sets);
    assert.equal(bench[0].reps, reps);
    assert.equal(bench[0].percentTm, pct);
    assert.equal(bench[0].targetWeightKg, undefined, "Percentage prescriptions must not snapshot kg");
  }
  assert.equal(compiled[1].filter(item => item.movementId === catalog[3].id).length, 2);
  const mixed = await page.evaluate(() => window.compiled(3, 5));
  assert.equal(mixed.length, 6, "Three rounds means three run/station pairs");
  assert.deepEqual(mixed.filter(item => item.movementSlug === "run-easy-z2").map(item => item.distanceM.min), [700, 700, 700]);
  for (const [week, dose, kg] of [[0, "4 × 5", "75 kg"], [3, "3 × 5", "72.5 kg"], [5, "1 × 3", "90 kg"]]) {
    await page.evaluate(week => window.showToday(week), week);
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    const bench = page.getByTestId("today-hero-preview").locator("li").filter({ has: page.getByText("Bench press", { exact: true }) });
    await expect(bench).toContainText(dose);
    await expect(bench).toContainText(kg);
    if (week === 5) {
      await expect(page.getByTestId("today-hero-preview").locator("li").filter({ hasText: "Weighted pull-up" })).toContainText("+32.5 kg");
    }
    await capture(`today-week-${week + 1}`);
  }
  await page.evaluate(id => { window.maxes[id] = 110; window.showToday(0); }, catalog[0].id);
  await expect(page.getByTestId("today-hero-preview").locator("li").filter({ hasText: "Bench press" })).toContainText("82.5 kg");
  await page.evaluate(() => window.showBuilder(true));
  const savedDefinition = await page.evaluate(() => JSON.stringify(window.saved));
  await page.locator("summary").filter({ hasText: "weeks · starts" }).click();
  await expect(page.getByLabel("Start date", { exact: true })).toBeEnabled();
  await page.getByLabel("Start date", { exact: true }).fill("2026-10-14");
  await capture("start-date-edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.savedStartedOn)).toBe("2026-10-14");
  assert.equal(await page.evaluate(() => JSON.stringify(window.saved)), savedDefinition);
  await page.evaluate(() => window.showBuilder(true));
  await page.locator("summary").filter({ hasText: "weeks · starts" }).click();
  await expect(page.getByLabel("Start date", { exact: true })).toHaveValue("2026-10-14");
  await page.evaluate(() => window.showBuilder(true, { canChangeStartDate: false }));
  await page.locator("summary").filter({ hasText: "weeks · starts" }).click();
  await expect(page.getByLabel("Start date", { exact: true })).toBeDisabled();
  await page.evaluate(() => window.showBuilder(true, { workoutId: window.saved.workouts[0].id }));
  await page.locator("summary").filter({ hasText: "weeks · starts" }).click();
  await expect(page.getByLabel("Start date", { exact: true })).toBeDisabled();
  await page.getByRole("combobox", { name: "Apply changes to", exact: true }).selectOption("future");
  await expect(page.getByLabel("Start date", { exact: true })).toBeDisabled();
  await page.evaluate(() => window.showBuilder(true));
  await capture("edit");
  const monday = await day(0);
  await monday.locator("summary").filter({ hasText: "Edit day" }).click();
  const weekday = monday.getByRole("combobox", { name: "Day", exact: true });
  await expect(weekday.getByRole("option", { name: "Tuesday", exact: true })).toHaveJSProperty("disabled", true);
  await weekday.selectOption("6");
  const sunday = page.getByRole("region", { name: "Sunday", exact: true });
  await expect(sunday.getByRole("button").first()).toContainText("Upper A");
  await expect(sunday.getByTestId("builder-exercise")).toHaveCount(9);
  const main = sunday.getByTestId("builder-exercise").first();
  await main.getByRole("button").first().click();
  await main.getByLabel("Load", { exact: true }).fill("80 kg");
  await main.getByLabel("Load", { exact: true }).fill("invalid");
  await main.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(main.getByLabel("Load", { exact: true })).toHaveValue("75%");
  assert.equal(await main.getByLabel("Load", { exact: true }).evaluate(input => input.validity.valid), true);
  await page.evaluate(() => window.showBandLogger());
  await expect(page.getByTestId("movement-focus-view")).toContainText("RIR 2");
  await page.getByRole("textbox", { name: "Reps", exact: true }).fill("15");
  await page.getByTestId("rpe-zone-hard").click();
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.getByTestId("movement-focus-log-button").click();
  await expect.poll(() => page.evaluate(() => window.bandSet?.reps)).toBe("15");
  const bandSet = await page.evaluate(() => window.bandSet);
  assert.equal(bandSet.movementId, catalog[5].id);
  assert.equal(Number(bandSet.weightKg), 0, "Band logging must not require a kg estimate");
  assert.equal(Number(bandSet.rpe), 8.75);
  assert.deepEqual(errors, []);
  if (directory) await writeFile(path.join(directory, "builder-visible-strings.json"), JSON.stringify(strings, null, 2));
  console.log("DC-A1 / DC-K4 / DC-R5: full six-day program authored through UI; weeks 1/4/6, live maxes, pull-up, circuits and responsive layouts passed.");
} finally {
  await browser.close();
}
