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
        import { CourseImportForm } from "./src/components/swim/CourseImportForm";
        import { CourseWorkoutEditor } from "./src/components/swim/CourseWorkoutEditor";
        import { SwimHub } from "./src/components/swim/SwimHub";
        import { WorkoutScreen } from "./src/components/swim/WorkoutScreen";
        import { workoutPresentation } from "./src/lib/swim/presentation";
        import { RecordingMatcher } from "./src/components/swim/RecordingMatcher";
        import { syntheticCourse } from "./src/lib/swim/__tests__/course-fixtures";
        import { planPrivateSwimCourse } from "./src/lib/swim/course-planning";
        import styles from "./src/components/swim/Swim.module.css";
        import "./src/app/globals.css";
        const root = createRoot(document.getElementById("root"));
        const long = { numerator: 50, denominator: 1, unit: "m" };
        const short = { numerator: 25, denominator: 1, unit: "m" };
        window.courseSource = syntheticCourse(); window.courseMode = "success"; window.courseCalls = []; window.destinations = [];
        window.courseSource.weeks.forEach((week, index) => week.workouts.forEach(workout => workout.title = "Week " + (index + 1)));
        window.sourceDrill = "Alternate relaxed swimming and kicking within each repeat.";
        window.courseSource.weeks[0].workouts[0].sections[0].items[0].drill = window.sourceDrill;
        const prepared = planPrivateSwimCourse({
          source: window.courseSource, setup: {
            course: long, goal: "endurance", experience: "recreational", knownStrokes: ["freestyle"],
            equipment: [], recentComfortableLengths: 4, sessionBudgetMinutes: null,
          }, startDate: "2026-09-14", weekdays: [1, 4], poolChoices: [],
        });
        window.previewCourse = async (form) => {
          window.courseCalls.push("preview");
          if (window.courseMode === "delay") await new Promise(resolve => window.resolveCourse = resolve);
          if (window.courseMode === "error") return { error: "Review the selected pool.", errorCode: "validation" };
          return { ok: true, preview: { id: "synthetic-course", title: window.courseSource.title, plan: prepared.preview,
            totals: [{ key: "course-0-0", week: 1, workout: 1, reported: 999, calculated: 350 }], strengthDays: ["Monday"] } };
        };
        window.saveCourse = async (form, id) => {
          window.courseCalls.push("save");
          window.courseConfirmed = id === "synthetic-course" && form.get("reviewed") === "on" &&
            form.get("acceptSetTotals") === "on" && form.get("acceptOverlap") === "on";
          if (window.courseMode === "error") return { error: "The plan changed. Review it again.", errorCode: "validation" };
          return { ok: true, planId: "00000000-0000-4000-8000-000000000004" };
        };
        window.previewCourseEdit = async input => {
          window.courseCalls.push("edit-preview"); window.editedWorkout = input.workout;
          return { ok: true, preview: { id: "synthetic-edit", before: "350 m", after: "250 m", plan: prepared.preview } };
        };
        window.saveCourseEdit = async () => { window.courseCalls.push("edit-save"); return { ok: true }; };
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
        window.showCourseHub = () => root.render(<main className={styles.page}><SwimHub key={++key}
          setupEnabled={false} plans={[]} plan={{
            id: "00000000-0000-4000-8000-000000000001", revision: 1, status: "active",
            imported: { title: window.courseSource.title }, goal: "Endurance", course: "50 m",
            dates: "2026-09-14 – 2026-09-27", today: "2026-09-14",
            proposals: [], analytics: { weeks: [], bests: [], benchmarks: [] },
            workouts: prepared.preview.weeks.flatMap(week => week.workouts.map(workout => ({
              ...workout, id: workout.slotId, week: week.week, status: "Scheduled", provisional: false,
            }))),
          }} /></main>);
        window.showWorkout = (generated = false) => {
          const issued = prepared.workouts[0].definition.issued;
          const view = workoutPresentation({ ...issued, budget: { ...issued.budget, minutes: 60 },
            snapshot: { ...issued.snapshot, versions: { ...issued.snapshot.versions,
              generator: generated ? "swim-gen-1" : issued.snapshot.versions.generator } },
          });
          const title = prepared.preview.weeks[0].workouts[0].title;
          root.render(<main className={styles.page}><h1>{title}</h1><WorkoutScreen key={++key} workout={{
            ...view, title, id: "00000000-0000-4000-8000-000000000002", revision: 1,
            sessionId: null, status: "scheduled", planStatus: "active", date: "2026-09-14",
            provisional: false, deleted: false, result: null,
          }} /></main>);
        };
        window.matchMode = "success"; window.matchCalls = []; window.findCalls = [];
        window.findWorkouts = async date => {
          window.findCalls.push(date);
          if (window.matchMode === "delay") await new Promise(resolve => window.resolveFind = resolve);
          return { ok: true, value: [{
            id: "00000000-0000-4000-8000-000000000002", revision: 3, date,
            title: "Synthetic endurance workout", distance: "350 m", pool: "50 m",
            plan: "Synthetic course · 2026-09-14", slot: "AM",
          }] };
        };
        window.saveMatch = async input => {
          window.matchCalls.push(input);
          return window.matchMode === "error" ? { ok: false, error: "The match could not be saved." } : { ok: true, value: input.requestId };
        };
        window.showMatcher = (matched = false, enabled = true) => root.render(<main className={styles.page}>
          <RecordingMatcher key={++key} importId="00000000-0000-4000-8000-000000000001" enabled={enabled}
            expectedMatchId={matched ? "00000000-0000-4000-8000-000000000003" : null}
            current={matched ? { importId: "00000000-0000-4000-8000-000000000001",
              workoutId: "00000000-0000-4000-8000-000000000002", title: "Synthetic endurance workout", date: "2026-09-15" } : null} />
        </main>);
        window.showCourse = () => root.render(<main className={styles.page}><CourseImportForm key={++key} today="2026-09-14" /></main>);
        window.showCourseEdit = () => root.render(<main className={styles.page}><CourseWorkoutEditor key={++key} context={{
          planId: "00000000-0000-4000-8000-000000000001", revision: 1,
          workoutId: "00000000-0000-4000-8000-000000000002", workoutRevision: 1,
          workout: window.courseSource.weeks[0].workouts[0],
        }} /></main>);
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
        build.onResolve({ filter: /^(?:@\/lib\/swim\/(?:actions|import-actions|course-actions|import-match-actions)|@\/components\/trash\/DeleteSessionButton|next\/(?:navigation|link))$/ }, (args) => ({ path: args.path, namespace: "test" }));
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents: args.path === "next/navigation"
            ? "export const useRouter = () => ({ push(path) { window.destinations.push(path); }, refresh() {} });"
            : args.path === "next/link"
              ? "import { createElement } from 'react'; export default function Link(props) { return createElement('a', props); }"
            : args.path === "@/lib/swim/course-actions"
              ? "export const previewPrivateSwimCourse = form => window.previewCourse(form); export const importPrivateSwimCourse = (form, id) => window.saveCourse(form, id); export const previewPrivateSwimEdit = input => window.previewCourseEdit(input); export const savePrivateSwimEdit = input => window.saveCourseEdit(input);"
            : args.path === "@/lib/swim/import-actions"
              ? "export const connectSwimDashboard = () => window.connectDashboard(); export const disconnectSwimDashboard = id => window.disconnectDashboard(id);"
            : args.path === "@/lib/swim/import-match-actions"
              ? "export const findSwimMatchWorkouts = date => window.findWorkouts(date); export const saveSwimImportMatch = input => window.saveMatch(input);"
            : args.path === "@/components/trash/DeleteSessionButton"
              ? "export const DeleteSessionButton = () => { throw new Error('Unexpected delete control'); };"
            : "export const previewSwimPoolEdit = input => window.previewPool(input); export const createSwimPlan = () => { throw new Error('Unexpected save'); }; export const previewSwimPlan = createSwimPlan; export const proposeSwimWeek = createSwimPlan, proposeSwimBenchmark = createSwimPlan, decideSwimProposal = createSwimPlan, changeSwimPlanStatus = createSwimPlan, previewSwimResume = createSwimPlan, resumeSwimPlan = createSwimPlan, decideSwimBenchmark = createSwimPlan, applySwimWeekEdit = createSwimPlan, applySwimDateEdit = createSwimPlan, applySwimPoolEdit = createSwimPlan, previewSwimWeekEdit = createSwimPlan, previewSwimDateEdit = createSwimPlan, skipSwimWorkout = createSwimPlan;",
          loader: "js", resolveDir: root,
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
  // An intercepted HTTPS origin exercises native Web Crypto without network access.
  await page.route("**/*", (route) => route.request().url() === "https://swim-ui.test/"
    ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' })
    : route.abort());
  await page.goto("https://swim-ui.test/");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });

  stage = "new-programme-default";
  await page.evaluate(() => window.showSetup());
  await page.getByRole("combobox", { name: "Pool length", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Pool length", exact: true }).inputValue(), "50m");
  stages.push(stage);

  for (const width of [375, 1280]) {
    stage = `explicit-recording-match-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { window.matchCalls = []; window.findCalls = []; window.matchMode = "delay"; window.showMatcher(); });
    const date = page.getByLabel("Workout date", { exact: true });
    await expect(date).toHaveValue("");
    await date.fill("2026-09-15");
    await page.getByRole("button", { name: "Find workouts", exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect(date).toBeDisabled();
    assert.equal(await page.evaluate(() => window.findCalls.length), 1);
    await page.evaluate(() => { window.matchMode = "success"; window.resolveFind(); });
    const choices = page.getByRole("combobox", { name: "Workout", exact: true });
    await expect(choices).toHaveValue("");
    assert.equal(await page.getByRole("button", { name: "Match workout", exact: true }).count(), 0);
    await choices.selectOption("00000000-0000-4000-8000-000000000002");
    await date.fill("2026-09-16");
    assert.equal(await page.getByRole("button", { name: "Match workout", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Find workouts", exact: true }).click();
    await choices.selectOption("00000000-0000-4000-8000-000000000002");
    await page.evaluate(() => { window.matchMode = "error"; });
    await page.getByRole("button", { name: "Match workout", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(choices).toHaveValue("00000000-0000-4000-8000-000000000002");
    await page.evaluate(() => { window.matchMode = "success"; });
    await page.getByRole("button", { name: "Match workout", exact: true }).click();
    await expect(page.getByRole("button", { name: "Match workout", exact: true })).toBeEnabled();
    const calls = await page.evaluate(() => window.matchCalls);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].requestId, calls[1].requestId);
    assert.deepEqual(Object.keys(calls[0]).sort(), ["expectedMatchId", "importId", "requestId", "workoutId", "workoutRevision"]);
    assert.equal(calls[0].workoutRevision, 3);
    assert.equal(await page.getByRole("button", { name: /Start|Finish|Complete/ }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => { window.matchCalls = []; window.showMatcher(true, false); });
    await expect(page.getByRole("button", { name: "Remove match", exact: true })).toBeVisible();
    assert.equal(await page.getByRole("button", { name: "Find workouts", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Remove match", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove match", exact: true })).toBeEnabled();
    assert.equal(await page.evaluate(() => window.matchCalls[0].workoutId), null);
    assert.equal(await page.evaluate(() => window.matchCalls[0].workoutRevision), null);
    stages.push(stage);

    stage = `private-course-review-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { window.courseCalls = []; window.courseMode = "delay"; window.showCourse(); });
    const file = page.getByLabel("Prepared plan file", { exact: true });
    const source = await page.evaluate(() => JSON.stringify(window.courseSource));
    await file.setInputFiles({ name: "synthetic.json", mimeType: "application/json", buffer: Buffer.from(source) });
    await page.getByRole("heading", { name: "Synthetic private course", exact: true }).waitFor();
    assert.equal(await page.locator('[name="timeBudgetMinutes"]').count(), 0);
    await page.getByRole("checkbox", { name: "Mon", exact: true }).check();
    await page.getByRole("checkbox", { name: "Thu", exact: true }).check();
    await page.getByRole("combobox", { name: "Experience", exact: true }).selectOption("regular");
    await page.getByRole("spinbutton", { name: "Comfortable non-stop lengths in the plan pool", exact: true }).fill("4");
    await page.getByRole("checkbox", { name: "Freestyle", exact: true }).check();
    await page.getByRole("button", { name: "Review plan", exact: true }).click();
    await page.waitForFunction(() => typeof window.resolveCourse === "function");
    assert.equal(await file.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.courseCalls), ["preview"]);
    await page.evaluate(() => { window.resolveCourse(); window.resolveCourse = undefined; window.courseMode = "success"; });
    const importPlan = page.getByRole("button", { name: "Import plan", exact: true });
    await importPlan.waitFor();
    const coursePreview = page.getByRole("region", { name: "Synthetic private course", exact: true });
    assert.equal(await coursePreview.getByText(/min limit|Up to .* min/).count(), 0);
    const previewTitles = await coursePreview.locator("details details summary strong").allTextContents();
    assert.ok(previewTitles[0].startsWith("Week 1 A"));
    assert.ok(previewTitles[1].startsWith("Week 1 B"));
    assert.equal(new Set(previewTitles).size, previewTitles.length);
    await coursePreview.locator("details details summary").first().click();
    const sourceDrill = await page.evaluate(() => window.sourceDrill);
    await coursePreview.getByText(sourceDrill, { exact: true }).first().waitFor();
    assert.deepEqual(await coursePreview.locator("li").first().locator("p").allTextContents(), [sourceDrill]);
    assert.equal(await page.getByRole("checkbox", { name: "Use the distances from the listed sets", exact: true }).isChecked(), false);
    await importPlan.click();
    assert.deepEqual(await page.evaluate(() => window.courseCalls), ["preview"]);
    await page.getByRole("checkbox", { name: "Use the distances from the listed sets", exact: true }).check();
    await page.getByRole("checkbox", { name: "Swim on strength days: Monday", exact: true }).check();
    await page.getByRole("checkbox", { name: "I have reviewed the workouts, dates and pools", exact: true }).check();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.evaluate(() => { window.courseMode = "error"; });
    await importPlan.click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByLabel("Start date", { exact: true }).inputValue(), "2026-09-14");
    await page.getByLabel("Start date", { exact: true }).fill("2026-09-15");
    assert.equal(await importPlan.count(), 0);
    await page.evaluate(() => { window.courseMode = "success"; });
    await page.getByRole("button", { name: "Review plan", exact: true }).click();
    await importPlan.waitFor();
    await page.getByRole("checkbox", { name: "Use the distances from the listed sets", exact: true }).check();
    await page.getByRole("checkbox", { name: "Swim on strength days: Monday", exact: true }).check();
    await page.getByRole("checkbox", { name: "I have reviewed the workouts, dates and pools", exact: true }).check();
    await importPlan.click();
    await page.getByRole("link", { name: "Open swimming plan", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.courseConfirmed), true);
    stages.push(stage);

    stage = `private-course-editor-${width}`;
    await page.evaluate(() => { window.courseCalls = []; window.showCourseEdit(); });
    await page.getByText("Edit workout", { exact: true }).click();
    const unspecifiedRest = page.getByRole("spinbutton", { name: "Rest (seconds)", exact: true }).first();
    assert.equal(await unspecifiedRest.inputValue(), "");
    await unspecifiedRest.fill("10");
    await unspecifiedRest.fill("");
    const main = page.getByRole("spinbutton", { name: "Repeats", exact: true }).nth(1);
    await main.fill("3");
    await page.getByRole("textbox", { name: "Reason for change", exact: true }).fill("Less pool time.");
    await page.getByRole("button", { name: "Review changes", exact: true }).click();
    const save = page.getByRole("button", { name: "Save changes", exact: true });
    await save.waitFor();
    assert.deepEqual(await page.evaluate(() => window.courseCalls), ["edit-preview"]);
    assert.equal(await page.evaluate(() => window.editedWorkout.sections[1].items[0].repeats), 3);
    assert.equal(await page.evaluate(() => window.editedWorkout.sections[0].items[0].restSeconds === undefined), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await main.fill("4");
    assert.equal(await save.count(), 0);
    await page.getByRole("button", { name: "Review changes", exact: true }).click();
    await save.click();
    await page.getByRole("button", { name: "Refresh workout", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.courseCalls), ["edit-preview", "edit-preview", "edit-save"]);
    stages.push(stage);
  }

  for (const width of [375, 1280]) {
    stage = `untimed-saved-course-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.showCourseHub());
    await page.getByRole("heading", { name: "Swims", exact: true }).waitFor();
    const links = page.locator('a[href^="/app/swim/course-"]');
    assert.deepEqual(await links.locator("strong").allTextContents(), ["Week 1 A", "Week 1 B", "Week 2 A"]);
    assert.equal(await links.locator("small").filter({ hasText: /Week \d/ }).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.evaluate(() => window.showWorkout());
    await page.getByRole("heading", { name: "Week 1 A", exact: true }).waitFor();
    assert.equal(await page.getByText(/min limit|Up to .* min/).count(), 0);
    await page.getByText(/Rest 20 sec/).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.evaluate(() => window.showWorkout(true));
    await page.getByText(/Up to 60 min/).waitFor();
    stages.push(stage);
  }

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
