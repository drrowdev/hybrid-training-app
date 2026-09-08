import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  chmodSync, fchmodSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import type { JSONReport, JSONReportSpec } from "@playwright/test/reporter";
import {
  BROWSER_LIMITS, browserBudget, buildBrowserEnv, prepareSwimBrowserReport, projectBrowserFailure,
  readSwimBrowserReport, requireBrowserEnvironment, requireBrowserPaths, requireFreePort,
  requireNoEnvFiles, requirePrivateBrowserPaths, sealSwimBrowserReport, SWIM_BROWSER_CASES, validateSwimBrowserReport, waitForBrowserReady,
  type BrowserPaths,
} from "../../../../scripts/swim-browser-acceptance";
import { acceptanceAssert, processFailure, safeFailureCause } from "../../../../scripts/swim-acceptance-errors";
import * as reporting from "../../../../scripts/swim-acceptance-reporting";
import {
  ALERT_ANNOTATION_TYPE, alertAnnotation, unavailableAlert,
} from "../../../../scripts/swim-alert-membership";

const webRoot = resolve(__dirname, "../../../..");
const paths: BrowserPaths = {
  runDirectory: join(tmpdir(), "swim-acceptance-pr802-1-1"),
  reportPath: join(tmpdir(), "swim-acceptance-pr802-1-1/browser.json"),
  outputDir: join(tmpdir(), "swim-acceptance-pr802-1-1/browser-output"),
};
const target = {
  url: "http://127.0.0.1:54321", projectRef: "local",
  anonKey: `sb_publishable_${"a".repeat(24)}`, serviceRoleKey: `sb_secret_${"b".repeat(24)}`,
};
const temporary: string[] = [];
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, fstatSync: vi.fn(actual.fstatSync), fchmodSync: vi.fn(actual.fchmodSync),
    openSync: vi.fn(actual.openSync), lstatSync: vi.fn(actual.lstatSync) };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fstatSync).mockImplementation(fs.fstatSync);
  vi.mocked(fchmodSync).mockReset().mockImplementation(fs.fchmodSync);
  vi.mocked(openSync).mockReset().mockImplementation(fs.openSync);
  vi.mocked(lstatSync).mockReset().mockImplementation(fs.lstatSync);
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function privatePaths() {
  const parent = mkdtempSync(join(tmpdir(), "swim-browser-unit-"));
  temporary.push(parent);
  const runDirectory = join(parent, "swim-acceptance-pr802-1-1");
  mkdirSync(runDirectory, { mode: 0o700 });
  return { runDirectory, reportPath: join(runDirectory, "browser.json"), outputDir: join(runDirectory, "browser-output") };
}
function prepareReport(location: BrowserPaths) {
  // Model time spent in the command, rather than rely on sub-millisecond filesystem timestamps.
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 1_000);
  try { return prepareSwimBrowserReport(location, webRoot); }
  finally { clock.mockRestore(); }
}

// Matches the pinned JSONReport types and JSONReporter file-suite serialization.
function report(location = paths) {
  const posix = (path: string) => path.split(sep).join("/");
  const suites = [...new Set(SWIM_BROWSER_CASES.map(({ file }) => file))].map((file) => ({
    title: basename(file), file: basename(file), line: 0, column: 0, specs: [],
    suites: [{
      title: String(SWIM_BROWSER_CASES.find((item) => item.file === file)!.describe),
      file: basename(file), line: 1, column: 1,
      specs: SWIM_BROWSER_CASES.filter((item) => item.file === file).map((item, index): JSONReportSpec => ({
        title: item.title, file: basename(file), line: index + 2, column: 1, id: `${file}-${index}`,
        ok: true, tags: [], tests: [{
          timeout: 30_000, annotations: [], expectedStatus: "passed",
          projectName: "mobile-chromium", projectId: "mobile-chromium", status: "expected",
          results: [{
            retry: 0, status: "passed", workerIndex: 0, parallelIndex: 0, duration: 1,
            startTime: new Date().toISOString(), error: undefined, errors: [], stdout: [], stderr: [],
            attachments: [], annotations: [],
          }],
        }],
      })),
    }],
  })) satisfies JSONReport["suites"];
  return {
    config: {
      version: "1.60.0", rootDir: posix(join(webRoot, "e2e")), workers: 1, fullyParallel: false,
      forbidOnly: true, globalTimeout: 300_000,
      projects: [{
        id: "mobile-chromium", name: "mobile-chromium", testDir: posix(join(webRoot, "e2e")),
        outputDir: posix(location.outputDir), repeatEach: 1, retries: 0, timeout: 30_000, metadata: {},
        testMatch: [...new Set(SWIM_BROWSER_CASES.map(({ file }) => posix(join(webRoot, file))))], testIgnore: [],
      }] satisfies JSONReport["config"]["projects"],
    },
    suites, errors: [], stats: { expected: SWIM_BROWSER_CASES.length, unexpected: 0, flaky: 0, skipped: 0 },
  };
}

function rejectedReport(fixture: unknown) {
  let caught: unknown;
  try { validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot); }
  catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(Error);
  expect(safeFailureCause(caught).classification).toBe("guard");
  return projectBrowserFailure(caught);
}

function unavailableObservations(index: number) {
  return index === 3 ? [unavailableAlert("c4-owner-1-start"), unavailableAlert("c4-owner-2-start")] :
    index === 4 ? [unavailableAlert("a1-pause")] :
      index === 5 ? [unavailableAlert("a2-post-start"), unavailableAlert("a2-edit")] : [];
}

describe("browser environment and static config", () => {
  it("DC-SW1/DC-SW7/DC-SW8/DC-SW9: preserves the original four identities and appends only A1/A2", () => {
    expect(SWIM_BROWSER_CASES).toEqual([
      {
        file: "e2e/swimming-mobile.spec.ts", describe: "ADR0079 standalone swimming",
        title: "blockless setup, local progress, offline finish and native history",
      },
      {
        file: "e2e/swimming-mobile.spec.ts", describe: "ADR0079 standalone swimming",
        title: "custom pool entry survives validation and compact repeats retain progress",
      },
      {
        file: "e2e/swimming-persistence-mobile.spec.ts",
        describe: "ADR0079 mobile swimming persistence and isolation",
        title: "DC-SW1/DC-SW8: native course and planned workouts survive reload and a second same-user mobile context",
      },
      {
        file: "e2e/swimming-persistence-mobile.spec.ts",
        describe: "ADR0079 mobile swimming persistence and isolation",
        title: "DC-SW1/DC-SW8: two mobile users retain distinct usable plans and cannot start or change each other's workouts",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A1, DC-SW7: pause, preview, resume, finish and archive preserve primary training and issued swims",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A2, DC-SW9: native UI completion, edit, trash and recovery replace regional load exactly once",
      },
    ]);
  });
  it("shares authored errors and the same WeakMap across the pure and reporting entry points", async () => {
    expect(reporting.acceptanceAssert).toBe(acceptanceAssert);
    expect(reporting.processFailure).toBe(processFailure);
    expect(reporting.safeFailureCause).toBe(safeFailureCause);
    for (const action of [
      () => acceptanceAssert(false, "browser-budget"),
      () => acceptanceAssert.deepEqual("private-actual", "private-expected", "browser-budget"),
      () => acceptanceAssert.match("private-actual", /^expected$/, "browser-budget"),
      () => browserBudget(0),
    ]) {
      let caught: unknown;
      try { action(); } catch (error) { caught = error; }
      const cause = safeFailureCause(caught);
      expect(cause).toEqual({ classification: "guard", message: "browser-budget" });
      expect(reporting.safeFailureCause(caught)).toBe(cause);
      const stages = new reporting.AcceptanceReporting();
      await expect(stages.stage("collection", async () => { throw caught; }, () => {})).rejects.toBe(caught);
      expect(stages.failures.primary?.cause).toBe(cause);
      expect(safeFailureCause(new Error("browser-budget")).classification).toBe("unexpected");
    }
    const result = { code: 1, signal: null, timedOut: false };
    const error = processFailure(result);
    expect(reporting.safeFailureCause(error)).toBe(safeFailureCause(error));
    expect(safeFailureCause(error)).toMatchObject({ classification: "process", result });
    let unlabelled: unknown;
    try { acceptanceAssert.deepEqual("private-actual", "private-expected"); } catch (error) { unlabelled = error; }
    expect(safeFailureCause(unlabelled).classification).toBe("assertion");
    expect(safeFailureCause(new SyntaxError("private-parser")).classification).toBe("parser");
  });

  it("maps only explicit local values with coherent application keys", () => {
    const env = buildBrowserEnv(target, paths);
    expect(requireBrowserEnvironment(env)).toEqual(paths);
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(env.E2E_SUPABASE_ANON_KEY);
    expect(env.POOL_SWIMMING_ENABLED).toBe("true");
    expect(env).not.toHaveProperty("GITHUB_ENV");
    expect(Object.isFrozen(SWIM_BROWSER_CASES)).toBe(true);
    expect(SWIM_BROWSER_CASES.every(Object.isFrozen)).toBe(true);
  });
  it.each([
    "CI", "PLAYWRIGHT_BASE_URL", "E2E_REQUIRE_SEED", "E2E_SWIM_NONPROD", "E2E_SWIM_LOCAL",
    "SWIM_TEST_PROJECT_REF", "E2E_SUPABASE_URL", "E2E_SUPABASE_ANON_KEY",
    "E2E_SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "HTA_SWIM_BROWSER_REPORT", "HTA_SWIM_BROWSER_OUTPUT_DIR",
  ])("rejects missing %s", (key) => {
    const env = buildBrowserEnv(target, paths);
    delete env[key];
    expect(() => requireBrowserEnvironment(env)).toThrow();
  });
  it.each([
    ["E2E_SUPABASE_URL", "https://remote.supabase.co"], ["NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54322"],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "different"], ["E2E_SUPABASE_ANON_KEY", "placeholder"],
    ["E2E_SUPABASE_SERVICE_ROLE_KEY", "placeholder"], ["CI", "false"],
    ["PLAYWRIGHT_BASE_URL", "http://localhost:3210"], ["SWIM_TEST_PROJECT_REF", "remote"],
  ])("rejects mismatched %s", (key, value) => {
    expect(() => requireBrowserEnvironment({ ...buildBrowserEnv(target, paths), [key]: value })).toThrow();
  });
  it("rejects noncanonical, wrong filenames and other run roots", () => {
    for (const reportPath of ["browser.json", `${paths.runDirectory}/../browser.json`, join(paths.runDirectory, "other.json")]) {
      expect(() => requireBrowserPaths({ ...paths, reportPath })).toThrow();
    }
    expect(() => requireBrowserPaths({ ...paths, outputDir: join(tmpdir(), "browser-output") })).toThrow();
    expect(() => buildBrowserEnv({ ...target, url: "http://127.0.0.1:54322" }, paths)).toThrow();
    expect(() => buildBrowserEnv({ ...target, projectRef: "remote" }, paths)).toThrow();
  });
  it("pins the isolated config without importing or collecting Playwright", () => {
    const source = readFileSync(join(webRoot, "playwright.swim-reference.config.ts"), "utf8");
    expect(source).not.toMatch(/playwright\.config|dotenv|webServer|GITHUB_ENV/);
    expect(source).toContain('devices["Desktop Chrome"]');
    expect(source).toContain('globalSetup: "./e2e/global-setup.ts"');
    expect(source).toContain('reporter: [["json", { outputFile: paths.reportPath }]]');
    for (const media of ["trace", "screenshot", "video"]) expect(source).toContain(`${media}: "off"`);
    expect(source.indexOf("requireBrowserEnvironment(process.env)")).toBeLessThan(source.indexOf("defineConfig({"));
    for (const setting of [
      "fullyParallel: false", "forbidOnly: true", "retries: 0", "workers: 1",
      "timeout: BROWSER_LIMITS.testTimeout", "globalTimeout: BROWSER_LIMITS.globalTimeout",
      "outputDir: paths.outputDir", "viewport: { width: 375, height: 812 }",
      "isMobile: false", "hasTouch: true",
    ]) expect(source).toContain(setting);
    const helper = readFileSync(join(webRoot, "scripts/swim-browser-acceptance.ts"), "utf8");
    expect(helper).not.toMatch(/process\.env|dotenv|from ["']\.\/swim-acceptance["']/);
    for (const item of SWIM_BROWSER_CASES) {
      const spec = readFileSync(join(webRoot, item.file), "utf8");
      expect(spec).toContain(`test.describe("${item.describe}"`);
      expect(spec).toContain(`test("${item.title}"`);
    }
  });
  it("DC-SW7/DC-SW8/DC-SW9: retains hard poll gates and the original A2 UI wait without diagnostic settling", () => {
    for (const file of ["swimming-lifecycle-load-mobile.spec.ts", "swimming-persistence-mobile.spec.ts"]) {
      const source = readFileSync(join(webRoot, "e2e", file), "utf8");
      for (const assertion of [
        'expect(backendOutcome).not.toBe("error");',
        'expect(backendOutcome).not.toBe("alert");',
        'expect(backendOutcome).toBe("backend");',
        "expect(lateAlertCount).toBe(0);",
      ]) expect(source).toContain(assertion);
      expect(source).not.toMatch(/expect\.soft|test\.fail|waitForTimeout/);
      expect(source).toContain(".evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK)");
      expect(source).toContain(".then(validateAlertCategory");
      expect(source).toContain("void expired.then(() => controller.abort())");
    }
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const start = source.slice(source.indexOf("const workout = scheduled.workouts[0];")).split('const started =')[0]!;
    expect(start).toContain('saved?.status === "started" && typeof saved.session_id === "string" && saved.session_id.length > 0');
    expect(start).toContain("}).toBe(true);");
    expect(start).toContain('await expect(page.getByRole("link", { name: "Log swim", exact: true })).toBeVisible();');
    expect(start).not.toMatch(/setTimeout|deadline|response\.finished|void page|observing|page\.url\(\)|reload\(|waitForTimeout/);
    const ordered = [
      'await page.getByRole("link").and(page.locator(`[href="/app/swim/${workout.id}"]`)).click();',
      'const expected = new URL(`/app/swim/${workout.id}`, baseURL!).href;',
      "await expect(page).toHaveURL(expected);",
      'await expect(page.getByRole("button", { name: "Start swim", exact: true })).toBeEnabled();',
      "const { origin, pathname } = new URL(expected);",
      "page.waitForRequest(", "page.waitForResponse(",
      "const transport = Promise.all([requestWaiter, responseWaiter])",
      'await page.getByRole("button", { name: "Start swim", exact: true }).click();',
      "await expect.poll(", "}).toBe(true);",
      'diagnostic.backend = "reached";',
      "await Promise.allSettled([(async () =>",
      'await expect(page.getByRole("link", { name: "Log swim", exact: true })).toBeVisible();',
      "} catch (error) {", "await captureFailureView(diagnostic).catch(() => undefined);", "throw error;",
      "})(), transport]);",
      'if (uiOutcome.status === "rejected") throw uiOutcome.reason;',
      "if (!transportOutcome.value.ok) throw transportOutcome.value.error;",
      "} finally {", "await Promise.allSettled([requestWaiter, responseWaiter, transport]);",
      "alertAnnotation(diagnostic)",
    ];
    let position = -1;
    for (const part of ordered) {
      const next = start.indexOf(part, position + 1);
      expect(next, part).toBeGreaterThan(position);
      position = next;
    }
    for (const part of [
      'if (actionRequest || request.method() !== "POST") return false;',
      "target.origin !== origin || target.pathname !== pathname",
      '!request.headers()["next-action"]', "actionRequest = request;",
      "response.request() === actionRequest", 'expect(requestOutcome).toBe("seen");',
      'expect(responseOutcome.outcome).toBe("seen");', "expect(responseOutcome.paired).toBe(true);",
      "expect(responseOutcome.status).toBe(200);",
      '(error: unknown) => ({ ok: false, error } as const)',
    ]) expect(start).toContain(part);
    expect(start.match(/timeout: 5000/g)).toHaveLength(2);
    expect(start.match(/name: "Start swim", exact: true \}\)\.click\(\)/g)).toHaveLength(1);
    expect(start.slice(start.indexOf("await expect.poll("), start.indexOf('await expect(page.getByRole("link"')))
      .not.toMatch(/await (transport|requestWaiter|responseWaiter)|timeout:/);
  });
  it("DC-SW7: distinguishes Finish and Archive with owned bounded status confirmation and unchanged preservation checks", () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const transitions = source.slice(source.indexOf("let previous = resumed;"), source.indexOf('test("A2,'));
    const ordered = ["let previous = resumed;"];
    for (const [control, status, label] of [
      ["Finish plan", "finished", "Finished"], ["Archive", "archived", "Archived"],
    ]) {
      ordered.push(
        `await page.getByRole("button", { name: "${control}", exact: true }).click();`,
        "const deadline = performance.now() + 5000;",
        `const outcome = await confirmPlanStatus(admin, freshUser.userId, planId, "${status}", deadline);`,
        'expect(outcome).not.toBe("read-error");',
        'expect(outcome).toBe("reached");',
        "const remaining = deadline - performance.now();",
        "expect(remaining).toBeGreaterThan(0);",
        `await expect(page.locator("main > section").first().getByText("${label}", { exact: true })).toBeVisible({ timeout: remaining });`,
        "const saved = await savedPlan(admin, freshUser.userId, planId);",
        `lifecycleTransition(previous.plan, saved.plan, "${status}");`,
        "expect(saved.workouts).toEqual(resumed.workouts);",
        "expect(saved.plan.state.decisions).toEqual(resumed.plan.state.decisions);",
        "expect(await primary.snapshot()).toEqual(primary.initial);",
        "previous = saved;",
      );
    }
    ordered.push(
      "await page.reload();",
      'await expect(page.locator("main > section").first().getByText("Archived", { exact: true })).toBeVisible();',
      "expect(await savedPlan(admin, freshUser.userId, planId)).toEqual(previous);",
      "expect(await primary.snapshot()).toEqual(primary.initial);",
    );
    let position = -1;
    for (const part of ordered) {
      const next = transitions.indexOf(part, position + 1);
      expect(next, part).toBeGreaterThan(position);
      position = next;
    }
    const assertionLines = transitions.split("\n").filter((line) => line.includes(".toBeVisible({ timeout: remaining });"));
    expect(assertionLines).toHaveLength(2);
    expect(assertionLines[0]).toContain('getByText("Finished",');
    expect(assertionLines[1]).toContain('getByText("Archived",');
    expect(transitions.match(/performance\.now\(\) \+ 5000/g)).toHaveLength(2);
    expect(transitions.match(/\.click\(\)/g)).toHaveLength(2);
    expect(transitions).not.toMatch(/for\s*\(|while\s*\(|catch\s*\(|timeout: 5000|waitForTimeout|annotations\.push/);

    const poll = source.slice(source.indexOf("async function confirmPlanStatus("), source.indexOf("async function primaryBaseline("));
    for (const part of [
      'status: "finished" | "archived", deadline: number',
      "const budget = deadline - performance.now();",
      'if (budget <= 0) return "not-confirmed-expired" as const;',
      "const controller = new AbortController();",
      "const expiry = setTimeout(() => controller.abort(), budget);",
      "const active = () => !controller.signal.aborted && performance.now() < deadline;",
      "const intervals = [100, 250, 500, 1000];",
      "while (active())",
      'admin.from("swim_plans").select("id,user_id,status")',
      '.eq("user_id", userId).eq("id", planId).abortSignal(controller.signal).single();',
      "sample.error || !sample.data || sample.data.id !== planId || sample.data.user_id !== userId",
      '!["active", "paused", "finished", "archived"].includes(sample.data.status)',
      'return "read-error" as const;',
      'if (!active()) return "not-confirmed-expired" as const;',
      'if (sample.data.status === status) return "reached" as const;',
      'if (remaining <= 0) return "not-confirmed-expired" as const;',
      "Math.min(intervals[Math.min(attempt++, intervals.length - 1)], remaining)",
      'controller.signal.addEventListener("abort", finish, { once: true });',
      'controller.signal.removeEventListener("abort", finish);',
      '})().catch(() => "read-error" as const);',
      "return await polling;",
      "} finally {", "controller.abort();", "clearTimeout(expiry);",
      "await Promise.allSettled([polling]);",
    ]) expect(poll).toContain(part);
    expect(poll.indexOf('return "read-error"')).toBeLessThan(poll.indexOf("if (!active())"));
    expect(poll.indexOf("if (!active())")).toBeLessThan(poll.indexOf('return "reached"'));
    expect(poll).not.toMatch(/performance\.now\(\) \+|\.update\(|\.insert\(|\.rpc\(|page\.|expect\(|annotations|alertAnnotation/);
  });
  it("DC-SW9: bounds A2 edit transport, concurrent owned observations and the unchanged UI goal", () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const edit = source.slice(source.indexOf('const editDiagnostic = unavailableAlert("a2-edit")'),
      source.indexOf("const edited = await nativeRows"));
    const ordered = [
      'page.locator("#swim-result").evaluate(',
      "form instanceof HTMLFormElement && form.checkValidity()",
      "const { origin, pathname } = new URL(page.url());",
      "page.waitForRequest(",
      "page.waitForResponse(",
      'await page.getByRole("button", { name: "Save changes", exact: true }).click();',
      "const deadline = performance.now() + 5000;",
      "const polling = (async () =>",
      "nativeRows(admin, userId, sessionId, controller.signal)",
      "owned.push(backend);",
      '.evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK)',
      "owned.push(alert);",
      "await Promise.all([backend, alert])",
      "const requestOutcome = await requestWaiter;",
      'expect(requestOutcome).toBe("seen");',
      "const responseOutcome = await responseWaiter;",
      'expect(responseOutcome.outcome).toBe("seen");',
      "expect(responseOutcome.paired).toBe(true);",
      "expect(responseOutcome.status).toBe(200);",
      "await Promise.race([polling, expired])",
      'expect(observationOutcome).toBe("backend");',
      "const remaining = deadline - performance.now();",
      "expect(remaining).toBeGreaterThan(0);",
      'await expect(result).toContainText("12 lengths · 10:00 · RPE 8", { timeout: remaining });',
      "} catch (error) {",
      "controller.abort();",
      "await captureFailureView(editDiagnostic).catch(() => undefined);",
      "throw error;",
      "} finally {",
      "controller.abort();",
      "clearTimeout(editExpiry);",
      "await Promise.allSettled(owned);",
      "alertAnnotation(editDiagnostic)",
    ];
    let position = -1;
    for (const part of ordered) {
      const next = edit.indexOf(part, position + 1);
      expect(next, part).toBeGreaterThan(position);
      position = next;
    }
    for (const part of [
      'if (actionRequest || request.method() !== "POST") return false;',
      "target.origin !== origin || target.pathname !== pathname",
      '!request.headers()["next-action"]',
      "actionRequest = request;",
      "response.request() === actionRequest",
      'error instanceof errors.TimeoutError ? "timeout"',
      "const active = () => !controller.signal.aborted && performance.now() < deadline;",
      "const intervals = [100, 250, 500, 1000];",
      "if (!active()) return",
      'sample.logs.length === 1 && log.id === originalLog.id',
      "log.client_log_id === originalLog.client_log_id",
      'expect(observationOutcome).not.toBe("backend-read-error");',
      'expect(observationOutcome).not.toBe("alert-read-error");',
      'expect(observationOutcome).not.toBe("alert-structural-error");',
      'expect(observationOutcome).not.toBe("observation-error");',
      'controller.signal.removeEventListener("abort", finish);',
    ]) expect(edit).toContain(part);
    expect(edit.match(/timeout: 5000/g)).toHaveLength(2);
    expect(edit.match(/performance\.now\(\) \+ 5000/g)).toHaveLength(1);
    expect(edit).not.toMatch(/\.first\(|reload\(|waitForTimeout|timeout: 0|\.revision\s*=|\.postData|\.text\(|\.json\(|\.allHeaders\(/);
    const native = source.slice(source.indexOf("async function nativeRows("), source.indexOf("async function regionRows("));
    expect(native).toContain('signal?: AbortSignal');
    expect(native).toContain('.eq("user_id", userId).eq("id", sessionId)');
    expect(native).toContain('expect(session.data.user_id).toBe(userId);');
    expect(native).toContain("signal ? await Promise.allSettled(reads)");
    expect(native).toContain(": await Promise.all(reads)");
    expect(native.slice(native.indexOf('admin.from("cardio_logs")'), native.indexOf("const reads"))).not.toContain("user_id");
  });
  it("DC-SW9: captures only after the two failed UI assertions, bounds reads, drains ownership and retains the original errors", () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const a2 = source.slice(source.indexOf('test("A2,'));
    const capture = a2.slice(a2.indexOf("async function captureFailureView"), a2.indexOf("const userId ="));
    expect(a2.match(/await captureFailureView\(/g)).toHaveLength(2);
    expect(capture).toContain('diagnostic.category = "unavailable";');
    expect(capture).toContain('diagnostic.control = "unavailable";');
    expect(capture).toContain('diagnostic.result = "unavailable";');
    for (const part of [
      'testInfo.status === "timedOut"', 'testInfo.status === "interrupted"', "page.isClosed()",
      "const budget = 1000;",
      "if (interrupted()) return;",
      ".filter({ visible: true }).evaluateAll(classifyWorkoutViewNodes).then(",
      ".evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK).then(",
      "count < 0", 'category === "unreadable" ? "unavailable"',
      "reads.push(view);", "reads.push(alert);", "reads.push(sample);",
      "setTimeout(() => resolve(undefined), budget)",
      "if (value && !interrupted() && performance.now() < deadline)",
      "clearTimeout(expiry);", "if (!settled && reads.length > 0) await page.close().catch(() => undefined);",
      "await Promise.allSettled(reads);",
    ]) expect(capture).toContain(part);
    expect(capture.match(/evaluateAll\(/g)).toHaveLength(2);
    expect(capture).not.toMatch(/admin\.|nativeRows|savedPlan|\.backend\s*=|\.revision\s*=|annotations\.push|\.first\(|\.click\(|\.reload\(|waitForTimeout|\.textContent|\.allTextContents|\.url\(|screenshot/);
    expect(a2).not.toMatch(/setTimeout.*5000|response\.finished|test\.setTimeout|test\.skip|\.first\(/);
  });
  it("rejects insufficient budgets without clamping", () => {
    for (const value of [589_999, -1, NaN, Infinity, 590_000.5]) expect(() => browserBudget(value)).toThrow();
    expect(browserBudget(590_000)).toBe(BROWSER_LIMITS);
    expect(BROWSER_LIMITS.required).toBe(BROWSER_LIMITS.build + BROWSER_LIMITS.ready +
      BROWSER_LIMITS.browserCommand + BROWSER_LIMITS.shutdown + BROWSER_LIMITS.allowance);
    expect(BROWSER_LIMITS.serverLifetime).toBe(BROWSER_LIMITS.ready + BROWSER_LIMITS.browserCommand +
      BROWSER_LIMITS.shutdown + BROWSER_LIMITS.allowance);
  });
  it("rejects environment files by name while preserving templates", () => {
    const directory = mkdtempSync(join(tmpdir(), "swim-env-unit-"));
    temporary.push(directory);
    mkdirSync(join(directory, "apps/web"), { recursive: true });
    writeFileSync(join(directory, ".env.example"), "");
    requireNoEnvFiles(directory);
    for (const base of [directory, join(directory, "apps/web")]) {
      for (const name of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local"]) {
        const path = join(base, name);
        mkdirSync(path);
        expect(() => requireNoEnvFiles(directory)).toThrow();
        rmSync(path, { recursive: true });
      }
    }
  });
});

describe("DC-SW1/DC-SW7/DC-SW8/DC-SW9 strict six-case browser ledger", () => {
  it("accepts real-shaped file wrappers and emits only fixed identities, counts and measured attempt durations", () => {
    const fixture = report();
    fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!.stdout = [{ text: "private-payload" }];
    const ledger = validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot);
    expect(ledger).toEqual({
      success: true, counts: { expected: 6, unexpected: 0, flaky: 0, skipped: 0 },
      cases: SWIM_BROWSER_CASES.map((item) => ({ ...item, status: "passed", attempts: 1, durationMs: 1 })),
    });
    expect(JSON.stringify(ledger)).not.toContain("private-payload");
  });
  it("rejects the passing original-four report after cohort expansion", () => {
    const fixture = report();
    fixture.suites.pop();
    fixture.config.projects[0]!.testMatch.pop();
    fixture.stats.expected = 4;
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it.each(SWIM_BROWSER_CASES)("requires $title exactly once with no retry, skip or error", (item) => {
    for (const mode of ["missing", "unexecuted", "duplicate", "identity", "retry", "skipped", "flaky", "error"]) {
      const fixture = report();
      const suite = fixture.suites.find((file) => file.file === basename(item.file))!.suites[0]!;
      const index = suite.specs.findIndex((spec) => spec.title === item.title);
      const test = suite.specs[index]!.tests[0]!;
      switch (mode) {
        case "missing": suite.specs.splice(index, 1); break;
        case "unexecuted": test.results = []; break;
        case "duplicate": suite.specs[1 - index] = suite.specs[index]!; break;
        case "identity": suite.specs[index]!.title = "private-identity"; break;
        case "retry": test.results[0]!.retry = 1; break;
        case "skipped": test.status = "skipped"; test.results[0]!.status = "skipped"; break;
        case "flaky": test.status = "flaky"; break;
        case "error": test.results[0]!.errors = [{ message: "private-error" }]; break;
      }
      const projection = rejectedReport(fixture);
      expect(projection.code).toBe(["missing", "unexecuted", "duplicate", "identity"].includes(mode)
        ? "browser-report-schema" : "browser-failed");
      expect(JSON.stringify(projection)).not.toContain("private-");
    }
  });
  it.each([undefined, null, -1, NaN, Infinity, -Infinity, BROWSER_LIMITS.browserCommand + 1, "1", {}, []])(
    "rejects missing or invalid duration %# on any attempt without projecting a partial ledger", (duration) => {
      for (const retried of [false, true]) {
        const fixture = report();
        const test = fixture.suites[2]!.suites[0]!.specs[1]!.tests[0]!;
        if (retried) {
          test.results.push({ ...test.results[0]!, retry: 1 });
          test.results[0]!.status = "failed";
          test.status = "flaky";
        }
        Object.assign(test.results[0]!, { duration, durationMs: 1, message: "private-duration" });
        expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
      }
    },
  );
  it("rejects nonfinite JSON numeric duration without raw diagnostics", () => {
    const text = JSON.stringify(report()).replace('"duration":1', '"duration":1e400');
    let caught: unknown;
    try { validateSwimBrowserReport(text, paths, webRoot); } catch (error) { caught = error; }
    expect(projectBrowserFailure(caught)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it.each([0, 12.5, BROWSER_LIMITS.browserCommand])(
    "projects only measured duration %s for a single passed or failed attempt", (duration) => {
      const fixture = report();
      const test = fixture.suites[2]!.suites[0]!.specs[1]!.tests[0]!;
      Object.assign(test.results[0]!, {
        duration, durationMs: "private-decoy", startTime: "private-time",
        stdout: [{ text: "private-stdout" }],
      });
      const success = validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot);
      expect(success.cases[5]).toEqual({ ...SWIM_BROWSER_CASES[5], status: "passed", attempts: 1, durationMs: duration });
      test.results[0]!.status = "timedOut";
      const failure = rejectedReport(fixture);
      expect(failure.cases?.[5]).toEqual({
        ...SWIM_BROWSER_CASES[5], status: "timedOut", testStatus: "expected",
        expectedStatus: "passed", attempts: 1, durationMs: duration, attributedSources: [{ source: "unknown" }],
        alertObservations: [unavailableAlert("a2-post-start"), unavailableAlert("a2-edit")],
      });
      expect(JSON.stringify([success, failure])).not.toContain("private-");
    },
  );
  it.each([
    "version", "project", "root", "extra", "missing", "duplicate", "unknown", "wrong-path", "describe",
    "skipped", "flaky", "unexpected", "retry", "result", "test", "ok", "error", "stats", "malformed",
    "global-error", "failed-result", "timed-out", "interrupted", "expected-failure", "no-result", "no-test",
    "extra-project", "test-project", "test-timeout", "output", "test-match", "test-dir", "repeat",
    "project-retry", "project-timeout", "nested", "suite-path", "file-wrapper", "absolute-wrong-path",
    "spec-missing", "spec-extra", "stats-flaky", "stats-skipped", "stats-unexpected", "duplicate-file",
  ])("rejects %s even with a successful command", (mode) => {
    const fixture = report();
    const spec = fixture.suites[0]!.suites[0]!.specs[0]!;
    const test = spec.tests[0]!;
    switch (mode) {
      case "version": fixture.config.version = "1.59.0"; break;
      case "project": fixture.config.projects[0]!.id = "other"; break;
      case "root": fixture.config.rootDir = tmpdir(); break;
      case "extra": fixture.suites.push(fixture.suites[0]!); break;
      case "missing": fixture.suites.pop(); break;
      case "duplicate": fixture.suites[0]!.suites[0]!.specs[1] = spec; break;
      case "duplicate-file": fixture.suites[2] = fixture.suites[0]!; break;
      case "unknown": spec.title = "private-payload"; break;
      case "wrong-path": spec.file = `elsewhere/${spec.file}`; break;
      case "describe": fixture.suites[0]!.suites[0]!.title = "other"; break;
      case "skipped": test.status = "skipped"; break;
      case "flaky": test.status = "flaky"; break;
      case "unexpected": test.status = "unexpected"; break;
      case "retry": test.results[0]!.retry = 1; break;
      case "result": test.results.push(test.results[0]!); break;
      case "test": spec.tests.push(test); break;
      case "ok": spec.ok = false; break;
      case "error": test.results[0]!.errors = [{ message: "private-payload" }]; break;
      case "stats": fixture.stats.expected = 3; break;
      case "global-error": Object.assign(fixture, { errors: [{ message: "private-payload" }] }); break;
      case "failed-result": test.results[0]!.status = "failed"; break;
      case "timed-out": test.results[0]!.status = "timedOut"; break;
      case "interrupted": test.results[0]!.status = "interrupted"; break;
      case "expected-failure": test.expectedStatus = "failed"; break;
      case "no-result": test.results = []; break;
      case "no-test": spec.tests = []; break;
      case "extra-project": fixture.config.projects.push(fixture.config.projects[0]!); break;
      case "test-project": test.projectId = "other"; break;
      case "test-timeout": test.timeout = 60_000; break;
      case "output": fixture.config.projects[0]!.outputDir = tmpdir(); break;
      case "test-match": fixture.config.projects[0]!.testMatch = ["**/*.spec.ts"]; break;
      case "test-dir": fixture.config.projects[0]!.testDir = tmpdir(); break;
      case "repeat": fixture.config.projects[0]!.repeatEach = 2; break;
      case "project-retry": fixture.config.projects[0]!.retries = 1; break;
      case "project-timeout": fixture.config.projects[0]!.timeout = 60_000; break;
      case "nested": Object.assign(fixture.suites[0]!.suites[0]!, { suites: [{}] }); break;
      case "suite-path": fixture.suites[0]!.suites[0]!.file = "elsewhere.spec.ts"; break;
      case "file-wrapper": fixture.suites[0]!.title = "other"; break;
      case "absolute-wrong-path": spec.file = join(tmpdir(), spec.file); break;
      case "spec-missing": fixture.suites[0]!.suites[0]!.specs.pop(); break;
      case "spec-extra": fixture.suites[0]!.suites[0]!.specs.push(spec); break;
      case "stats-flaky": fixture.stats.flaky = 1; break;
      case "stats-skipped": fixture.stats.skipped = 1; break;
      case "stats-unexpected": fixture.stats.unexpected = 1; break;
    }
    try {
      validateSwimBrowserReport(mode === "malformed" ? "private-payload" : JSON.stringify(fixture), paths, webRoot);
      expect.fail("Expected report rejection");
    } catch (error) {
      const outcomeFailure = [
        "skipped", "flaky", "unexpected", "retry", "result", "ok", "error", "stats",
        "global-error", "failed-result", "timed-out", "interrupted", "expected-failure",
        "stats-flaky", "stats-skipped", "stats-unexpected",
      ].includes(mode);
      const projection = projectBrowserFailure(error);
      expect(projection).toMatchObject({
        success: false, code: outcomeFailure ? "browser-failed" : "browser-report-schema",
      });
      if (outcomeFailure) expect(projection.cases).toHaveLength(SWIM_BROWSER_CASES.length);
      else expect(projection).toEqual({ success: false, code: "browser-report-schema" });
      expect(JSON.stringify(projection)).not.toContain("private-payload");
    }
  });
  it("does not project unknown errors or assertion payloads", () => {
    expect(projectBrowserFailure(new Error("private-payload"))).toEqual({ success: false, code: "browser-failed" });
  });
  it("does not inspect or project diagnostics and attachment payloads", () => {
    const fixture = report();
    const result = fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!;
    result.stdout = [{ text: "private-stdout" }];
    result.stderr = [{ text: "private-stderr" }];
    result.attachments = [{ name: "private-attachment", contentType: "text/plain", path: "/unread/private-path" }];
    expect(JSON.stringify(validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot))).not.toContain("private-");
  });
  it("throws the authored failure with only fixed identities, statuses and counts", () => {
    const fixture = report();
    const spec = fixture.suites[0]!.suites[0]!.specs[0]!;
    spec.ok = false;
    const test = spec.tests[0]!;
    test.status = "unexpected";
    const result = test.results[0]!;
    result.status = "failed";
    Object.assign(result, {
      error: { message: "private-message", stack: "private-stack", location: { file: "private-file" } },
      errors: [{ message: "private-errors", snippet: "private-snippet" }],
      stdout: [{ text: "private-stdout" }], stderr: [{ text: "private-stderr" }],
      attachments: [{ name: "private-attachment", path: "private-path" }],
      annotations: [{ type: "private-annotation", description: "private-description" }],
    });
    fixture.stats = { expected: SWIM_BROWSER_CASES.length - 1, unexpected: 1, flaky: 0, skipped: 0 };
    let caught: unknown;
    try { validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    const projection = projectBrowserFailure(caught);
    expect(projection).toEqual({
      success: false, code: "browser-failed", counts: fixture.stats,
      cases: SWIM_BROWSER_CASES.map((item, index) => ({
        ...item, status: index === 0 ? "failed" : "passed",
        testStatus: index === 0 ? "unexpected" : "expected", expectedStatus: "passed", attempts: 1, durationMs: 1,
        attributedSources: [{ source: "unknown" }],
        alertObservations: unavailableObservations(index),
      })),
    });
    expect(JSON.stringify(projection)).not.toContain("private-");
    expect(projectBrowserFailure(caught)).toEqual(projection);
  });
  it.each([
    ["e2e/swimming-mobile.spec.ts", "swimming-mobile"],
    ["e2e/swimming-persistence-mobile.spec.ts", "swimming-persistence-mobile"],
    ["e2e/swimming-lifecycle-load-mobile.spec.ts", "swimming-lifecycle-load-mobile"],
    ["e2e/global-setup.ts", "global-setup"],
    ["e2e/fixtures/seed.ts", "seed"],
    ["e2e/fixtures/auth.ts", "auth"],
    ["e2e/fixtures/seed-blocks.ts", "seed-blocks"],
    ["e2e/fixtures/swim-environment.ts", "swim-environment"],
  ])("attributes only the exact absolute source %s from either structured field", (file, source) => {
    for (const field of ["errorLocation", "errors"]) {
      const fixture = report();
      const result = fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!;
      const location = { file: join(webRoot, file), line: 1_000_000, column: 1_000_000, private: "private-location" };
      result.status = "timedOut";
      Object.assign(result, field === "errorLocation" ? { errorLocation: location } : { errors: [{ location }] });
      const projection = rejectedReport(fixture);
      expect(projection).toMatchObject({ success: false, code: "browser-failed", counts: fixture.stats });
      expect(projection.cases?.[0]?.attributedSources).toEqual([{ source, line: 1_000_000 }]);
      expect(JSON.stringify(projection)).not.toMatch(/private-|column/);
      expect(JSON.stringify(projection)).not.toContain(webRoot);
    }
  });
  it("deduplicates source/line across fields and retries and caps the case at two attributions", () => {
    const fixture = report();
    const test = fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!;
    const result = test.results[0]!;
    const location = { file: join(webRoot, "e2e/fixtures/seed.ts"), line: 12, column: 1 };
    result.status = "failed";
    Object.assign(result, {
      errorLocation: location,
      errors: [{ location: { ...location, column: 2 } }],
    });
    test.results.push({
      ...result, retry: 1, status: "passed", duration: 17,
      errors: [
        { message: "private-message", location: { ...location, line: 13 } },
        { message: "private-message", location: { file: join(webRoot, "e2e/fixtures/auth.ts"), line: 14, column: 1 } },
      ],
    });
    test.status = "flaky";
    const projection = rejectedReport(fixture);
    expect(projection.cases?.[0]).toEqual({
      ...SWIM_BROWSER_CASES[0], status: "passed", testStatus: "flaky", expectedStatus: "passed", attempts: 2, durationMs: 17,
      attributedSources: [{ source: "seed", line: 12 }, { source: "seed", line: 13 }],
      alertObservations: [],
    });
    expect(projection.counts).toEqual(fixture.stats);
  });
  it.each([
    undefined, "/unread/private-path", "x".repeat(4_096), "seed.ts", "fixtures/seed.ts", "e2e/fixtures/seed.ts",
    `${webRoot}/e2e/fixtures/../fixtures/seed.ts`, `${webRoot}/e2e/fixtures/./seed.ts`,
    `${webRoot}/e2e//fixtures/seed.ts`, `${webRoot}/e2e/fixtures/SEED.ts`,
    `${webRoot}/e2e/fixtures/seed.ts/private`, `${webRoot}/e2e/fixtures/seed.ts.bak`,
    `/private${join(webRoot, "e2e/fixtures/seed.ts")}`,
    `file://${join(webRoot, "e2e/fixtures/seed.ts")}`,
    `${webRoot}/src/lib/swim/presentation.ts`,
  ])("withholds paths and lines for missing or unmapped location %#", (file) => {
    for (const field of ["errorLocation", "errors"]) {
      const fixture = report();
      const result = fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!;
      result.status = "timedOut";
      const location = file === undefined ? undefined : { file, line: 987_654, column: 123 };
      Object.assign(result, field === "errorLocation" ? { errorLocation: location } : { errors: [{ location }] });
      const projection = rejectedReport(fixture);
      expect(projection.cases?.[0]?.attributedSources).toEqual([{ source: "unknown" }]);
      expect(JSON.stringify(projection)).not.toMatch(/private|987654|column/);
      expect(JSON.stringify(projection)).not.toContain(webRoot);
    }
  });
  it("strips planted diagnostics without letting them supply attribution", () => {
    for (const known of [false, true]) {
      const fixture = report();
      const result = fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!;
      const decoy = { file: join(webRoot, "e2e/fixtures/auth.ts"), line: 987_654, column: 123 };
      const privateText = `private-secret ${decoy.file}:${decoy.line}:${decoy.column}`;
      const diagnostic = {
        message: privateText, stack: privateText, snippet: privateText, value: privateText,
        cause: { location: decoy, message: privateText },
      };
      Object.assign(result, {
        error: { ...diagnostic, location: decoy },
        errors: [diagnostic],
        stdout: [{ text: privateText }], stderr: [{ text: privateText }],
        attachments: [{ name: privateText, path: privateText, body: privateText }],
        annotations: [{ type: privateText, description: privateText }],
        steps: [{ title: privateText, error: { location: decoy }, location: decoy }],
        ...(known ? { errorLocation: {
          file: join(webRoot, "e2e/fixtures/seed.ts"), line: 42, column: 1, ...diagnostic,
        } } : {}),
      });
      const projection = rejectedReport(fixture);
      expect(projection.code).toBe("browser-failed");
      expect(projection.cases?.[0]?.attributedSources).toEqual(known
        ? [{ source: "seed", line: 42 }, { source: "unknown" }] : [{ source: "unknown" }]);
      expect(JSON.stringify(projection)).not.toMatch(/private-|987654|column/);
      expect(JSON.stringify(projection)).not.toContain(webRoot);
    }
  });
  it.each([{}, { message: "private-error" }, null, "private-error", 0, false, []])(
    "keeps nonempty errors without locations as failures with their ledger %#", (error) => {
      const fixture = report();
      Object.assign(fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!, { errors: [error, error] });
      const projection = rejectedReport(fixture);
      expect(projection).toEqual({
        success: false, code: "browser-failed", counts: fixture.stats,
        cases: SWIM_BROWSER_CASES.map((item, index) => ({
          ...item, status: "passed", testStatus: "expected", expectedStatus: "passed", attempts: 1, durationMs: 1,
          attributedSources: [{ source: "unknown" }],
          alertObservations: unavailableObservations(index),
        })),
      });
    },
  );

  describe("reserved browser alert failed-case projection", () => {
        const observations = [
          { ...unavailableAlert("c4-owner-1-start"), category: "client-start", backend: "reached" },
          { ...unavailableAlert("c4-owner-2-start"), category: "unclassified", backend: "not-reached" },
          { ...unavailableAlert("a1-pause"), category: "client-save", backend: "reached", revision: "advanced" },
          { ...unavailableAlert("a2-post-start"), category: "absent", backend: "reached", control: "start", result: "none" },
          { ...unavailableAlert("a2-edit"), category: "server-fixed", backend: "reached", control: "log", result: "editing" },
        ] as const;
        function caseTest(fixture: ReturnType<typeof report>, index: number) {
          return fixture.suites.flatMap((suite) => suite.suites[0]!.specs)[index]!.tests[0]!;
        }
        it("projects only validated attempt annotations at their known points, capped and deduplicated per case", () => {
          const fixture = report();
          for (const [index, selected] of [[3, observations.slice(0, 2)], [4, [observations[2]]], [5, observations.slice(3)]] as const) {
            const result = caseTest(fixture, index).results[0]!;
            result.status = "failed";
            result.annotations = selected.flatMap((item) => [alertAnnotation(item)!, alertAnnotation(item)!]);
          }
          const projection = rejectedReport(fixture);
          expect(projection.code).toBe("browser-failed");
          expect(projection.cases).toHaveLength(6);
          expect(projection.cases?.map(({ alertObservations }) => alertObservations)).toEqual([
            [], [], [], observations.slice(0, 2), [observations[2]], observations.slice(3),
          ]);
          expect(projection.cases?.map(({ file, describe, title }) => ({ file, describe, title }))).toEqual(SWIM_BROWSER_CASES);
        });
        it.each(["a2-post-start", "a2-edit"] as const)(
          "retains the A2 failure ledger and defaults the other point when only %s was captured", (point) => {
            const fixture = report();
            const result = caseTest(fixture, 5).results[0]!;
            const selected = observations.find((item) => item.point === point)!;
            result.status = "failed";
            result.annotations = [alertAnnotation(selected)!];
            const projection = rejectedReport(fixture);
            expect(projection.code).toBe("browser-failed");
            expect(projection.cases?.[5]?.alertObservations).toEqual(
              observations.slice(3).map((item) => item.point === point ? selected : unavailableAlert(item.point)),
            );
          },
        );
        it.each(["wrong-case", "conflict", "hostile", "revision", "overflow", "control", "result", "order", "v1", "view-conflict"])(
          "rejects %s beside two A2 points without losing the failed six-case ledger", (mode) => {
            const fixture = report();
            const result = caseTest(fixture, 5).results[0]!;
            result.status = "failed";
            const valid = observations.slice(3).map((item) => alertAnnotation(item)!);
            let annotations: unknown = valid;
            switch (mode) {
              case "wrong-case": annotations = [...valid, alertAnnotation(observations[2])]; break;
              case "conflict": annotations = [...valid, alertAnnotation({ ...observations[4], backend: "not-reached" })]; break;
              case "hostile": annotations = [...valid, { ...valid[1], description: `${valid[1]!.description};raw=private-payload` }]; break;
              case "revision": annotations = [valid[0], { ...valid[1], description: valid[1]!.description.replace("revision=unavailable", "revision=advanced") }]; break;
              case "overflow": annotations = Array(17).fill(valid[1]); break;
              case "control": annotations = [{ ...valid[0], description: valid[0]!.description.replace("control=start", "control=private-payload") }]; break;
              case "result": annotations = [{ ...valid[1], description: valid[1]!.description.replace("result=editing", "result=private-payload") }]; break;
              case "order": annotations = [{ ...valid[0], description: valid[0]!.description.replace("control=start;result=none", "result=none;control=start") }]; break;
              case "v1": annotations = valid.map((item) => ({ ...item, type: "hta-swim-alert-membership-v1" })); break;
              case "view-conflict": annotations = [...valid, alertAnnotation({ ...observations[4], result: "summary" })]; break;
            }
            Object.assign(result, { annotations });
            const projection = rejectedReport(fixture);
            expect(projection).toMatchObject({ success: false, code: "browser-failed", counts: fixture.stats });
            expect(projection.cases).toHaveLength(6);
            expect(projection.cases?.[5]?.status).toBe("failed");
            expect(projection.cases?.[5]?.alertObservations).toEqual(unavailableObservations(5));
            expect(JSON.stringify(projection)).not.toContain("private-");
          },
        );
        it.each([
          "missing", "invalid", "partial", "prefixed", "suffixed", "long", "extra-key", "duplicate-key",
          "conflicting", "wrong-case", "unknown-type", "wrong-version", "test-only", "overflow",
        ])("keeps the failed ledger with unavailable diagnostics for %s annotations", (mode) => {
          const fixture = report();
          const test = caseTest(fixture, 4);
          const result = test.results[0]!;
          const valid = alertAnnotation(observations[2])!;
          result.status = "failed";
          let annotations: unknown = [valid];
          switch (mode) {
            case "missing": annotations = undefined; break;
            case "invalid": annotations = [{ ...valid, description: "private-secret" }]; break;
            case "partial": annotations = [{ ...valid, description: valid.description.slice(0, -1) }]; break;
            case "prefixed": annotations = [{ ...valid, description: `private-${valid.description}` }]; break;
            case "suffixed": annotations = [{ ...valid, description: `${valid.description}private-secret` }]; break;
            case "long": annotations = [{ ...valid, description: valid.description.repeat(100) }]; break;
            case "extra-key": annotations = [{ ...valid, raw: "private-secret" }]; break;
            case "duplicate-key": annotations = [{ ...valid, description: `${valid.description};point=a1-pause` }]; break;
            case "conflicting": annotations = [valid, alertAnnotation({ ...observations[2], category: "unclassified" })]; break;
            case "wrong-case": annotations = [alertAnnotation(observations[0])]; break;
            case "unknown-type": annotations = [{ ...valid, type: "skip" }]; break;
            case "wrong-version": annotations = [{ ...valid, type: `${ALERT_ANNOTATION_TYPE}-private` }]; break;
            case "test-only": test.annotations = [valid]; annotations = []; break;
            case "overflow": annotations = Array(17).fill(valid); break;
          }
          Object.assign(result, { annotations });
          const projection = rejectedReport(fixture);
          expect(projection).toMatchObject({ success: false, code: "browser-failed", counts: fixture.stats });
          expect(projection.cases).toHaveLength(6);
          expect(projection.cases?.[4]?.status).toBe("failed");
          expect(projection.cases?.[4]?.alertObservations).toEqual([unavailableAlert("a1-pause")]);
          expect(JSON.stringify(projection)).not.toContain("private-");
        });
        it("never projects raw payloads or diagnostics from other channels, even beside a valid annotation", () => {
          for (const valid of [false, true]) {
            const fixture = report();
            for (const index of [0, 1, 2, 3, 4, 5]) {
              const test = caseTest(fixture, index);
              const result = test.results[0]!;
              const annotation = alertAnnotation(observations[2])!;
              const raw = "private-secret";
              const decoy = { ...annotation, raw };
              Object.assign(result, {
                status: "failed",
                error: { message: raw, stack: raw, value: raw, cause: decoy },
                errors: [{ message: raw, stack: raw, value: raw, cause: decoy }],
                steps: [{ title: annotation.description, ...decoy }],
                attachments: [{ name: raw, path: "/unread/private-secret", body: annotation.description }],
                stdout: [{ text: raw }, { text: annotation.description }], stderr: [{ text: raw }],
                annotations: [
                  { type: "skip", description: raw }, { type: raw, description: annotation.description },
                  { type: "hta-swim-alert-membership-v1", description: raw },
                  ...(valid && index === 4 ? [annotation] : []),
                ],
              });
              test.annotations = [decoy];
            }
            const projection = rejectedReport(fixture);
            expect(projection.code).toBe("browser-failed");
            expect(projection.cases).toHaveLength(6);
            expect(projection.cases?.map(({ alertObservations }) => alertObservations)).toEqual(
              SWIM_BROWSER_CASES.map((_, index) => valid && index === 4 ? [observations[2]] : unavailableObservations(index)),
            );
            expect(JSON.stringify(projection)).not.toMatch(/private-|message|stack|value|cause|steps|attachments|stdout|stderr|annotations/);
          }
        });
        it("cannot turn diagnostics into a pass, expected failure, skip or retry allowance", () => {
          for (const mode of ["pass", "failed", "skipped", "retry", "error"]) {
            const fixture = report();
            const test = caseTest(fixture, 4);
            const result = test.results[0]!;
            result.annotations = [alertAnnotation(observations[2])!];
            if (mode === "pass") {
              const ledger = validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot);
              expect(ledger.cases[4]).not.toHaveProperty("alertObservations");
              continue;
            }
            if (mode === "failed") { result.status = "failed"; test.expectedStatus = "failed"; }
            if (mode === "skipped") { result.status = "skipped"; test.annotations = [{ type: "skip", description: "private" }]; }
            if (mode === "retry") test.results.push({ ...result, retry: 1, annotations: [] });
            if (mode === "error") result.errors = [{ message: "private" }];
            const projection = rejectedReport(fixture);
            expect(projection.code).toBe("browser-failed");
            expect(projection.cases).toHaveLength(6);
            expect(projection.cases?.[4]?.alertObservations).toEqual(
              mode === "retry" ? [unavailableAlert("a1-pause")] : [observations[2]],
            );
            expect(JSON.stringify(projection)).not.toContain("private");
          }
        });
  });
  it.each([null, false, 0, "", { location: null }])("preserves result.error presence %#", (error) => {
    const fixture = report();
    Object.assign(fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!, { error });
    expect(rejectedReport(fixture)).toMatchObject({ success: false, code: "browser-failed", counts: fixture.stats });
  });
  it.each([
    null, false, 1, "private-location", [], {},
    ...["file", "line", "column"].flatMap((key) =>
      [undefined, null, false, {}, []].map((value) => ({ file: "private-file", line: 1, column: 1, [key]: value }))),
    ...["", "x".repeat(4_097), 1].map((file) => ({ file, line: 1, column: 1 })),
    ...["line", "column"].flatMap((key) =>
      [0, -1, 1.5, 1_000_001, Number.MAX_SAFE_INTEGER, "1"].map((value) =>
        ({ file: "private-file", line: 1, column: 1, [key]: value }))),
  ])("fails closed on malformed structured locations %#", (location) => {
    for (const field of ["errorLocation", "errors"]) {
      const fixture = report();
      const result = fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!;
      Object.assign(result, field === "errorLocation" ? { errorLocation: location } : { errors: [{ location }] });
      expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
    }
  });
  it("validates locations beyond the output cap and leaves all-pass output unchanged", () => {
    const fixture = report();
    const result = fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!;
    const location = { file: join(webRoot, "e2e/fixtures/seed.ts"), line: 1, column: 1 };
    const passed = validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot);
    Object.assign(result, { errorLocation: location });
    expect(validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot)).toEqual(passed);
    result.errors = [
      { message: "private-message", location },
      { message: "private-message", location: { ...location, line: 2 } },
      { message: "private-message", location: { ...location, column: 0 } },
    ];
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it.each(["status", "test-status", "expected-status", "attempts", "retry", "stats", "fraction", "ok"])(
    "rejects malformed outcome %s without a partial ledger", (mode) => {
      const fixture = report();
      const spec = fixture.suites[0]!.suites[0]!.specs[0]!;
      const test = spec.tests[0]!;
      if (mode === "status") Object.assign(test.results[0]!, { status: "private-status" });
      if (mode === "test-status") Object.assign(test, { status: "private-status" });
      if (mode === "expected-status") Object.assign(test, { expectedStatus: "private-status" });
      if (mode === "attempts") test.results = Array.from({ length: 101 }, () => test.results[0]!);
      if (mode === "retry") test.results[0]!.retry = -1;
      if (mode === "stats") fixture.stats.expected = SWIM_BROWSER_CASES.length + 1;
      if (mode === "fraction") fixture.stats.expected = 1.5;
      if (mode === "ok") Object.assign(spec, { ok: "private-ok" });
      let caught: unknown;
      try { validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot); }
      catch (error) { caught = error; }
      expect(projectBrowserFailure(caught)).toEqual({ success: false, code: "browser-report-schema" });
    },
  );
});

describe.skipIf(process.platform === "win32")("private POSIX report fixtures", () => {
  it.each([sealSwimBrowserReport, readSwimBrowserReport])(
    "%s distinguishes absence at read, including a previously written and removed report", (consume) => {
      const location = privatePaths();
      const ticket = prepareReport(location);
      writeFileSync(location.reportPath, "previously present", { mode: 0o600 });
      rmSync(location.reportPath);
      let caught: unknown;
      try { consume(ticket); } catch (error) { caught = error; }
      expect(projectBrowserFailure(caught)).toEqual({ success: false, code: "browser-report-absent" });
      expect(reporting.safeFailureCause(caught)).toEqual({ classification: "guard", message: "browser-report-absent" });
      expect(openSync).not.toHaveBeenCalled();
    },
  );
  it.each([sealSwimBrowserReport, readSwimBrowserReport])(
    "%s validates tickets and roots before classifying absence", (consume) => {
      for (const kind of ["forged", "missing-root", "replaced-root", "public-root"]) {
        const location = privatePaths();
        const ticket = prepareReport(location);
        if (kind === "missing-root") rmSync(location.runDirectory, { recursive: true });
        if (kind === "replaced-root") {
          renameSync(location.runDirectory, `${location.runDirectory}-old`);
          mkdirSync(location.runDirectory, { mode: 0o700 });
        }
        if (kind === "public-root") chmodSync(location.runDirectory, 0o755);
        expect(() => consume(kind === "forged" ? { ...ticket } : ticket)).toThrow("browser-report-file");
      }
      expect(openSync).not.toHaveBeenCalled();
    },
  );
  it.each([sealSwimBrowserReport, readSwimBrowserReport])(
    "%s never classifies symlinks, access errors or a vanished root as report absence", (consume) => {
      for (const kind of ["dangling-symlink", "loop-symlink", "access", "root-race"]) {
        const location = privatePaths();
        const ticket = prepareReport(location);
        if (kind === "dangling-symlink") symlinkSync(join(location.runDirectory, "missing"), location.reportPath);
        if (kind === "loop-symlink") symlinkSync(location.reportPath, location.reportPath);
        vi.mocked(lstatSync).mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
          if (args[0] === location.reportPath) {
            if (kind === "access") throw Object.assign(new Error("private-access"), { code: "EACCES" });
            if (kind === "root-race") rmSync(location.runDirectory, { recursive: true });
          }
          return fs.lstatSync(...args);
        });
        expect(() => consume(ticket)).toThrow("browser-report-file");
        vi.mocked(lstatSync).mockImplementation(fs.lstatSync);
      }
    },
  );

  it.each(["public", "private", "missing-output"])("seals %s modes without consuming or refreshing the report", (mode) => {
    const location = privatePaths();
    const ticket = prepareReport(location);
    writeFileSync(location.reportPath, JSON.stringify(report(location)), { mode: 0o600 });
    chmodSync(location.reportPath, mode === "public" ? 0o644 : 0o600);
    if (mode !== "missing-output") {
      mkdirSync(location.outputDir);
      chmodSync(location.outputDir, mode === "public" ? 0o755 : 0o700);
      mkdirSync(join(location.outputDir, "child"));
    }
    const before = fs.statSync(location.reportPath);
    sealSwimBrowserReport(ticket);
    sealSwimBrowserReport(ticket);
    expect(fs.statSync(location.reportPath).mode & 0o7777).toBe(0o600);
    expect(fs.statSync(location.reportPath).mtimeMs).toBe(before.mtimeMs);
    if (mode !== "missing-output") expect(fs.statSync(location.outputDir).mode & 0o7777).toBe(0o700);
    expect(readSwimBrowserReport(ticket).success).toBe(true);
    expect(() => readSwimBrowserReport(ticket)).toThrow("browser-report-file");
    expect(() => sealSwimBrowserReport(ticket)).toThrow("browser-report-file");
  });
  it.each(["symlink", "hardlink", "directory", "empty", "large", "output-symlink", "output-file",
    "root", "root-mode", "root-owner", "forged"])("refuses unsafe sealing: %s", (mode) => {
    const location = privatePaths();
    const ticket = prepareReport(location);
    const outside = join(resolve(location.runDirectory, ".."), "outside");
    writeFileSync(outside, "outside", { mode: 0o644 });
    chmodSync(outside, 0o644);
    writeFileSync(location.reportPath, JSON.stringify(report(location)), { mode: 0o600 });
    if (["symlink", "hardlink", "directory"].includes(mode)) {
      rmSync(location.reportPath);
      if (mode === "symlink") symlinkSync(outside, location.reportPath);
      if (mode === "hardlink") linkSync(outside, location.reportPath);
      if (mode === "directory") mkdirSync(location.reportPath);
    }
    if (mode === "empty") writeFileSync(location.reportPath, "");
    if (mode === "large") writeFileSync(location.reportPath, Buffer.alloc(8 * 1024 * 1024 + 1));
    if (mode === "output-symlink") symlinkSync(resolve(location.runDirectory, ".."), location.outputDir);
    if (mode === "output-file") writeFileSync(location.outputDir, "");
    if (mode === "root") {
      renameSync(location.runDirectory, `${location.runDirectory}-old`);
      mkdirSync(location.runDirectory, { mode: 0o700 });
    }
    if (mode === "root-mode") chmodSync(location.runDirectory, 0o755);
    if (mode === "root-owner") {
      vi.spyOn(process as NodeJS.Process & { getuid(): number }, "getuid").mockReturnValue(process.getuid!() + 1);
    }
    expect(() => sealSwimBrowserReport(mode === "forged" ? { ...ticket } : ticket)).toThrow("browser-report-file");
    expect(fs.statSync(outside).mode & 0o7777).toBe(0o644);
    if (["root", "root-mode", "root-owner", "forged"].includes(mode)) expect(openSync).not.toHaveBeenCalled();
    for (const call of vi.mocked(openSync).mock.results) {
      if (call.type === "return") expect(() => fs.fstatSync(call.value)).toThrow();
    }
  });
  it("does not treat output access errors as optional absence", () => {
    const location = privatePaths();
    const ticket = prepareReport(location);
    writeFileSync(location.reportPath, JSON.stringify(report(location)), { mode: 0o600 });
    vi.mocked(openSync).mockImplementation((path, flags, mode) => {
      if (path === location.outputDir) throw Object.assign(new Error("private-access"), { code: "EACCES" });
      return fs.openSync(path, flags, mode);
    });
    expect(() => sealSwimBrowserReport(ticket)).toThrow("browser-report-file");
    for (const call of vi.mocked(openSync).mock.results) {
      if (call.type === "return") expect(() => fs.fstatSync(call.value)).toThrow();
    }
  });
  it.each(["report-owner", "output-owner", "identity", "chmod"])("closes descriptors on sealing %s failure", (mode) => {
    const location = privatePaths();
    const ticket = prepareReport(location);
    writeFileSync(location.reportPath, JSON.stringify(report(location)), { mode: 0o600 });
    mkdirSync(location.outputDir, { mode: 0o700 });
    vi.mocked(fstatSync).mockImplementation((...args: Parameters<typeof fs.fstatSync>) => {
      const stat = fs.fstatSync(...args);
      if ((mode === "report-owner" && stat.isFile()) || (mode === "output-owner" && stat.isDirectory())) {
        Object.assign(stat, { uid: Number(stat.uid) + 1 });
      }
      if (mode === "identity") Object.assign(stat, { ino: Number(stat.ino) + 1 });
      return stat;
    });
    if (mode === "chmod") vi.mocked(fchmodSync).mockImplementation(() => { throw new Error("private-chmod"); });
    expect(() => sealSwimBrowserReport(ticket)).toThrow("browser-report-file");
    for (const call of vi.mocked(openSync).mock.results) {
      if (call.type === "return") expect(() => fs.fstatSync(call.value)).toThrow();
    }
  });
  it("keeps reader freshness and failure projection checks after sealing", () => {
    const location = privatePaths();
    const ticket = prepareReport(location);
    const fixture = report(location);
    fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "failed";
    writeFileSync(location.reportPath, JSON.stringify(fixture), { mode: 0o600 });
    sealSwimBrowserReport(ticket);
    let caught: unknown;
    try { readSwimBrowserReport(ticket); } catch (error) { caught = error; }
    expect(projectBrowserFailure(caught)).toMatchObject({ success: false, code: "browser-failed" });
    expect(projectBrowserFailure(caught).cases?.[0]?.status).toBe("failed");
    expect(() => readSwimBrowserReport(ticket)).toThrow();
    const stale = privatePaths();
    const staleTicket = prepareReport(stale);
    writeFileSync(stale.reportPath, JSON.stringify(report(stale)), { mode: 0o600 });
    utimesSync(stale.reportPath, new Date(0), new Date(0));
    sealSwimBrowserReport(staleTicket);
    expect(() => readSwimBrowserReport(staleTicket)).toThrow("browser-report-file");
  });
  it("requires an absent report, reads one fresh private file, and consumes the ticket", () => {
    const location = privatePaths();
    const ticket = prepareReport(location);
    writeFileSync(location.reportPath, JSON.stringify(report(location)), { mode: 0o600 });
    expect(readSwimBrowserReport(ticket).success).toBe(true);
    expect(() => readSwimBrowserReport(ticket)).toThrow();
    expect(() => prepareSwimBrowserReport(location, webRoot)).toThrow();
  });
  it.each(["absent", "mode", "root-mode", "symlink", "hardlink", "stale", "future", "directory", "large", "empty"])(
    "rejects %s reports", (mode) => {
      const location = privatePaths();
      const ticket = prepareReport(location);
      if (mode !== "absent") writeFileSync(location.reportPath, JSON.stringify(report(location)), { mode: 0o600 });
      if (mode === "mode") chmodSync(location.reportPath, 0o644);
      if (mode === "root-mode") chmodSync(location.runDirectory, 0o755);
      if (mode === "hardlink") linkSync(location.reportPath, join(location.runDirectory, "linked"));
      if (mode === "stale") utimesSync(location.reportPath, new Date(0), new Date(0));
      if (mode === "future") utimesSync(location.reportPath, new Date(), new Date(Date.now() + 60_000));
      if (mode === "directory" || mode === "symlink") {
        rmSync(location.reportPath);
        if (mode === "directory") mkdirSync(location.reportPath);
        else symlinkSync(join(location.runDirectory, "missing"), location.reportPath);
      }
      if (mode === "large") writeFileSync(location.reportPath, Buffer.alloc(8 * 1024 * 1024 + 1));
      if (mode === "empty") writeFileSync(location.reportPath, "");
      expect(() => readSwimBrowserReport(ticket)).toThrow();
    },
  );
  it("rejects forged tickets, replaced roots, and symlinked output directories", () => {
    const location = privatePaths();
    const ticket = prepareReport(location);
    expect(() => readSwimBrowserReport({ ...ticket })).toThrow("browser-report-file");
    renameSync(location.runDirectory, `${location.runDirectory}-old`);
    mkdirSync(location.runDirectory, { mode: 0o700 });
    writeFileSync(location.reportPath, JSON.stringify(report(location)), { mode: 0o600 });
    expect(() => readSwimBrowserReport(ticket)).toThrow("browser-report-file");
    symlinkSync(`${location.runDirectory}-old`, location.outputDir);
    expect(() => requirePrivateBrowserPaths(location, webRoot)).toThrow("browser-paths");
  });
  it("rejects symlinked root ancestors without reading a report", () => {
    const location = privatePaths();
    const parent = resolve(location.runDirectory, "..");
    const alias = `${parent}-alias`;
    temporary.push(alias);
    symlinkSync(parent, alias);
    const noncanonical = {
      runDirectory: join(alias, basename(location.runDirectory)),
      reportPath: join(alias, basename(location.runDirectory), "browser.json"),
      outputDir: join(alias, basename(location.runDirectory), "browser-output"),
    };
    expect(() => requirePrivateBrowserPaths(noncanonical, webRoot)).toThrow("browser-paths");
  });
  it.each(["identity", "growth", "mtime", "owner"])("rejects descriptor %s changes", (mode) => {
    const location = privatePaths();
    const ticket = prepareReport(location);
    writeFileSync(location.reportPath, JSON.stringify(report(location)), { mode: 0o600 });
    const original = fs.fstatSync;
    let calls = 0;
    vi.mocked(fstatSync).mockImplementation((...args: Parameters<typeof fs.fstatSync>) => {
      const stat = original(...args);
      if (++calls === 2) {
        if (mode === "identity") Object.assign(stat, { ino: Number(stat.ino) + 1 });
        if (mode === "growth") Object.assign(stat, { size: Number(stat.size) + 1 });
        if (mode === "mtime") Object.assign(stat, { mtimeMs: Number(stat.mtimeMs) - 1 });
        if (mode === "owner") Object.assign(stat, { uid: Number(stat.uid) + 1 });
      }
      return stat;
    });
    expect(() => readSwimBrowserReport(ticket)).toThrow("browser-report-file");
    expect(calls).toBe(2);
  });
});

describe("test-owned loopback readiness", () => {
  it("rejects an occupied port and accepts it after release", async () => {
    const server = createServer((_req, res) => res.end());
    await new Promise<void>((done) => server.listen(3210, "127.0.0.1", done));
    try { await expect(requireFreePort()).rejects.toThrow(); }
    finally { await new Promise<void>((done) => server.close(() => done())); }
    await requireFreePort();
  });
  it("accepts HTTP readiness and drains a cancelled pending request", async () => {
    let hang = false;
    const server = createServer((_req, res) => { if (!hang) res.end(); });
    await new Promise<void>((done) => server.listen(3210, "127.0.0.1", done));
    const serverExit = new Promise<never>(() => {});
    try {
      expect(await waitForBrowserReady({ serverExit, signal: new AbortController().signal })).toEqual({ status: "ready" });
      hang = true;
      const controller = new AbortController();
      const waiting = waitForBrowserReady({ serverExit, signal: controller.signal });
      controller.abort();
      await expect(waiting).rejects.toThrow("browser-cancelled");
    } finally { await new Promise<void>((done) => server.close(() => done())); }
  });
  it("fails on any early own-server exit, timeout, or cancellation", async () => {
    for (const serverExit of [Promise.resolve(0), Promise.reject(new Error("private-payload"))]) {
      await expect(waitForBrowserReady({ serverExit, signal: new AbortController().signal }))
        .rejects.toThrow("browser-server-exited");
    }
    await expect(waitForBrowserReady({
      serverExit: new Promise<never>(() => {}), signal: new AbortController().signal, timeoutMs: 20,
    })).rejects.toThrow("browser-readiness-timeout");
  });
  it("waits for HTTP success, rejects delayed exit, and drains in-flight timeout work", async () => {
    let hanging = false;
    let requests = 0;
    let requested!: () => void;
    const firstRequest = new Promise<void>((done) => { requested = done; });
    const server = createServer((_req, res) => {
      requests++;
      requested();
      if (!hanging) { res.statusCode = 503; res.end(); }
    });
    await new Promise<void>((done) => server.listen(3210, "127.0.0.1", done));
    try {
      let exit!: () => void;
      const serverExit = new Promise<void>((done) => { exit = done; });
      const waiting = waitForBrowserReady({ serverExit, signal: new AbortController().signal });
      await firstRequest;
      exit();
      await expect(waiting).rejects.toThrow("browser-server-exited");
      expect(requests).toBeGreaterThan(0);
      hanging = true;
      await expect(waitForBrowserReady({
        serverExit: new Promise<never>(() => {}), signal: new AbortController().signal, timeoutMs: 30,
      })).rejects.toThrow("browser-readiness-timeout");
    } finally { await new Promise<void>((done) => server.close(() => done())); }
  });
  it("rejects pre-cancellation and invalid readiness budgets", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitForBrowserReady({
      serverExit: new Promise<never>(() => {}), signal: controller.signal,
    })).rejects.toThrow("browser-cancelled");
    for (const timeoutMs of [0, -1, NaN, Infinity, 60_001]) {
      await expect(waitForBrowserReady({
        serverExit: new Promise<never>(() => {}), signal: new AbortController().signal, timeoutMs,
      })).rejects.toThrow("browser-budget");
    }
  });
});
