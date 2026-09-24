import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  chmodSync, fchmodSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  countsTowardAdherence, countsTowardHistory, countsTowardProgression,
  estimateCriticalSwimSpeed, poolCourseEquals, validateSwimActualResult, validateSwimWorkout, type SwimActualResult,
} from "@hta/domain";
import { generateSwimPlan, SWIM_GENERATOR_VERSION } from "@hta/engine";
import { ScriptTarget, transpileModule } from "typescript";
import type { JSONReport, JSONReportSpec } from "@playwright/test/reporter";
import {
  BROWSER_LIMITS, browserBudget, buildBrowserEnv, prepareSwimBrowserReport, projectBrowserFailure, projectStackAttribution,
  readSwimBrowserReport, requireBrowserEnvironment, requireBrowserPaths, requireFreePort,
  requireNoEnvFiles, requirePrivateBrowserPaths, sealSwimBrowserReport, SWIM_BROWSER_CASES, validateSwimBrowserReport, waitForBrowserReady,
  type BrowserPaths,
} from "../../../../scripts/swim-browser-acceptance";
import { MODULAR_BROWSER_CASES, type BrowserCase } from "../../../../scripts/modular-browser-profile";
import {
  MODULAR_STAGE_CODES, projectModularObservation, readModularAnnotations, readModularFailurePhase,
  classifyHistoryDeleteFailure, readHistoryDeleteFailure,
  nativeUiFailureSchema, readNativeUiFailure, unavailableNativeUi,
} from "../../../../scripts/modular-browser-observations";
import { acceptanceAssert, processFailure, safeFailureCause } from "../../../../scripts/swim-acceptance-errors";
import * as reporting from "../../../../scripts/swim-acceptance-reporting";
import {
  ALERT_ANNOTATION_TYPE, alertAnnotation, authAbsenceBackend, c2HttpClass, c2Location, c2Transport,
  projectAlertObservations, readAlertAnnotations, unavailableAlert,
} from "../../../../scripts/swim-alert-membership";
import { parseActualForm, parseSetupForm } from "../forms";
import { standaloneWeekRequests } from "../model";
import { deriveSwimWeekCandidate, settledSwimResult } from "../queries";
import { swimFixture, sessionId, receiptId } from "./fixtures";
import type { SwimWorkoutRow } from "../storage";
import { addDaysToYmd, mondayOfYmd } from "../../dates";

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
function report(location = paths, cases: readonly BrowserCase[] = SWIM_BROWSER_CASES) {
  const posix = (path: string) => path.split(sep).join("/");
  const suites = [...new Set(cases.map(({ file }) => file))].map((file) => ({
    title: basename(file), file: basename(file), line: 0, column: 0, specs: [],
    suites: [{
      title: String(cases.find((item) => item.file === file)!.describe),
      file: basename(file), line: 1, column: 1,
      specs: cases.filter((item) => item.file === file).map((item, index): JSONReportSpec => ({
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
        testMatch: [...new Set(cases.map(({ file }) => posix(join(webRoot, file))))], testIgnore: [],
      }] satisfies JSONReport["config"]["projects"],
    },
    suites, errors: [], stats: { expected: cases.length, unexpected: 0, flaky: 0, skipped: 0 },
  };
}

describe("DC-SW8 modular acceptance report membership", () => {
  it("projects only current-case failure checkpoints and bounded synthetic indices", () => {
    const fixture = report(paths, MODULAR_BROWSER_CASES);
    for (const index of [2, 3]) {
      const test = fixture.suites[0]!.suites[0]!.specs[index]!.tests[0]!;
      test.results[0]!.status = "timedOut";
      test.results[0]!.annotations = [
        { type: "modular-stage", description: index === 2 ? "m3-08" : "m4-12" },
        { type: "modular-set-indices", description: "[1,3,2,4]" },
        { type: "private-type", description: "private-value" },
      ];
    }
    let caught: unknown;
    try { validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, MODULAR_BROWSER_CASES); }
    catch (error) { caught = error; }
    const result = projectBrowserFailure(caught);
    expect(result.success).toBe(false);
    expect(result.cases?.[2]?.modularObservation).toEqual({ stage: "m3-08", loggedIndices: [1, 3, 2, 4] });
    expect(result.cases?.[3]?.modularObservation).toEqual({ stage: "m4-12", loggedIndices: "unavailable" });
    expect(result.cases?.[0]).not.toHaveProperty("modularObservation");
    expect(JSON.stringify(result)).not.toContain("private-");
    fixture.suites[0]!.suites[0]!.specs.forEach((spec) => { spec.tests[0]!.results[0]!.status = "passed"; });
    expect(JSON.stringify(validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, MODULAR_BROWSER_CASES)))
      .not.toContain("modularObservation");
  });

  it("accepts the closed checkpoint codebook only for its own case", () => {
    const indices: Record<string, number> = { m3: 2, m4: 3, m8: 7, m12: 11, m13: 12 };
    for (const [kind, codes] of Object.entries(MODULAR_STAGE_CODES)) {
      for (const code of codes) {
        const observation = readModularAnnotations([{ type: "modular-stage", description: code }]);
        expect(projectModularObservation(indices[kind]!, observation).stage).toBe(code);
        for (const index of Array.from({ length: 18 }, (_, index) => index).filter((index) => index !== indices[kind])) {
          expect(projectModularObservation(index, observation)).toEqual({
            stage: "unavailable", loggedIndices: "unavailable",
          });
        }
      }
    }
  });

  it("retains timeout checkpoints without callers and distinguishes test from teardown without exposing errors", () => {
    const fixture = report(paths, MODULAR_BROWSER_CASES);
    for (const [index, stage, phase] of [[7, "m8-04", "test"], [11, "m12-05", "test-and-teardown"], [12, "m13-03", "teardown"]] as const) {
      const test = fixture.suites[0]!.suites[0]!.specs[index]!.tests[0]!;
      test.status = "unexpected";
      test.results[0]!.status = "timedOut";
      test.results[0]!.annotations = [
        { type: "modular-stage", description: stage }, { type: "modular-failure-phase", description: phase },
      ];
    }
    fixture.stats = { expected: 15, unexpected: 3, flaky: 0, skipped: 0 };
    let caught: unknown;
    try { validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, MODULAR_BROWSER_CASES); }
    catch (error) { caught = error; }
    const projected = projectBrowserFailure(caught);
    expect(projected.code).toBe("browser-failed");
    for (const [index, stage, phase] of [[7, "m8-04", "test"], [11, "m12-05", "test-and-teardown"], [12, "m13-03", "teardown"]] as const) {
      expect(projected.cases?.[index]).toMatchObject({
        failurePhase: phase, failureDetails: { callers: "unavailable" },
        modularObservation: { stage, loggedIndices: "unavailable" },
      });
    }
    expect(projected.cases?.[0]).not.toHaveProperty("failurePhase");
    const valid = { type: "modular-failure-phase", description: "test" };
    for (const input of [null, [valid, valid], Array(129).fill(valid),
      [{ ...valid, description: "private-value" }], [{ ...valid, description: ["test"] }]]) {
      expect(readModularFailurePhase(input)).toBe("unavailable");
    }
  });

  it("projects only M11's failed deletion category and never the underlying error", () => {
    const samples = [
      ["Your schedule changed. Review the dates again.", "stale"],
      ["Review and accept the overlapping workouts before saving.", "overlap"],
      ["Program lifecycle must match its plan.", "lifecycle"],
      ["A typed program needs exactly one matching active instance.", "lifecycle"],
      ["permission denied for table private-name", "permission"],
      ['new row violates row-level security policy for table "private-name"', "permission"],
      ["Not signed in.", "permission"], ["private-value", "unknown"], ["", "unavailable"],
    ] as const;
    for (const [text, classification] of samples) {
      expect(classifyHistoryDeleteFailure(text)).toBe(classification);
      const fixture = report(paths, MODULAR_BROWSER_CASES);
      for (const index of [0, 10]) {
        const test = fixture.suites[0]!.suites[0]!.specs[index]!.tests[0]!;
        test.status = "unexpected"; test.results[0]!.status = "failed";
        test.results[0]!.annotations = [{ type: "history-delete-failure", description: classification }];
      }
      fixture.stats = { expected: 16, unexpected: 2, flaky: 0, skipped: 0 };
      let caught: unknown;
      try { validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, MODULAR_BROWSER_CASES); }
      catch (error) { caught = error; }
      const projected = projectBrowserFailure(caught);
      expect(projected.cases?.[10]?.historyDeleteFailure).toBe(classification);
      expect(projected.cases?.[0]).not.toHaveProperty("historyDeleteFailure");
      expect(JSON.stringify(projected)).not.toContain("private-");
      fixture.suites[0]!.suites[0]!.specs.forEach((spec) => {
        spec.tests[0]!.status = "expected"; spec.tests[0]!.results[0]!.status = "passed";
      });
      fixture.stats = { expected: 18, unexpected: 0, flaky: 0, skipped: 0 };
      expect(JSON.stringify(validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, MODULAR_BROWSER_CASES)))
        .not.toMatch(/historyDeleteFailure|failurePhase/);
    }
    const valid = { type: "history-delete-failure", description: "stale" };
    for (const value of [null, {}, [valid, valid], Array(129).fill(valid), [{ ...valid, description: "private-value" }]]) {
      expect(readHistoryDeleteFailure(value)).toBe("unavailable");
    }
  });

  it("projects exact failure-only native UI snapshots onto their own cases", () => {
    const samples = [
      { case: "m8", page: "plan", control: "more", request: "not-observed", record: "active" },
      { case: "m9", control: "schedule", request: "not-observed", record: "retained",
        calendar: { day: "one", weekLink: "none", dayLink: "none" } },
      { case: "m11", control: "menu-closed", request: "http-success", record: "deleted" },
      { case: "m13", control: "pending", request: "pending", record: "present" },
      { case: "m14", control: "error", request: "http-success", record: "absent" },
    ] as const;
    const indices = [7, 8, 10, 12, 13];
    const fixture = report(paths, MODULAR_BROWSER_CASES);
    for (const [position, sample] of samples.entries()) {
      const index = indices[position]!;
      const annotation = { type: "native-ui-failure", description: JSON.stringify(sample) };
      expect(readNativeUiFailure([annotation], index)).toEqual(sample);
      expect(readNativeUiFailure([annotation], 0)).toBeUndefined();
      const test = fixture.suites[0]!.suites[0]!.specs[index]!.tests[0]!;
      test.status = "unexpected"; test.results[0]!.status = "failed";
      test.results[0]!.annotations = [annotation];
      for (const value of [null, {}, [annotation, annotation], Array(129).fill(annotation),
        [{ ...annotation, description: "private-value" }],
        [{ ...annotation, description: "x".repeat(513) }],
        [{ ...annotation, description: JSON.stringify({ ...sample, control: "private-value" }) }],
        [{ ...annotation, description: JSON.stringify({ ...sample, extra: "private-value" }) }],
        [{ ...annotation, description: JSON.stringify(samples[(position + 1) % samples.length]) }]]) {
        const projected = readNativeUiFailure(value, index);
        expect(projected).toEqual(unavailableNativeUi(sample.case));
        expect(nativeUiFailureSchema.safeParse(projected).success).toBe(true);
        expect(JSON.stringify(projected)).not.toContain("private-value");
      }
    }
    fixture.stats = { expected: 13, unexpected: 5, flaky: 0, skipped: 0 };
    let caught: unknown;
    try { validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, MODULAR_BROWSER_CASES); }
    catch (error) { caught = error; }
    const projected = projectBrowserFailure(caught);
    for (const [position, sample] of samples.entries()) {
      expect(projected.cases?.[indices[position]!]?.nativeUiFailure).toEqual(sample);
    }
    expect(projected.cases?.[0]).not.toHaveProperty("nativeUiFailure");
    for (const index of indices) {
      const test = fixture.suites[0]!.suites[0]!.specs[index]!.tests[0]!;
      test.status = "expected"; test.results[0]!.status = "passed";
    }
    fixture.stats = { expected: 18, unexpected: 0, flaky: 0, skipped: 0 };
    expect(JSON.stringify(validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, MODULAR_BROWSER_CASES)))
      .not.toContain("nativeUiFailure");
    for (const index of indices) {
      const test = fixture.suites[0]!.suites[0]!.specs[index]!.tests[0]!;
      test.status = "skipped"; test.results = [];
    }
    fixture.stats = { expected: 13, unexpected: 0, flaky: 0, skipped: 5 };
    try { validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, MODULAR_BROWSER_CASES); }
    catch (error) { caught = error; }
    for (const index of indices) {
      expect(projectBrowserFailure(caught).cases?.[index]).toMatchObject({ status: "not-run" });
      expect(projectBrowserFailure(caught).cases?.[index]).not.toHaveProperty("nativeUiFailure");
    }
  });

  it.each(["m8", "m9", "m11", "m13", "m14"] as const)("observes %s metadata without consuming response bodies or masking the original failure", async (caseId) => {
    const source = readFileSync(join(webRoot, "e2e/program-builder-mobile.spec.ts"), "utf8").replace(/\r\n/g, "\n");
    const helper = source.slice(source.indexOf("function observeNativeUi("), source.indexOf("function movement("));
    expect(helper).not.toMatch(/\.text\(|\.json\(|postData|waitForTimeout|response\.finished/);
    const events = new EventEmitter(), annotations: string[] = [];
    const path = caseId === "m8" || caseId === "m9" ? "/app/plan" : caseId === "m11" ? "/app/plan/history" : "/app/settings/rehab-protocols";
    const frame = {};
    let closed = false;
    const snapshot = unavailableNativeUi(caseId);
    const page = {
      url: () => `http://127.0.0.1:3210${path}`, mainFrame: () => frame,
      on: events.on.bind(events), off: events.off.bind(events),
      evaluate: async () => { if (closed) throw new Error("private-page-closed"); return snapshot; },
    };
    const createObserver = runInNewContext(transpileModule(`${helper}\nobserveNativeUi;`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      unavailableNativeUi, nativeUiFailureSchema, URL,
      diagnosticAnnotation: (type: string, description: string) => {
        expect(type).toBe("native-ui-failure"); annotations.push(description);
      },
    }) as (page: unknown, caseId: string, target: string, read: () => Promise<string>) => {
      capture(): Promise<void>; recordFailure(): Promise<void>; dispose(): void;
    };
    const read = vi.fn(async () => { throw new Error("private-read-error"); });
    const observer = createObserver(page, caseId, "private-id", read);
    const request = {
      url: () => page.url(), method: () => "POST", headers: () => ({ "next-action": "private-action" }),
      isNavigationRequest: () => false, frame: () => frame,
    };
    const last = () => nativeUiFailureSchema.parse(JSON.parse(annotations.at(-1)!));
    expect(last().request).toBe("not-observed");
    for (const unrelated of [
      { ...request, url: () => `http://127.0.0.1:3211${path}` },
      { ...request, url: () => "http://127.0.0.1:3210/unrelated" },
      { ...request, method: () => "GET" }, { ...request, headers: () => ({}) },
    ]) events.emit("request", unrelated);
    expect(last().request).toBe("not-observed");
    events.emit("request", request); expect(last().request).toBe("pending");
    await observer.capture(); expect(last().request).toBe("pending");
    events.emit("response", { request: () => request, ok: () => true });
    expect(last().request).toBe("http-success");
    events.emit("request", request);
    events.emit("response", { request: () => request, ok: () => false });
    expect(last().request).toBe("http-failure");
    events.emit("request", request); events.emit("requestfailed", request);
    expect(last().request).toBe("transport-failure");
    closed = true;
    await observer.recordFailure();
    expect(last().request).toBe("transport-failure");
    expect(last().record).toBe("unavailable");
    expect(read).toHaveBeenCalledTimes(1);
    expect(annotations.join("")).not.toContain("private");
    observer.dispose();
    for (const event of ["request", "response", "requestfailed"]) expect(events.listenerCount(event)).toBe(0);
  });

  it.each(["boundary", "heading", "hidden-heading", "normal", "offline", "loading", "hidden-plan"] as const)(
    "classifies M8's streamed %s without exporting page text", async (mode) => {
      const source = readFileSync(join(webRoot, "e2e/program-builder-mobile.spec.ts"), "utf8");
      const helper = source.slice(source.indexOf("function observeNativeUi("), source.indexOf("function movement("));
      const events = new EventEmitter(), annotations: string[] = [];
      const heading = { textContent: "Application error: private server detail", getClientRects: () => mode === "hidden-heading" ? [] : [{}] };
      const plan = { getClientRects: () => mode === "hidden-plan" ? [] : [{}] };
      const createObserver = runInNewContext(transpileModule(`${helper}\nobserveNativeUi;`, {
        compilerOptions: { target: ScriptTarget.ES2022 },
      }).outputText, {
        unavailableNativeUi, nativeUiFailureSchema, URL,
        document: {
          title: "SxC",
          querySelector: (selector: string) =>
            selector === "#__next_error__" && mode === "boundary" ? {} :
              selector === '[data-testid="offline-document"]' && mode === "offline" ? plan :
                selector === '[data-testid="plan-redesign"]' && mode !== "loading" ? plan : null,
          querySelectorAll: () => ["heading", "hidden-heading"].includes(mode) ? [heading] : [],
        },
        location: { pathname: "/app/plan" },
        diagnosticAnnotation: (_type: string, description: string) => annotations.push(description),
      }) as (page: unknown, caseId: string, target: string, read: () => Promise<string>) => {
        capture(): Promise<void>; dispose(): void;
      };
      const observer = createObserver({
        on: events.on.bind(events), off: events.off.bind(events),
        evaluate: async (callback: (args: unknown) => unknown, args: unknown) => callback(args),
      }, "m8", "", async () => "active");
      await observer.capture();
      expect(JSON.parse(annotations.at(-1)!)).toMatchObject({
        case: "m8", page: ["boundary", "heading"].includes(mode) ? "error" :
          ["offline", "loading", "hidden-plan"].includes(mode) ? "other" : "plan", control: "absent",
      });
      expect(annotations.join("")).not.toContain("private");
      observer.dispose();
    },
  );

  it.each([
    { failed: false, caseId: "m13", timeout: 30_000 },
    { failed: true, caseId: "m13", timeout: 30_000 },
    { failed: false, caseId: "m14", timeout: undefined },
    { failed: true, caseId: "m14", timeout: undefined },
  ])("retains only failed $caseId library observations with the original budget (failure=$failed)", async ({ failed, caseId, timeout }) => {
    const source = readFileSync(join(webRoot, "e2e/program-builder-mobile.spec.ts"), "utf8");
    const helper = source.slice(source.indexOf("async function createRehabInLibrary("), source.indexOf("async function draftPair("));
    const annotations = [{ type: "modular-stage", description: "m13-01" }, { type: "native-ui-failure", description: "pending" }];
    const observation = { capture: vi.fn(), recordFailure: vi.fn(), dispose: vi.fn() };
    const failure = new Error("synthetic failure");
    const createLibrary = runInNewContext(transpileModule(`${helper}\ncreateRehabInLibrary;`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      observeNativeUi: (_page: unknown, selectedCase: string) => {
        expect(selectedCase).toBe(caseId); return observation;
      }, test: { info: () => ({ annotations }) },
      expect: () => ({ toBeVisible: async (options: { timeout?: number }) => {
        expect(options).toEqual({ timeout });
        if (failed) throw failure;
      } }),
    }) as (page: unknown, movement: unknown, name: string, actor: unknown, timeout: number | undefined, caseId: string) => Promise<void>;
    const locator = { click: async () => {}, fill: async () => {},
      getByRole: () => locator, filter: () => locator };
    const result = createLibrary({
      goto: async () => {}, getByRole: () => locator, getByTestId: () => locator,
      getByLabel: () => locator, getByText: () => locator,
    }, { display_name: "Exercise" }, "Protocol", {}, timeout, caseId);
    if (failed) {
      await expect(result).rejects.toBe(failure);
      expect(annotations).toHaveLength(2);
      expect(observation.recordFailure).toHaveBeenCalledOnce();
    } else {
      await result;
      expect(annotations).toEqual([{ type: "modular-stage", description: "m13-01" }]);
      expect(observation.recordFailure).not.toHaveBeenCalled();
    }
    expect(observation.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    { week: false, days: 0, weekLinks: 0, dayLinks: 0 },
    { week: true, days: 0, weekLinks: 1, dayLinks: 0 },
    { week: true, days: 1, weekLinks: 1, dayLinks: 1 },
    { week: true, days: 1, weekLinks: 1, dayLinks: 0 },
    { week: true, days: 2, weekLinks: 2, dayLinks: 2 },
  ].flatMap((counts) => ["m9", "m11"].map((caseId) => ({ ...counts, caseId }))))("projects $caseId calendar evidence without exporting dates or IDs: %j", async (counts) => {
    const source = readFileSync(join(webRoot, "e2e/program-builder-mobile.spec.ts"), "utf8");
    const helper = source.slice(source.indexOf("function observeNativeUi("), source.indexOf("function movement("));
    const annotations: string[] = [], events = new EventEmitter();
    const day = { querySelectorAll: () => Array(counts.dayLinks).fill({}) };
    const createObserver = runInNewContext(transpileModule(`${helper}\nobserveNativeUi;`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      unavailableNativeUi, nativeUiFailureSchema, URL,
      document: { querySelector: () => counts.week ? { querySelectorAll: (selector: string) =>
        selector.startsWith("time") ? Array(counts.days).fill({ parentElement: { parentElement: day } })
          : Array(counts.weekLinks).fill({}) } : null },
      diagnosticAnnotation: (_type: string, description: string) => annotations.push(description),
    }) as (page: unknown, caseId: string, target: string, read: () => Promise<string>, date: string) => {
      recordFailure(): Promise<void>; dispose(): void;
    };
    const observer = createObserver({
      on: events.on.bind(events), off: events.off.bind(events),
      evaluate: async (callback: (args: unknown) => unknown, args: unknown) => callback(args),
    }, counts.caseId, "private-id", async () => "retained", "2026-09-24");
    await observer.recordFailure();
    const count = (value: number) => !value ? "none" : value === 1 ? "one" : "multiple";
    const caseId = counts.caseId === "m9" ? "m9" : "m11";
    const caseIndex = caseId === "m9" ? 8 : 10;
    const expected = { case: caseId, control: counts.week ? "schedule" : "schedule-absent",
      request: "not-observed", record: "retained", calendar: {
        day: count(counts.days), weekLink: count(counts.weekLinks), dayLink: count(counts.dayLinks),
      } };
    const annotation = { type: "native-ui-failure", description: annotations.at(-1)! };
    expect(readNativeUiFailure([annotation], caseIndex)).toEqual(expected);
    for (const calendar of [{ ...expected.calendar, day: "private-id" }, { ...expected.calendar, date: "2026-09-24" }]) {
      expect(readNativeUiFailure([{ ...annotation, description: JSON.stringify({ ...expected, calendar }) }], caseIndex))
        .toEqual(unavailableNativeUi(caseId));
    }
    expect(annotations.join("")).not.toMatch(/private-id|2026-09-24/);
    observer.dispose();
  });

  it.each([undefined, 30_000])("waits for the same authoritative save URL with the selected assertion budget (%s)", async (timeout) => {
    const source = readFileSync(join(webRoot, "e2e/program-builder-mobile.spec.ts"), "utf8");
    const helper = source.slice(source.indexOf("async function review("), source.indexOf("async function planned("));
    const visible = vi.fn(async () => {});
    const url = vi.fn<(expected: RegExp, options: { timeout?: number }) => Promise<void>>(async () => {});
    const savedId = "00000000-0000-4000-8000-000000000001";
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), is: vi.fn(() => query),
      single: vi.fn(async () => ({ error: null, data: { id: savedId } })) };
    const submit = { click: vi.fn(async () => {}), isEnabled: vi.fn(async () => true) };
    const page = { getByRole: vi.fn(() => submit) };
    const helpers = runInNewContext(transpileModule(`${helper}\n({review, save});`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      expect: (value: unknown, message?: string) => value === null || typeof value === "boolean"
        ? expect(value, message) : { toBeVisible: visible, toHaveURL: url },
      z: { string: () => ({ uuid: () => ({ parse: (value: string) => value }) }) },
    }) as {
      review(page: unknown, timeout?: number): Promise<void>;
      save(page: unknown, actor: unknown, kind: string, timeout?: number): Promise<string>;
    };
    await helpers.review(page, timeout);
    expect(visible).toHaveBeenCalledWith({ timeout });
    expect(await helpers.save(page, { from: () => query }, "strength", timeout)).toBe(savedId);
    expect(url).toHaveBeenCalledTimes(2);
    for (const [, options] of url.mock.calls) expect(options).toEqual({ timeout });
    expect(String(url.mock.calls[0]![0])).toBe(String(/\/app\/plan\?block=[0-9a-f-]{36}$/));
    expect(String(url.mock.calls[1]![0])).toBe(String(new RegExp(`/app/plan\\?block=${savedId}$`)));
    expect(query.eq).toHaveBeenCalledWith("program_kind", "strength");
    expect(query.eq).toHaveBeenCalledWith("status", "active");
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    const failure = new Error("save navigation did not settle");
    url.mockRejectedValueOnce(failure);
    await expect(helpers.save(page, { from: () => query }, "strength", timeout)).rejects.toBe(failure);
    expect(query.single).toHaveBeenCalledTimes(1);
    submit.isEnabled.mockResolvedValueOnce(false);
    await expect(helpers.save(page, { from: () => query }, "strength", timeout)).rejects.toThrow(
      "Program save is disabled; accept the required overlap or replacement consent before saving.",
    );
    expect(submit.click).toHaveBeenCalledTimes(3);
    expect(url).toHaveBeenCalledTimes(3);
    expect(query.single).toHaveBeenCalledTimes(1);
  });

  it.each(["completed", "scheduled", "wrong-date", "wrong-session"] as const)(
    "M8 DC-K4: verifies today's completed legacy commitment before explicit overlap consent (%s)", async (state) => {
      const source = readFileSync(join(webRoot, "e2e/program-builder-mobile.spec.ts"), "utf8");
      const step = source.slice(source.indexOf('stage("m8-07")'), source.indexOf('stage("m8-08")'));
      const day = "2026-09-24", sessionId = "00000000-0000-4000-8000-000000000002";
      let checked = false;
      const events: string[] = [];
      const time = {}, title = {}, submit = {};
      const notice = { locator: (selector: string) => selector === "time" ? time : title };
      const overlap = { locator: () => notice, check: async () => { checked = true; events.push("consent"); } };
      const page = { getByRole: (role: string, options: { name: string; exact: boolean }) => {
        expect(options).toEqual({ name: role === "checkbox" ? "Keep both workouts on these dates." : "Start program", exact: true });
        return role === "checkbox" ? overlap : submit;
      } };
      const save = vi.fn(async (_page: unknown, _actor: unknown, kind: string, timeout: number) => {
        expect(checked).toBe(true);
        expect([kind, timeout]).toEqual(["strength", 30_000]);
        events.push("save");
        return "saved-program";
      });
      const result = runInNewContext(transpileModule(`(async () => { ${step}\nreturn strengthId; })();`, {
        compilerOptions: { target: ScriptTarget.ES2022 },
      }).outputText, {
        stage: () => {}, today: () => day, test: { info: () => ({ timeout: 30_000 }) },
        page, actor: {}, legacy: { sessionId }, save,
        review: async () => { events.push("review"); },
        scheduleEntries: async () => [{
          id: state === "wrong-session" ? "another-session" : sessionId,
          source: "session", programId: null, date: state === "wrong-date" ? "2026-09-23" : day,
          state: state === "scheduled" ? "scheduled" : "completed", title: "Older strength workout",
        }],
        expect: (value: unknown) => {
          if (value === overlap) return {
            toBeVisible: async () => { events.push("overlap"); },
            not: { toBeChecked: async () => { expect(checked).toBe(false); events.push("unchecked"); } },
          };
          if (value === time || value === title) return {
            toHaveText: async (text: string[]) => {
              expect(text).toEqual(value === time ? [day] : ["Older strength workout"]);
              events.push(value === time ? "date" : "title");
            },
          };
          if (value === submit) return { toBeDisabled: async () => { expect(checked).toBe(false); events.push("disabled"); } };
          return expect(value);
        },
      }) as Promise<string>;
      if (state === "completed") {
        await expect(result).resolves.toBe("saved-program");
        expect(events).toEqual(["review", "overlap", "date", "title", "unchecked", "disabled", "consent", "save"]);
      } else {
        await expect(result).rejects.toThrow();
        expect(checked).toBe(false);
        expect(save).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps extended UI waits inside the existing case deadline and clears only completed M8 observations", () => {
    const source = readFileSync(join(webRoot, "e2e/program-builder-mobile.spec.ts"), "utf8");
    const m8 = source.slice(source.indexOf('legacyTest("M8 '), source.indexOf('ownedTest("M9 '));
    expect(m8).toContain('stage("m8-07"); await review(page, test.info().timeout);');
    expect(m8).toContain('await save(page, actor, "strength", test.info().timeout)');
    expect(m8.indexOf("clearNativeUiObservation();")).toBeGreaterThan(m8.indexOf("await history.close();"));
    expect(m8.indexOf("clearNativeUiObservation();")).toBeLessThan(m8.indexOf('stage("m8-07")'));
    expect(source).toContain("await expect(hybridHistory).toHaveCount(0, { timeout: test.info().timeout });");
    expect(source).toContain('await createRehabInLibrary(page, selected, "Shared rehab", actor, test.info().timeout)');
    expect(source).not.toMatch(/test\.setTimeout|test\.slow|waitForTimeout/);
    const helper = source.slice(source.indexOf("function clearNativeUiObservation("), source.indexOf("async function draftPair("));
    const annotations = [{ type: "modular-stage", description: "m8-07" }, { type: "native-ui-failure", description: "old-tab" }];
    runInNewContext(transpileModule(`${helper}\nclearNativeUiObservation();`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, { test: { info: () => ({ annotations }) } });
    expect(annotations).toEqual([{ type: "modular-stage", description: "m8-07" }]);
  });

  it("rejects malformed, duplicate, oversized and unbounded diagnostic annotations", () => {
    const stage = { type: "modular-stage", description: "m3-01" };
    for (const value of [null, {}, "private-value", [stage, stage], Array(129).fill(stage),
      [{ ...stage, description: "m3-17" }], [{ ...stage, description: "private-value" }],
      [{ ...stage, description: 3 }], [{ ...stage, description: "m4-25" }]]) {
      expect(readModularAnnotations(value)).toEqual({ stage: "unavailable", loggedIndices: "unavailable" });
    }
    for (const value of ["[1,2,3]", "[1,2,3,4,0]", "[1,2,3,5]", "[-1,2,3,4]", "[1, 2,3,4]",
      "[1,2,3,4]\n", "[1,2,3,4]private-value", "[1,2,3,null]", "[1,2,3,4.0]", [1, 2, 3, 4], null]) {
      expect(readModularAnnotations([stage, { type: "modular-set-indices", description: value }]))
        .toEqual({ stage: "m3-01", loggedIndices: "unavailable" });
    }
    const indices = { type: "modular-set-indices", description: "[0,1,2,4]" };
    expect(readModularAnnotations([stage, indices, indices]).loggedIndices).toBe("unavailable");
    expect(readModularAnnotations([stage, indices]).loggedIndices).toEqual([0, 1, 2, 4]);
    expect(readModularAnnotations([stage, { ...indices, description: "invalid" }]).loggedIndices).toBe("invalid");
  });

  it("accepts only the complete declared modular cohort without changing the historical cohort", () => {
    const fixture = report(paths, MODULAR_BROWSER_CASES);
    expect(validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, MODULAR_BROWSER_CASES))
      .toMatchObject({ success: true, counts: { expected: 18, unexpected: 0, flaky: 0, skipped: 0 },
        cases: MODULAR_BROWSER_CASES.map((item) => ({ ...item, status: "passed", attempts: 1 })) });
    expect(() => validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot)).toThrow();
    expect(() => validateSwimBrowserReport(JSON.stringify(report()), paths, webRoot, MODULAR_BROWSER_CASES)).toThrow();
    expect(() => validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, [])).toThrow();
  });

  it.each([{ cases: MODULAR_BROWSER_CASES }, { cases: SWIM_BROWSER_CASES }])("retains completed, interrupted and not-run cases as failure-only global-timeout evidence %#", ({ cases }) => {
    const fixture = report(paths, cases);
    const specs = fixture.suites.flatMap((suite) => suite.suites[0]!.specs);
    specs.forEach((spec, index) => {
      const test = spec.tests[0]!;
      if (index < 2) test.results[0]!.duration = 12_000 + index;
      else if (index === 2) {
        spec.ok = false; test.status = "unexpected";
        test.results[0]!.status = "interrupted"; test.results[0]!.duration = 29_100;
      } else {
        spec.ok = false; test.status = "skipped"; test.results = [];
      }
    });
    fixture.stats = { expected: 2, unexpected: 1, flaky: 0, skipped: cases.length - 3 };
    Object.assign(fixture, { errors: [{ message: "private-global-timeout", stack: "private-stack" }] });
    let caught: unknown;
    try { validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, cases); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    const ledger = projectBrowserFailure(caught);
    expect(ledger).toMatchObject({ success: false, code: "browser-failed", counts: fixture.stats });
    expect(ledger.cases).toHaveLength(cases.length);
    expect(ledger.cases?.map((entry) => entry.title)).toEqual(cases.map((entry) => entry.title));
    expect(ledger.cases?.slice(0, 3)).toMatchObject([
      { status: "passed", attempts: 1, durationMs: 12_000 },
      { status: "passed", attempts: 1, durationMs: 12_001 },
      { status: "interrupted", attempts: 1, durationMs: 29_100 },
    ]);
    for (const entry of ledger.cases!.slice(3)) {
      expect(entry).toMatchObject({ status: "not-run", testStatus: "skipped", attempts: 0, durationMs: null });
      expect(entry).not.toHaveProperty("failureDetails");
    }
    expect(JSON.stringify(ledger)).not.toContain("private-");
    fixture.stats = { expected: cases.length, unexpected: 0, flaky: 0, skipped: 0 };
    fixture.errors = [];
    expect(() => validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, cases)).toThrow();
  });

  it.each(["missing", "duplicate", "extra", "skipped", "retry", "failure", "wrong-title"])
  ("refuses a modular %s instead of accepting a partial journey", (mode) => {
    const fixture = report(paths, MODULAR_BROWSER_CASES);
    const specs = fixture.suites[0]!.suites[0]!.specs;
    const first = specs[0]!, test = first.tests[0]!, result = test.results[0]!;
    if (mode === "missing") specs.pop();
    if (mode === "duplicate") specs[1] = structuredClone(first);
    if (mode === "extra") specs.push(structuredClone(first));
    if (mode === "skipped") { test.status = "skipped"; result.status = "skipped"; }
    if (mode === "retry") test.results.push({ ...result, retry: 1 });
    if (mode === "failure") { first.ok = false; test.status = "unexpected"; result.status = "failed"; }
    if (mode === "wrong-title") first.title = "An unrelated case";
    expect(() => validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot, MODULAR_BROWSER_CASES)).toThrow();
  });
});

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
      index === 5 ? [unavailableAlert("a2-post-start"), unavailableAlert("a2-edit")] :
        index === 9 ? [unavailableAlert("c2-auth-absence")] :
          index === 20 ? [unavailableAlert("a3-finish"), unavailableAlert("a3-finish-transport")] :
            index === 21 ? [unavailableAlert("a4-replay"), unavailableAlert("a4-replay-transport")] :
              index === 23 ? [unavailableAlert("a7-finish"), unavailableAlert("a7-finish-transport")] : [];
}

describe("DC-SW8 failure-only C2 Auth absence", () => {
  it.each([
    [null, { status: 404 }, "reached"],
    [{ id: "private-primary" }, null, "not-reached"],
    [{ id: "private-other" }, null, "unavailable"],
    [{ id: "private-primary" }, { status: 404 }, "unavailable"],
    [null, null, "unavailable"],
    [null, { status: 500 }, "unavailable"],
    [null, { status: "404" }, "unavailable"],
    [null, {}, "unavailable"],
    [null, undefined, "unavailable"],
    [undefined, { status: 404 }, "unavailable"],
    [{}, null, "unavailable"],
    [{ id: null }, null, "unavailable"],
    [{ id: 1 }, null, "unavailable"],
    [{ id: "private-primary" }, undefined, "unavailable"],
    [[], null, "unavailable"],
    [null, [], "unavailable"],
    ["private-primary", null, "unavailable"],
    [null, new Error("private-read-error"), "unavailable"],
  ])("classifies only exact absence or exact presence %#", (user, error, backend) => {
    expect(authAbsenceBackend(user, error, "private-primary")).toBe(backend);
  });
  it("rejects missing identity and getter read failures without exposing them", () => {
    for (const id of [undefined, null, "", {}, 1]) {
      expect(authAbsenceBackend(null, { status: 404 }, id)).toBe("unavailable");
      expect(authAbsenceBackend({ id }, null, id)).toBe("unavailable");
    }
    expect(authAbsenceBackend({
      get id() { throw new Error("private-id"); },
    }, null, "private-primary")).toBe("unavailable");
    expect(authAbsenceBackend(null, {
      get status() { throw new Error("private-status"); },
    }, "private-primary")).toBe("unavailable");
  });
  it("never accesses any user or error property except id or status, including message and metadata", () => {
    const forbidden = vi.fn(() => { throw new Error("private-getter"); });
    const guarded = (allowed: string, value: unknown) => new Proxy({
      message: "private-message", metadata: "private-metadata", user_metadata: "private-user-data",
      app_metadata: "private-app-data", email: "private-email",
    }, {
      get: (_target, property) => property === allowed ? value : forbidden(),
      ownKeys: forbidden,
      getOwnPropertyDescriptor: forbidden,
    });
    for (const [user, error, backend] of [
      [null, guarded("status", 404), "reached"],
      [guarded("id", "private-primary"), null, "not-reached"],
      [guarded("id", "private-other"), null, "unavailable"],
      [guarded("id", "private-primary"), guarded("status", 404), "unavailable"],
      [null, guarded("status", 503), "unavailable"],
    ] as const) {
      const classified = authAbsenceBackend(user, error, "private-primary");
      expect(classified).toBe(backend);
      const annotation = alertAnnotation({ ...unavailableAlert("c2-auth-absence"), backend: classified })!;
      expect(JSON.stringify(annotation)).not.toMatch(/private-|message|metadata|email/);
    }
    expect(forbidden).not.toHaveBeenCalled();
  });
  it.each(["reached", "not-reached", "unavailable"] as const)(
    "round-trips only backend=%s at C2 with the unchanged strict protocol", (backend) => {
      const value = { ...unavailableAlert("c2-auth-absence"), backend };
      const annotation = alertAnnotation(value)!;
      expect(annotation.type).toBe("hta-swim-alert-membership-v2");
      expect(annotation.description).toBe(
        `point=c2-auth-absence;category=unavailable;backend=${backend};revision=unavailable;control=unavailable;result=unavailable`,
      );
      expect(annotation.description.length).toBeLessThanOrEqual(160);
      const parsed = readAlertAnnotations(Array(16).fill(annotation));
      expect(parsed).toEqual([value]);
      expect(projectAlertObservations(9, parsed)).toEqual([value]);
      expect(readAlertAnnotations(Array(17).fill(annotation))).toBeUndefined();
      for (const index of SWIM_BROWSER_CASES.keys()) {
        if (index !== 9) expect(projectAlertObservations(index, parsed)).toEqual(unavailableObservations(index));
      }
      for (const [field, forbidden] of [
        ["category", "absent"], ["revision", "advanced"], ["control", "none"], ["result", "none"],
      ]) {
        expect(alertAnnotation({ ...value, [field!]: forbidden })).toBeUndefined();
        expect(readAlertAnnotations([{
          ...annotation, description: annotation.description.replace(`${field}=unavailable`, `${field}=${forbidden}`),
        }])).toBeUndefined();
      }
      for (const invalid of [
        { ...annotation, raw: "private-data" },
        { ...annotation, description: `${annotation.description};raw=private-data` },
        { ...annotation, description: `${annotation.description};point=c2-auth-absence` },
        { ...annotation, description: annotation.description.replace("c2-auth-absence", "c2-other") },
        { ...annotation, description: annotation.description.replace(`backend=${backend}`, "backend=private-data") },
        { ...annotation, description: "x".repeat(161) },
        { ...annotation, description: annotation.description.replace("control=unavailable;result=unavailable",
          "result=unavailable;control=unavailable") },
      ]) {
        expect(readAlertAnnotations([invalid])).toBeUndefined();
        expect(projectAlertObservations(9, readAlertAnnotations([invalid]))).toEqual([unavailableAlert("c2-auth-absence")]);
      }
      const conflict = alertAnnotation({ ...value, backend: backend === "reached" ? "not-reached" : "reached" })!;
      expect(readAlertAnnotations([annotation, conflict])).toBeUndefined();
      expect(readAlertAnnotations([{
        type: "ignored", get description() { throw new Error("private-description"); },
      }, annotation])).toEqual([value]);
    },
  );
  it("owns one abort-aware read only after the unchanged URL assertion fails, preserving the same error", () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-account-mobile.spec.ts"), "utf8");
    const c2 = source.slice(source.indexOf('test("C2 DC-SW8:'));
    const observation = c2.slice(c2.indexOf("await accountPage(page, primary);"), c2.indexOf("expect((await context.cookies())"));
    const ordered = [
      'await page.getByRole("button", { name: "Delete account", exact: true }).click();',
      "try {", 'await expect(page).toHaveURL(new URL("/?deleted=1", baseURL!).href);',
      "} catch (error) {", "try {", 'const diagnostic = unavailableAlert("c2-auth-absence");',
      "const controller = new AbortController();", "const deadline = performance.now() + 1000;",
      'testInfo.status === "timedOut"', 'testInfo.status === "interrupted" || page.isClosed()',
      "const active = () => !controller.signal.aborted && !interrupted() && performance.now() < deadline;",
      "const expiry = setTimeout(() => controller.abort(), 1000);", "try {", "if (active()) {",
      "createClient(seedConfig.supabaseUrl, seedConfig.serviceRoleKey,",
      "auth: { persistSession: false, autoRefreshToken: false }",
      "return await fetch(input, { ...init, signal: controller.signal });",
      "catch { return new Response(null, { status: 503 }); }",
      "const sample = await observer.auth.admin.getUserById(primary.userId);",
      "if (active()) diagnostic.backend = authAbsenceBackend(sample.data.user, sample.error, primary.userId);",
      "} catch {", 'diagnostic.backend = "unavailable";', "} finally {",
      "controller.abort();", "clearTimeout(expiry);",
      'if (interrupted() || performance.now() >= deadline) diagnostic.backend = "unavailable";',
      "const annotation = alertAnnotation(diagnostic);", "if (annotation) testInfo.annotations.push(annotation);",
      "} catch {", "throw error;",
    ];
    let position = -1;
    for (const part of ordered) {
      const next = observation.indexOf(part, position + 1);
      expect(next, part).toBeGreaterThan(position);
      position = next;
    }
    expect(observation.match(/getUserById\(/g)).toHaveLength(1);
    expect(observation.match(/\.click\(/g)).toHaveLength(1);
    expect(observation.match(/toHaveURL\(/g)).toHaveLength(1);
    expect(observation).not.toMatch(/Promise\.race|expect\.poll|signOut|deleteUser|cleanup|\.goto|\.reload|\.close\(|setInterval|timeout:|console\.|JSON\.|\.message|\.metadata/);
    expect(observation.match(/page\.url\(\)/g)).toHaveLength(1);
    expect(observation).toContain('if (diagnostic.backend === "not-reached" && active())');
    expect(observation).not.toMatch(/next-action|\.headers\(|\.postData|\.body\(|\.text\(|\.json\(|\.finished\(|\.route\(|removeAllListeners/);
    for (const [event, callback] of [["request", "onRequest"], ["response", "onResponse"], ["requestfailed", "onRequestFailed"]]) {
      expect(observation).toContain(`page.on("${event}", ${callback})`);
      expect(observation).toContain(`page.off("${event}", ${callback})`);
    }
    expect(c2).toContain("const deleted = await admin.auth.admin.getUserById(primary.userId);");
    expect(c2).toContain("await assertNativeGone(admin, own);");
    expect(c2).toContain("await assertCustomGone(admin, primary.userId, custom);");
  });
  it.each([
    "success", "absent", "present", "wrong-user", "malformed", "read-error", "timeout", "late",
    "interrupted", "timedOut", "closed", "already-interrupted", "already-timedOut", "already-closed",
    "client-error", "annotation-error",
  ])("executes the source observation with the official SDK and no network: %s", async (mode) => {
    const source = readFileSync(join(webRoot, "e2e/swimming-account-mobile.spec.ts"), "utf8");
    const c2 = source.slice(source.indexOf('test("C2 DC-SW8:'));
    const block = c2.slice(c2.indexOf("await accountPage(page, primary);"), c2.indexOf("expect((await context.cookies())"));
    const original = new Error("original-url-assertion");
    const privateRead = new Proxy({}, { get() { throw new Error("private-read-getter"); } });
    const primary = { userId: "11111111-1111-4111-8111-111111111111" };
    const testInfo = { status: mode === "already-interrupted" ? "interrupted" :
      mode === "already-timedOut" ? "timedOut" : "passed", annotations: [] as unknown[] };
    let closed = mode === "already-closed";
    let now = 0;
    let expire = () => {};
    let signal: AbortSignal | undefined;
    let settled = false;
    const timer = vi.fn((callback: () => void) => { expire = callback; return 1; });
    const clear = vi.fn();
    const transport = vi.fn(async (_input: unknown, init: RequestInit) => {
      signal = init.signal!;
      try {
        if (mode === "read-error") throw privateRead;
        if (mode === "timeout") {
          return await new Promise<Response>((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(privateRead), { once: true });
            now = 1000;
            expire();
          });
        }
        if (mode === "late") now = 1001;
        if (mode === "interrupted" || mode === "timedOut") testInfo.status = mode;
        if (mode === "closed") closed = true;
        if (mode === "malformed") return new Response("private-invalid-json", { status: 200 });
        if (mode === "present" || mode === "wrong-user") {
          return Response.json({ id: mode === "present" ? primary.userId : "private-other" });
        }
        return Response.json({ msg: "private-response" }, { status: 404 });
      } finally { settled = true; }
    });
    const client = vi.fn((...args: Parameters<typeof createClient>) => {
      if (mode === "client-error") throw privateRead;
      return createClient(...args);
    });
    const annotate = vi.fn((value: unknown) => {
      if (mode === "annotation-error") throw privateRead;
      return alertAnnotation(value);
    });
    const click = vi.fn(async () => {});
    const url = vi.fn(async () => { if (mode !== "success") throw original; });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const compiled = transpileModule(`(async () => { ${block} })`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText;
    const execute = runInNewContext(compiled, {
      page: { getByRole: () => ({ click }), isClosed: () => closed,
        on: () => {}, off: () => {}, url: () => "http://127.0.0.1:3210/app/settings/account" },
      accountPage: async () => {}, primary, testInfo, baseURL: "http://127.0.0.1:3210",
      seedConfig: { supabaseUrl: "http://127.0.0.1:54321", serviceRoleKey: "synthetic-service" },
      expect: () => ({ toHaveURL: url }), createClient: client, fetch: transport,
      alertAnnotation: annotate, authAbsenceBackend, c2HttpClass, c2Location, c2Transport, unavailableAlert,
      AbortController, Response, URL, performance: { now: () => now }, setTimeout: timer, clearTimeout: clear,
    }) as () => Promise<void>;
    try {
      if (mode === "success") await expect(execute()).resolves.toBeUndefined();
      else await expect(execute()).rejects.toBe(original);
      expect(click).toHaveBeenCalledTimes(1);
      expect(url).toHaveBeenCalledTimes(1);
      expect(logged).not.toHaveBeenCalled();
      const attempted = mode !== "success" && !mode.startsWith("already-") && mode !== "client-error";
      expect(transport).toHaveBeenCalledTimes(attempted ? 1 : 0);
      if (attempted) {
        expect(settled).toBe(true);
        expect(signal?.aborted).toBe(true);
        expect(transport.mock.calls[0]![1].method).toBe("GET");
      }
      if (mode === "success") {
        expect(client).not.toHaveBeenCalled();
        expect(timer).not.toHaveBeenCalled();
        expect(annotate).not.toHaveBeenCalled();
      } else {
        expect(timer).toHaveBeenCalledWith(expect.any(Function), 1000);
        expect(clear).toHaveBeenCalledWith(1);
      }
      expect(testInfo.annotations).toEqual(mode === "success" || mode === "annotation-error" ? [] : [
        alertAnnotation({ ...unavailableAlert("c2-auth-absence"),
          backend: mode === "absent" ? "reached" : mode === "present" ? "not-reached" : "unavailable",
          ...(mode === "present" ? { control: "account-page", result: "request-unseen" } : {}) }),
      ]);
    } finally { logged.mockRestore(); }
  });
});

describe("DC-SW8 passive C2 location and response metadata", () => {
  const baseURL = "http://127.0.0.1:3210";
  const accountURL = `${baseURL}/app/settings/account`;
  const locations = ["account-page", "login-page", "home-page", "deleted-home", "other-page", "unavailable"] as const;
  const transports = ["request-unseen", "request-pending", "request-failed", "http-2xx", "http-3xx", "http-4xx", "http-5xx", "unavailable"] as const;

  it.each([
    ["/app/settings/account", "account-page"], ["/login", "login-page"],
    ["/login?next=%2Fapp#form", "login-page"], ["/", "home-page"], ["/?deleted=1", "deleted-home"],
    ["/?", "other-page"], ["/#", "other-page"], ["/?deleted=1#", "other-page"],
    ["/?deleted=1&extra=private", "other-page"], ["/?deleted=01", "other-page"],
    ["/?deleted=%31", "other-page"], ["/?deleted=1&deleted=1", "other-page"],
    ["/app/settings/account/", "other-page"], ["/app/settings/Account", "other-page"],
    ["/login-extra", "other-page"], ["/log%69n", "other-page"],
    ["/private/../login", "other-page"], ["/private", "other-page"],
  ])("classifies a closed location without leaking its input %#", (suffix, expected) => {
    expect(c2Location(`${baseURL}${suffix}`, baseURL)).toBe(expected);
  });

  it("rejects malformed locations and never labels foreign origins as known pages", () => {
    for (const raw of [undefined, null, 1, {}, [], "/login", "bad-url", "file:///login", "javascript:void(0)", "http://["]) {
      expect(c2Location(raw, baseURL)).toBe("unavailable");
    }
    for (const raw of ["https://example.invalid/login", "http://127.0.0.1:3211/login", "https://127.0.0.1:3210/?deleted=1"]) {
      expect(c2Location(raw, baseURL)).toBe("other-page");
    }
    for (const invalidBase of [null, {}, "bad-base", `${baseURL}/other`, `${baseURL}/?q=1`]) {
      expect(c2Location(accountURL, invalidBase)).toBe("unavailable");
    }
  });

  it("classifies only valid response-header status classes and bounded primitive transport states", () => {
    for (const [status, expected] of [[200, "http-2xx"], [299, "http-2xx"], [300, "http-3xx"], [399, "http-3xx"],
      [400, "http-4xx"], [499, "http-4xx"], [500, "http-5xx"], [599, "http-5xx"]] as const) {
      expect(c2HttpClass(status)).toBe(expected);
      for (const failed of [false, true]) expect(c2Transport(1, expected, failed, false)).toBe(expected);
    }
    for (const status of [undefined, null, "200", 199, 600, 200.5, NaN, Infinity, {}]) {
      expect(c2HttpClass(status)).toBe("unavailable");
    }
    expect(c2Transport(0, null, false, false)).toBe("request-unseen");
    expect(c2Transport(1, null, false, false)).toBe("request-pending");
    expect(c2Transport(1, null, true, false)).toBe("request-failed");
    for (const args of [[2, null, false, false], [1, null, false, true], [0, "http-2xx", false, false],
      [0, null, true, false], [1, "200", false, false], [1, null, 0, false], [1, null, false, undefined],
      [NaN, null, false, false], ["1", null, false, false]] as const) {
      expect(c2Transport(args[0], args[1], args[2], args[3])).toBe("unavailable");
    }
  });

  it("keeps C2-only values exclusive to not-reached C2, with strict round-trip and size limits", () => {
    let maximum = 0;
    for (const control of locations) for (const result of transports) {
      const value = { ...unavailableAlert("c2-auth-absence"), backend: "not-reached", control, result };
      const annotation = alertAnnotation(value)!;
      expect(annotation).toBeDefined();
      maximum = Math.max(maximum, annotation.description.length);
      expect(readAlertAnnotations(Array(16).fill(annotation))).toEqual([value]);
      expect(readAlertAnnotations(Array(17).fill(annotation))).toBeUndefined();
      expect(projectAlertObservations(9, [value as ReturnType<typeof unavailableAlert>])).toEqual([value]);
      for (const backend of ["reached", "unavailable"]) {
        const allowed = control === "unavailable" && result === "unavailable";
        expect(!!alertAnnotation({ ...value, backend })).toBe(allowed);
        expect(!!readAlertAnnotations([{ ...annotation, description: annotation.description.replace("backend=not-reached", `backend=${backend}`) }])).toBe(allowed);
      }
      for (const point of ["a1-pause", "a2-post-start", "a2-edit", "c4-owner-1-start", "c4-owner-2-start"] as const) {
        if (control !== "unavailable") expect(alertAnnotation({ ...unavailableAlert(point), control })).toBeUndefined();
        if (result !== "unavailable") expect(alertAnnotation({ ...unavailableAlert(point), result })).toBeUndefined();
        if (control !== "unavailable" || result !== "unavailable") {
          expect(readAlertAnnotations([{ ...annotation, description: annotation.description.replace("c2-auth-absence", point) }])).toBeUndefined();
        }
      }
    }
    expect(maximum).toBe(127);
    expect(maximum).toBeLessThanOrEqual(160);
    const value = { ...unavailableAlert("c2-auth-absence"), backend: "not-reached", control: "login-page", result: "http-5xx" };
    const annotation = alertAnnotation(value)!;
    for (const index of SWIM_BROWSER_CASES.keys()) {
      if (index !== 9) expect(projectAlertObservations(index, readAlertAnnotations([annotation]))).toEqual(unavailableObservations(index));
    }
    expect(readAlertAnnotations([annotation, alertAnnotation({ ...value, result: "request-pending" })!])).toBeUndefined();
    for (const malformed of ["HTTP-5xx", "http-500", "request-completed", "http-2xx\nprivate"]) {
      expect(alertAnnotation({ ...value, result: malformed })).toBeUndefined();
    }
    expect(JSON.stringify(annotation)).not.toMatch(/private|127\.0|https?:|status=|user|error/);
  });

  it.each([
    ["unseen", "request-unseen"], ["native-form", "request-pending"], ["hydrated", "http-2xx"],
    ["redirect", "http-3xx"], ["client-response", "http-4xx"], ["server-response", "http-5xx"],
    ["failed", "request-failed"], ["headers-then-failed", "http-2xx"], ["failed-then-headers", "http-2xx"],
    ["unrelated", "request-unseen"], ["unrelated-with-owned", "http-2xx"],
    ["multiple-posts", "unavailable"], ["same-request-twice", "unavailable"],
    ["wrong-response-identity", "unavailable"], ["wrong-failed-identity", "unavailable"],
    ["duplicate-response", "unavailable"], ["status-invalid", "unavailable"],
    ["method-getter", "unavailable"], ["url-getter", "unavailable"], ["response-request-getter", "unavailable"],
    ["response-status-getter", "unavailable"], ["failed-method-getter", "unavailable"],
    ["method-value", "unavailable"], ["url-value", "unavailable"], ["url-malformed", "unavailable"],
    ["register-request", "unavailable"], ["register-response", "unavailable"], ["register-failed", "unavailable"],
    ["register-request-before", "unavailable"], ["register-response-before", "unavailable"], ["register-failed-before", "unavailable"],
    ["detach-request", "request-unseen"], ["detach-response", "request-unseen"], ["detach-failed", "request-unseen"],
    ["page-url-getter", "request-unseen"], ["page-url-late", "unavailable"], ["page-url-interrupted", "unavailable"],
    ["success", "request-unseen"], ["click-failure", "request-unseen"],
    ["auth-absent", "unavailable"], ["auth-unavailable", "unavailable"],
  ])("executes guarded owned listeners from source with no network: %s", async (mode, expected) => {
    const source = readFileSync(join(webRoot, "e2e/swimming-account-mobile.spec.ts"), "utf8");
    const c2 = source.slice(source.indexOf('test("C2 DC-SW8:'));
    const block = c2.slice(c2.indexOf("await accountPage(page, primary);"), c2.indexOf("expect((await context.cookies())"));
    const events = new EventEmitter();
    const eventNames = ["request", "response", "requestfailed"];
    const unrelatedListener = () => {};
    for (const event of eventNames) events.on(event, unrelatedListener);
    const original = new Error("Original assertion");
    const trap = () => { throw new Error("Private getter"); };
    const unused = vi.fn(trap);
    const request = (method = "POST", url = accountURL) => ({
      method: () => method, url: () => url,
      headers: unused, allHeaders: unused, postData: unused, postDataJSON: unused, failure: unused,
    });
    const owned = request();
    const response = (paired: unknown = owned, status = 200) => ({
      request: () => paired, status: () => status,
      headers: unused, body: unused, text: unused, json: unused, finished: unused,
    });
    const primary = { userId: "private-primary" };
    let now = 0;
    const testInfo = { status: "passed", annotations: [] as unknown[] };
    const getUserById = vi.fn(async () => mode === "auth-absent"
      ? { data: { user: null }, error: { status: 404 } }
      : mode === "auth-unavailable" ? { data: { user: null }, error: null }
        : { data: { user: { id: primary.userId } }, error: null });
    const on = vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (event === ({ "register-request-before": "request", "register-response-before": "response", "register-failed-before": "requestfailed" } as Record<string, string>)[mode]) trap();
      events.on(event, callback);
      if (event === ({ "register-request": "request", "register-response": "response", "register-failed": "requestfailed" } as Record<string, string>)[mode]) trap();
    });
    const off = vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      events.off(event, callback);
      if (event === ({ "detach-request": "request", "detach-response": "response", "detach-failed": "requestfailed" } as Record<string, string>)[mode]) trap();
    });
    const location = vi.fn(() => {
      if (mode === "page-url-getter") return trap();
      if (mode === "page-url-late") now = 1001;
      if (mode === "page-url-interrupted") testInfo.status = "interrupted";
      return accountURL;
    });
    const click = vi.fn(async () => {
      if (mode === "click-failure") throw original;
      const emitting = [
        "native-form", "hydrated", "redirect", "client-response", "server-response", "failed", "headers-then-failed",
        "failed-then-headers", "multiple-posts", "same-request-twice", "wrong-response-identity", "wrong-failed-identity",
        "duplicate-response", "status-invalid", "response-status-getter", "unrelated-with-owned",
      ];
      if (emitting.includes(mode)) events.emit("request", owned);
      if (["hydrated", "headers-then-failed", "duplicate-response", "unrelated-with-owned"].includes(mode)) events.emit("response", response());
      if (mode === "redirect") events.emit("response", response(owned, 303));
      if (mode === "client-response") events.emit("response", response(owned, 403));
      if (mode === "server-response") events.emit("response", response(owned, 503));
      if (["failed", "headers-then-failed", "failed-then-headers"].includes(mode)) events.emit("requestfailed", owned);
      if (mode === "failed-then-headers") events.emit("response", response());
      if (mode === "multiple-posts") events.emit("request", request());
      if (mode === "same-request-twice") events.emit("request", owned);
      if (mode === "wrong-response-identity") events.emit("response", response(request()));
      if (mode === "wrong-failed-identity") events.emit("requestfailed", request());
      if (mode === "duplicate-response") events.emit("response", response());
      if (mode === "status-invalid") events.emit("response", response(owned, 0));
      if (mode === "method-getter") events.emit("request", { get method() { return trap(); } });
      if (mode === "method-value") events.emit("request", { method: () => 1 });
      if (mode === "url-value") events.emit("request", { method: () => "POST", url: () => null });
      if (mode === "url-malformed") events.emit("request", request("POST", "malformed-url"));
      if (mode === "url-getter") events.emit("request", { method: () => "POST", url: trap });
      if (mode === "response-request-getter") events.emit("response", { request: trap });
      if (mode === "response-status-getter") events.emit("response", { request: () => owned, get status() { return trap(); } });
      if (mode === "failed-method-getter") events.emit("requestfailed", { method: trap });
      if (mode === "unrelated" || mode === "unrelated-with-owned") {
        for (const other of [request("GET"), request("POST", `${baseURL}/unrelated`), request("POST", `${accountURL}?other=1`)]) {
          events.emit("request", other);
          events.emit("response", { request: () => other, status: unused });
          events.emit("requestfailed", other);
        }
      }
    });
    const urlAssertion = vi.fn(async () => { if (mode !== "success") throw original; });
    const compiled = transpileModule(`(async () => { ${block} })`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
    const execute = runInNewContext(compiled, {
      page: { on, off, getByRole: () => ({ click }), isClosed: () => false, url: location },
      accountPage: async () => {}, primary, testInfo, baseURL,
      seedConfig: {}, createClient: () => ({ auth: { admin: { getUserById } } }),
      expect: () => ({ toHaveURL: urlAssertion }), alertAnnotation, authAbsenceBackend, c2HttpClass, c2Location, c2Transport, unavailableAlert,
      AbortController, URL, performance: { now: () => now }, setTimeout: () => 1, clearTimeout: () => {},
    }) as () => Promise<void>;
    if (mode === "success") await expect(execute()).resolves.toBeUndefined();
    else await expect(execute()).rejects.toBe(original);
    expect(click).toHaveBeenCalledOnce();
    expect(urlAssertion).toHaveBeenCalledTimes(mode === "click-failure" ? 0 : 1);
    expect(on.mock.calls.map(([event]) => event)).toEqual(eventNames);
    expect(off.mock.calls).toEqual(on.mock.calls);
    for (const event of eventNames) expect(events.listeners(event)).toEqual([unrelatedListener]);
    expect(unused).not.toHaveBeenCalled();
    if (mode === "success" || mode === "click-failure") {
      expect(getUserById).not.toHaveBeenCalled();
      expect(location).not.toHaveBeenCalled();
      expect(testInfo.annotations).toEqual([]);
    } else {
      expect(getUserById).toHaveBeenCalledOnce();
      const unavailable = ["auth-unavailable", "page-url-late", "page-url-interrupted"].includes(mode);
      const backend = mode === "auth-absent" ? "reached" : unavailable ? "unavailable" : "not-reached";
      expect(testInfo.annotations).toEqual([alertAnnotation({
        ...unavailableAlert("c2-auth-absence"), backend,
        control: backend !== "not-reached" || mode === "page-url-getter" ? "unavailable" : "account-page",
        result: expected,
      })]);
      expect(location).toHaveBeenCalledTimes(mode.startsWith("auth-") ? 0 : 1);
    }
  });
});

describe("browser environment and static config", () => {
  it("B9 DC-SW5/DC-SW7/DC-SW8: pins the reviewed current-UI B cohort and decodes actual pinned decision arguments without diagnostics", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-decisions-offline-mobile.spec.ts"), "utf8").replaceAll("\r\n", "\n");
    const boundary = source.indexOf('\n  test("B9 ');
    expect(boundary).toBeGreaterThan(0);
    const prefix = source.slice(source.indexOf("const test ="), boundary).trimEnd();
    expect(createHash("sha256").update(prefix).digest("hex")).toBe("94a7e2abff4d0cd5d76a58cf10af152431cc661efa4e1df77ef244ab6794965e");
    const b9 = source.slice(boundary);
    expect(b9.match(/\btest\("/g)).toHaveLength(1);
    expect(b9).not.toMatch(/annotations|testInfo|alertAnnotation|waitForTimeout|force:\s*true|\.rpc\(/);
    expect(b9).not.toMatch(/\b(?:decideSwimProposal|previewSwimResume|resumeSwimPlan)\(/);
    const helper = b9.slice(b9.indexOf("      function submittedArguments("), b9.indexOf("      async function race("));
    const decode = runInNewContext(transpileModule(`${helper}\nsubmittedArguments`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, { JSON }) as (request: { postData(): string }) => unknown[];
    const installed = createRequire(join(webRoot, "package.json"));
    expect(installed("next/package.json").version).toBe("16.2.6");
    expect(installed("react/package.json").version).toBe("19.2.4");
    vi.stubGlobal("__webpack_require__", { u: vi.fn(() => { throw new Error("Unexpected chunk load."); }) });
    let encodeReply: (args: unknown[]) => Promise<string | FormData>;
    try {
      ({ encodeReply } = installed("next/dist/compiled/react-server-dom-webpack/client.browser"));
    } finally { vi.unstubAllGlobals(); }
    const { plan, workouts } = swimFixture();
    const preview = {
      planId: plan.id, revision: plan.revision, startDate: "2026-09-17",
      dates: workouts.map((row) => ({ id: row.id, revision: row.revision, date: row.scheduled_date })),
      scheduleRevision: 1, overlaps: [],
    };
    for (const args of [[plan.id, plan.revision, receiptId, "accepted"],
      [plan.id, plan.revision, preview.startDate], [preview, false]]) {
      const encoded = await encodeReply(args);
      expect(typeof encoded).toBe("string");
      expect(isDeepStrictEqual(decode({ postData: () => encoded as string }), args)).toBe(true);
    }
    expect(() => decode({ postData: () => '{"private":"not-an-argument-array"}' }))
      .toThrow("Could not read the synthetic decision submission.");
    expect(() => decode({ postData: () => "private-malformed-body" }))
      .toThrow("Could not read the synthetic decision submission.");
  });

  it("A3 DC-SW7: waits for each selected destination before reloading and verifies it afterward", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const start = source.indexOf('for (const status of ["Archived", "Active"] as const)');
    const block = source.slice(start, source.indexOf('if (status === "Archived")', start));
    let current = "http://127.0.0.1:3000/app/swim?plan=new";
    let pending: string | undefined;
    let selectedChecked = false;
    const reloads: string[] = [];
    const page = {
      url: () => current,
      reload: async () => {
        expect(pending).toBeUndefined();
        expect(selectedChecked).toBe(true);
        reloads.push(current);
        selectedChecked = false;
      },
      getByRole: (_role: string, options: { name: string }) => options.name === "Program history" ? {
        locator: () => ({}),
        getByRole: (_role: string, options?: { name: RegExp }) => {
          const id = options?.name.test("Archived") ? "old" : "new";
          return { id, click: async () => { pending = `http://127.0.0.1:3000/app/swim?plan=${id}`; } };
        },
      } : {},
    };
    const execute = runInNewContext(transpileModule(`(async () => { ${block} } })`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      page, original: { planId: "old" }, replacementId: "new", URL, openSwimProgramHistory: async () => {},
      expect: (value: unknown) => ({
        toBe: (expected: unknown) => expect(value).toBe(expected),
        toHaveCount: async () => {},
        toHaveURL: async (destination: string) => {
          if (pending) { current = pending; pending = undefined; }
          expect(current).toBe(destination);
        },
        toHaveAttribute: async (name: string, expected: string) => {
          const id = (value as { id: string }).id;
          if (name === "href") expect(expected).toBe(`/app/swim?plan=${id}`);
          else {
            expect(new URL(current).searchParams.get("plan")).toBe(id);
            expect(expected).toBe("page");
            selectedChecked = true;
          }
        },
      }),
    }) as () => Promise<void>;
    await execute();
    expect(reloads).toEqual(["http://127.0.0.1:3000/app/swim?plan=old", "http://127.0.0.1:3000/app/swim?plan=new"]);
  });

  it("E1 DC-SW1/DC-SW6: actual analytics fixture retains native observations and records changed-pool consent and reason", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-persistence-mobile.spec.ts"), "utf8");
    const helper = source.slice(source.indexOf("async function arrangeAnalytics("), source.indexOf("async function analyticsState("));
    const scenario = source.slice(source.indexOf('test("E1 '), source.indexOf('test("E2 '));
    const block = scenario.slice(scenario.indexOf("const observations:"), scenario.indexOf("const before ="));
    const actions = readFileSync(join(webRoot, "src/lib/swim/actions.ts"), "utf8");
    const constructor = actions.slice(actions.indexOf("function resultFromForm("), actions.indexOf("function setupConflict("));
    const resultFromForm = runInNewContext(transpileModule(`${constructor}\nresultFromForm`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, { poolCourseEquals, SwimActionError: Error }) as (
      fields: ReturnType<typeof parseActualForm>, workout: SwimWorkoutRow,
    ) => SwimActualResult;
    const { workouts } = swimFixture();
    let arranged: SwimWorkoutRow[] = [];
    const completions: SwimActualResult[] = [];
    const execute = runInNewContext(transpileModule(`${helper}\n(async () => { ${block} })`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      actor: {}, today: "2026-09-10", addDaysToYmd, mondayOfYmd, generateSwimPlan,
      SWIM_GENERATOR_VERSION, standaloneWeekRequests, randomUUID: () => receiptId,
      createSwimPlan: async (_client: unknown, input: Parameters<typeof import("../storage").createSwimPlan>[1]) => {
        expect(input.state.observations).toHaveLength(2);
        expect(input.state.acceptedCalibration).toBeNull();
        for (const observation of input.state.observations) {
          expect(observation.verified).toBe(false);
          expect(observation.trials.map((trial) => trial.lengths * observation.course.numerator))
            .toEqual(observation.trials.map((trial) => trial.distance * observation.course.denominator));
        }
        arranged = input.workouts.map((workout, index) => ({ ...workouts[index]!, ...workout }));
        return { workouts: arranged };
      },
      startSwimWorkout: async (_client: unknown, id: string) => arranged.find((workout) => workout.id === id),
      completeSwimWorkout: async (_client: unknown, input: Parameters<typeof import("../storage").completeSwimWorkout>[1]) => {
        const result = input.result;
        expect(validateSwimActualResult(result)).toEqual([]);
        const workout = arranged.find((row) => row.id === input.workoutId)!;
        const changed = !poolCourseEquals(result.snapshot.course, workout.definition.issued.snapshot.course);
        if (changed) {
          expect(input.allowChangedCourse).toBe(true);
          const form = new FormData();
          for (const [key, value] of Object.entries({
            workoutId: workout.id, sessionId, expectedRevision: "1", stroke: "planned",
            lengths: String(result.lengths), timeMs: String(result.timeMs), rpe: String(result.rpe),
            pool: "25yd", confirmPool: "on",
          })) form.set(key, value);
          const fields = parseActualForm(form);
          expect(() => resultFromForm(fields, workout)).toThrow();
          fields.reason = result.provenance.deviationReason ?? "";
          const canonical = resultFromForm(fields, workout);
          expect(canonical.provenance.deviationReason).toBe(result.provenance.deviationReason);
          expect(canonical.snapshot.calibration).toBeNull();
        }
        completions.push(result);
      },
    }) as () => Promise<void>;
    await execute();
    expect(completions.map((result) => [result.snapshot.course.unit, result.lengths, result.timeMs]))
      .toEqual([["m", 8, 420000], ["yd", 16, 420000], ["m", 8, 420000]]);
  });

  it.each([7, 8, 9, 10, 11, 12, 13])("DC-SW3/DC-SW7/DC-SW8/DC-SW9: A3/A4 complete issued lengths, not the partial literal16, for start-day %d", (day) => {
    const today = `2026-09-${String(day).padStart(2, "0")}`;
    const actions = readFileSync(join(webRoot, "src/lib/swim/actions.ts"), "utf8");
    const resultSource = actions.slice(actions.indexOf("function resultFromForm("), actions.indexOf("function setupConflict("));
    const resultFromForm = runInNewContext(transpileModule(`${resultSource}\nresultFromForm`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, { poolCourseEquals }) as (
      fields: ReturnType<typeof parseActualForm>, workout: SwimWorkoutRow,
    ) => SwimActualResult;
    const { plan, workouts, history } = swimFixture();
    for (const pool of ["25yd", "50m"]) {
      const setup = new FormData();
      for (const [key, value] of Object.entries({
        goal: "base", experience: "beginner", pool, comfortableLengths: "4",
        timeBudgetMinutes: "30", weeks: "2", startDate: today, strokes: "freestyle",
      })) setup.set(key, value);
      setup.append("weekdays", "1");
      setup.append("weekdays", "4");
      const input = parseSetupForm(setup);
      expect(input.observation).toBeNull();
      const generated = generateSwimPlan({
        setup: input.setup, calibration: null,
        weeks: standaloneWeekRequests(input.startDate, input.weeks, input.weekdays),
      });
      if (!generated.ok) throw new Error("Canonical lifecycle fixture setup failed.");
      const slots = generated.value.weeks.flatMap((week) => week.slots);
      expect(slots).toHaveLength(4);
      for (const slot of slots) {
        if (slot.kind !== "workout") throw new Error("Lifecycle fixture requires issued workouts.");
        expect(validateSwimWorkout(slot.issued)).toEqual([]);
        expect(slot.issued.budget.minutes).toBe(30);
        expect(slot.issued.snapshot.calibration).toBeNull();
      }
      const first = slots[0]!;
      if (first.kind !== "workout") throw new Error("Lifecycle fixture requires a first workout.");
      if (pool === "50m") continue;
      const workout: SwimWorkoutRow = {
        ...workouts[0]!, session_id: sessionId, status: "started", revision: 2,
        definition: { ...workouts[0]!.definition, issued: first.issued },
      };
      const form = new FormData();
      for (const [key, value] of Object.entries({
        workoutId: workout.id, sessionId, clientLogId: receiptId, expectedRevision: "2",
        lengths: "16", timeMs: "900000", rpe: "6", stroke: "breaststroke",
      })) form.set(key, value);
      expect(resultFromForm(parseActualForm(form), workout).completion).toBe("partial");
      form.set("lengths", String(first.issued.totalLengths));
      const result = resultFromForm(parseActualForm(form), workout);
      expect(result.completion).toBe("completed");
      expect([result.lengths, result.timeMs, result.rpe]).toEqual([first.issued.totalLengths, 900000, 6]);
      expect([...result.snapshot.strokes]).toEqual(["breaststroke"]);
      expect(poolCourseEquals(result.snapshot.course, first.issued.snapshot.course)).toBe(true);
      const archived = {
        ...plan, status: "archived" as const,
        state: { ...plan.state, lifecycle: [{
          from: "active" as const, to: "archived" as const, recordedAt: `${today}T12:00:00Z`,
        }] },
      };
      for (const [completedAt, late] of [[`${today}T11:59:59Z`, false], [`${today}T12:00:00Z`, true]] as const) {
        const row = { ...history[0]!, workout: { ...workout, status: "completed" as const }, result, completedAt };
        const settled = settledSwimResult(row, archived);
        expect(settled.lifecycle.archivedLate).toBe(late);
        expect(countsTowardHistory(settled)).toBe(true);
        expect(countsTowardAdherence(settled)).toBe(true);
        expect(countsTowardProgression(settled)).toBe(!late);
        expect(settled.actualMs).toBe(900000);
        expect(deriveSwimWeekCandidate(archived, [row], today)).toBeNull();
      }
    }
  });
  it.each([7, 8, 9, 10, 11, 12, 13])("DC-SW1/DC-SW2/DC-SW3: B6–B8 canonical fixtures remain valid for start-day %d without a browser or database", (day) => {
    const today = `2026-09-${String(day).padStart(2, "0")}`;
    for (const scenario of ["short", "impossible", "guidance"]) {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        pool: "50m", goal: "endurance", experience: scenario === "guidance" ? "beginner" : "regular",
        comfortableLengths: scenario === "guidance" ? "0" : "12",
        timeBudgetMinutes: "10", weeks: "2", startDate: today, weekdays: "1",
      })) form.append(key, value);
      if (scenario !== "guidance") {
        for (const [key, value] of Object.entries({
          strokes: "freestyle", time200: scenario === "short" ? "4:00" : "16:00",
          time400: scenario === "short" ? "8:30" : "34:00", benchmarkDate: today,
          benchmarkStroke: "freestyle", verified: "on",
        })) form.append(key, value);
      }
      const input = parseSetupForm(form);
      const assessed = input.observation ? estimateCriticalSwimSpeed(input.observation) : null;
      if (assessed && !assessed.ok) throw new Error("Canonical fixture assessment failed.");
      const calibration = assessed?.ok ? assessed.value : null;
      const weeks = standaloneWeekRequests(input.startDate, input.weeks, input.weekdays);
      expect(weeks.flatMap((week) => week.slots)).toHaveLength(2);
      expect(weeks.every((week) => week.slots.every((slot) => slot.dateISO >= today))).toBe(true);
      const generated = generateSwimPlan({ setup: input.setup, calibration, weeks });
      if (!generated.ok) throw new Error("Canonical fixture setup failed.");
      const slots = generated.value.weeks.flatMap((week) => week.slots);
      if (scenario === "guidance") {
        expect(input.observation).toBeNull();
        expect(calibration).toBeNull();
        expect(input.setup.knownStrokes).toHaveLength(0);
        expect(slots.every((slot) => slot.kind === "guidance" && slot.guidance.steps.length > 0)).toBe(true);
        continue;
      }
      expect(calibration !== null).toBe(true);
      form.set("timeBudgetMinutes", scenario === "short" ? "60" : "20");
      const corrected = parseSetupForm(form);
      expect(isDeepStrictEqual(corrected, {
        ...input, setup: { ...input.setup, sessionBudgetMinutes: scenario === "short" ? 60 : 20 },
      })).toBe(true);
      const larger = generateSwimPlan({ setup: corrected.setup, calibration, weeks });
      if (!larger.ok) throw new Error("Canonical fixture correction failed.");
      const references = larger.value.weeks.flatMap((week) => week.slots);
      for (const [index, slot] of slots.entries()) {
        const reference = references[index]!;
        if (reference.kind !== "workout") throw new Error("Canonical fixture correction must produce workouts.");
        expect(validateSwimWorkout(reference.issued).length).toBe(0);
        expect(reference.issued.budget.accountedMs).toBeLessThanOrEqual(corrected.setup.sessionBudgetMinutes * 60_000);
        expect(reference.issued.estimatedMs).toBe(reference.issued.budget.accountedMs);
        if (scenario === "impossible") {
          if (slot.kind !== "conflict") throw new Error("Canonical fixture must exceed the minimum budget.");
          expect(slot.conflict.code).toBe("budget_impossible");
          expect(slot.conflict.details?.accounts).toBe("whole_session");
          expect(Number(slot.conflict.details?.minimumMinutes)).toBeGreaterThan(10);
        } else {
          if (slot.kind !== "workout") throw new Error("Canonical short fixture must produce workouts.");
          expect(validateSwimWorkout(slot.issued).length).toBe(0);
          expect(slot.issued.budget.minutes).toBe(10);
          expect(slot.issued.budget.accountedMs).toBeLessThanOrEqual(10 * 60_000);
          expect(slot.issued.estimatedMs).toBe(slot.issued.budget.accountedMs);
          expect(slot.issued.totalLengths).toBeLessThan(reference.issued.totalLengths);
          expect(slot.issued.budget.accountedMs).toBeLessThan(reference.issued.budget.accountedMs);
        }
      }
    }
  });
  it("A5 DC-SW7: the authored purge navigation waits for destination and removed state before reload", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const a5 = source.slice(source.indexOf('test("A5,'), source.indexOf('test("A7,'));
    const block = a5.slice(a5.indexOf("await card.click();"), a5.indexOf("expect((await prescription.innerText())"));
    const calls: string[] = [];
    let arrive!: () => void;
    let render!: () => void;
    const destination = new Promise<void>((resolve) => { arrive = resolve; });
    const state = new Promise<void>((resolve) => { render = resolve; });
    const removed = {};
    const page = {
      getByRole: (role: string) => {
        expect(role).toBe("status");
        return { filter: (options: unknown) => {
          expect(options).toEqual({ hasText: "Result removed" });
          return removed;
        } };
      },
      reload: vi.fn(async () => { calls.push("reload"); }),
    };
    const execute = runInNewContext(transpileModule(`(async () => { ${block} })`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      page, target: { id: "synthetic-workout" },
      card: { click: async () => { calls.push("click"); } },
      expect: (value: unknown) => ({
        toHaveURL: async (url: RegExp) => {
          expect(value).toBe(page);
          expect(url.test("http://127.0.0.1/app/swim/synthetic-workout")).toBe(true);
          expect(url.test("http://127.0.0.1/app/swim/synthetic-workout/other")).toBe(false);
          calls.push("destination");
          await destination;
        },
        toBeVisible: async () => {
          expect(value).toBe(removed);
          calls.push("state");
          await state;
        },
      }),
    }) as () => Promise<void>;
    const pending = execute();
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(calls).toEqual(["click", "destination"]);
      expect(page.reload).not.toHaveBeenCalled();
      arrive();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(calls).toEqual(["click", "destination", "state"]);
      expect(page.reload).not.toHaveBeenCalled();
    } finally { arrive(); render(); await pending; }
    expect(calls).toEqual(["click", "destination", "state", "reload", "state"]);
  });
  it("A7 DC-SW7/DC-SW9: the authored final return waits for destination and saved result before reload", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const a7 = source.slice(source.indexOf('test("A7,'));
    const block = a7.slice(a7.lastIndexOf('await page.locator(`a[href="/app/swim/${target.id}"]`).click();'),
      a7.indexOf("expect((await prescription.innerText())", a7.lastIndexOf("await page.reload();")));
    const calls: string[] = [];
    let arrive!: () => void;
    let render!: () => void;
    const destination = new Promise<void>((resolve) => { arrive = resolve; });
    const state = new Promise<void>((resolve) => { render = resolve; });
    const result = {};
    const page = {
      locator: (selector: string) => {
        expect(selector).toBe('a[href="/app/swim/synthetic-workout"]');
        return { click: async () => { calls.push("click"); } };
      },
      reload: vi.fn(async () => { calls.push("reload"); }),
    };
    const execute = runInNewContext(transpileModule(`(async () => { ${block} })`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      page, target: { id: "synthetic-workout" }, result, lengths: 12,
      expect: (value: unknown) => ({
        toHaveURL: async (url: RegExp) => {
          expect(value).toBe(page);
          expect(url.test("http://127.0.0.1/app/swim/synthetic-workout")).toBe(true);
          expect(url.test("http://127.0.0.1/app/swim/synthetic-workout/other")).toBe(false);
          expect(url.test("http://127.0.0.1/app/swim/other-workout")).toBe(false);
          calls.push("destination");
          await destination;
        },
        toContainText: async (text: string) => {
          expect(value).toBe(result);
          expect(text).toBe("12 lengths · 15:00 · RPE 6");
          calls.push("state");
          await state;
        },
      }),
    }) as () => Promise<void>;
    const pending = execute();
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(page.reload).not.toHaveBeenCalled();
      expect(calls).toEqual(["click", "destination"]);
      arrive();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(page.reload).not.toHaveBeenCalled();
      expect(calls).toEqual(["click", "destination", "state"]);
    } finally { arrive(); render(); await pending; }
    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["click", "destination", "state", "reload", "state"]);
  });
  it("DC-SW1/DC-SW2/DC-SW3/DC-SW4/DC-SW5/DC-SW6/DC-SW7/DC-SW8/DC-SW9/DC-K4: pins the owner-approved twenty-five current-UI identities after retiring A6", () => {
    expect(SWIM_BROWSER_CASES).toEqual([
      {
        file: "e2e/swimming-mobile.spec.ts", describe: "ADR0079 standalone swimming",
        title: "blockless setup, program navigation and retained native history",
      },
      {
        file: "e2e/swimming-mobile.spec.ts", describe: "ADR0079 standalone swimming",
        title: "custom pool validation preserves inputs and exact issued repeats across reload",
      },
      {
        file: "e2e/swimming-persistence-mobile.spec.ts",
        describe: "ADR0079 mobile swimming persistence and isolation",
        title: "DC-SW1/DC-SW8: read-only course and prescriptions survive reload and a second same-user context",
      },
      {
        file: "e2e/swimming-persistence-mobile.spec.ts",
        describe: "ADR0079 mobile swimming persistence and isolation",
        title: "DC-SW1/DC-SW8: two mobile users skip only their own workouts and retain foreign read isolation",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A1, DC-SW7: pause, review, resume, finish and archive preserve retained swims and primary training",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A2, DC-SW9: trash and recovery of retained edited results remove and restore regional load exactly once",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and retained results",
        title: "B1 DC-SW4/DC-SW5: settled history advances only the unstarted next-week target once",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and retained results",
        title: "B2 DC-SW8: retained completions survive tab reloads and skipping another workout",
      },
      {
        file: "e2e/swimming-account-mobile.spec.ts",
        describe: "ADR0079 mobile swimming account acceptance",
        title: "C1 DC-SW1/DC-SW8: Account exports native records and isolates synthetic users",
      },
      {
        file: "e2e/swimming-account-mobile.spec.ts",
        describe: "ADR0079 mobile swimming account acceptance",
        title: "C2 DC-SW8: Account deletion cascades with a referenced user-owned custom movement and preserves a survivor",
      },
      {
        file: "e2e/swimming-assessment-mobile.spec.ts",
        describe: "ADR0079 mobile swimming assessment decisions and native history",
        title: "DC-SW2/DC-SW5/DC-SW6/DC-SW8: rejected native trials persist before acceptance updates only future unstarted swims",
      },
      {
        file: "e2e/swimming-account-mobile.spec.ts",
        describe: "ADR0079 mobile swimming account acceptance",
        title: "C3 DC-SW8: Auth admin deletes native and custom-linked synthetic accounts without the app action",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and retained results",
        title: "B3 DC-SW4/DC-SW5: plateau rejection preserves issued work and decision history",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and retained results",
        title: "B4 DC-SW4/DC-SW5/DC-K4: missed high-effort work supports a recorded warning override without catch-up",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and retained results",
        title: "B5 DC-SW4/DC-SW5: missing effort holds the next week without advancing targets",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and retained results",
        title: "B6 DC-SW1/DC-SW3: a short calibrated budget preserves whole-length workout purpose",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and retained results",
        title: "B7 DC-SW2/DC-SW3: an impossible calibrated budget creates no plan and can be corrected",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and retained results",
        title: "B8 DC-SW2/DC-SW3: beginner setup offers learning guidance instead of a workout",
      },
      {
        file: "e2e/swimming-persistence-mobile.spec.ts",
        describe: "ADR0079 mobile swimming persistence and isolation",
        title: "E1 DC-SW1/DC-SW6: weekly swimming analytics keep native pool courses separate",
      },
      {
        file: "e2e/swimming-persistence-mobile.spec.ts",
        describe: "ADR0079 mobile swimming persistence and isolation",
        title: "E2 DC-SW2/DC-SW6: ordinary swim results do not create a pace calibration",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A3, DC-SW7: replacing an archived plan preserves retained native history and primary training",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A4, DC-SW7/DC-SW8/DC-SW9: archived late results remain visible across contexts without duplicate history or load",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A5, DC-SW7/DC-SW9: permanent deletion removes a retained edited result while preserving its planned target",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A7, DC-SW7/DC-SW9: a new limitation preserves retained results and blocks setup and resume",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and retained results",
        title: "B9 DC-SW5/DC-SW7/DC-SW8: concurrent reviewed recommendations and dates keep one accepted decision",
      },
    ]);
    expect(SWIM_BROWSER_CASES).toHaveLength(25);
    const files = [...new Set(SWIM_BROWSER_CASES.map(({ file }) => file))];
    expect(files).toHaveLength(6);
    expect(files.map((file) => SWIM_BROWSER_CASES.filter((item) => item.file === file).length)).toEqual([2, 4, 6, 9, 3, 1]);
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
  it("DC-SW7/DC-SW8: the authored files declare exactly the approved current-UI inventory", () => {
    for (const file of new Set(SWIM_BROWSER_CASES.map((item) => item.file))) {
      const source = readFileSync(join(webRoot, file), "utf8").replaceAll("\r\n", "\n");
      const expected = SWIM_BROWSER_CASES.filter((item) => item.file === file);
      expect(source.match(/test\.describe\("([^"]+)"/)?.[1]).toBe(expected[0].describe);
      expect([...source.matchAll(/\btest\("([^"]+)"/g)].map((match) => match[1]))
        .toEqual(expected.map((item) => item.title));
      expect(source).not.toContain('test("A6,');
      expect(source).not.toContain(".setOffline(");
    }
  });
  it("DC-SW1/DC-SW8: owned skips retain the original shared five-second deadline and foreign isolation", () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-persistence-mobile.spec.ts"), "utf8");
    const body = source.slice(source.indexOf('test("DC-SW1/DC-SW8: two mobile users'),
      source.indexOf('test("E1 '));
    expect(body).toContain('name: "404", exact: true');
    expect(body).toContain('`${foreignURL}?edit=1`');
    expect(body).toContain('getByRole("button", { name: "Skip swim", exact: true }).click()');
    expect(body).toContain("const deadline = performance.now() + 5000;");
    expect(body).toContain("setTimeout(() => controller.abort(), budget)");
    expect(body).toContain('.eq("user_id", ownerUserId).eq("id", workout.id).abortSignal(controller.signal)');
    expect(body).toContain('throw new Error("Could not confirm the owned swim skip.")');
    expect(body).toContain('}, { timeout: budget }).toBe("skipped")');
    expect(body).toContain(".toBeVisible({ timeout: remaining })");
    expect(body).toContain("finally { clearTimeout(expiry); controller.abort(); }");
    expect(body).toContain("expect(await savedState(admin, foreignUserId)).toEqual(foreignBefore)");
    expect(body).toContain("expect(await savedState(admin, ownerUserId)).toEqual(skipped)");
  });
  it("B2 DC-SW8: checks four retained workouts without weakening the six-workout decision fixtures", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-decisions-offline-mobile.spec.ts"), "utf8");
    const helper = source.slice(source.indexOf("async function saved("), source.indexOf("async function arrangePlan("));
    const { plan, workouts } = swimFixture();
    let rows = workouts;
    const history = vi.fn(async () => rows.map((workout) => ({ workout })));
    const saved = runInNewContext(transpileModule(`${helper}\nsaved`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      expect, listSwimPlans: async () => [plan], listSwimWorkouts: async () => rows, loadSwimHistory: history,
    }) as (client: object, planId: string, count?: number) => Promise<unknown>;
    await expect(saved({}, plan.id)).resolves.toMatchObject({ plan, workouts });
    rows = workouts.slice(0, 4);
    await expect(saved({}, plan.id, 4)).resolves.toMatchObject({ plan, workouts: rows });
    await expect(saved({}, plan.id)).rejects.toThrow();
    rows = workouts.slice(0, 3);
    await expect(saved({}, plan.id, 4)).rejects.toThrow();
    expect(history).toHaveBeenCalledTimes(2);
    const b2 = source.slice(source.indexOf('  test("B2 '), source.indexOf('  test("B3 '));
    expect(b2.match(/await saved\(actor, plans\[0\]\.id, 4\)/g)).toHaveLength(2);
    expect(b2).not.toContain("await saved(actor, plans[0].id)");
  });
  it.each([{ initial: [] }, { initial: [2] }, { initial: [2, 5] }])("A3 DC-SW7: selects two replacement weekdays independently of shared-schedule defaults $initial", async ({ initial }) => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const start = source.indexOf("    const swimDays =");
    const body = source.slice(start, source.indexOf('    await page.getByRole("button", { name: "Preview plan"', start));
    const checked = new Set(initial);
    const checkboxes = Array.from({ length: 7 }, (_, value) => ({
      getAttribute: async () => String(value),
      setChecked: async (selected: boolean) => { if (selected) checked.add(value); else checked.delete(value); },
    }));
    const days = { all: async () => checkboxes, and: () => checked };
    const execute = runInNewContext(transpileModule(`(async () => { ${body} })`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      page: { getByRole: () => ({ getByRole: () => days }), locator: () => ({}) },
      expect: (value: Set<number>) => ({ toHaveCount: async (count: number) => expect(value.size).toBe(count) }),
    }) as () => Promise<void>;
    await execute();
    expect([...checked].sort()).toEqual([1, 4]);
    const a3 = source.slice(source.indexOf('  test("A3,'), source.indexOf('  test("A4,'));
    expect(a3).toContain("const replacementStart = addDaysToYmd(archived.plans[0].ends_on, 1)");
    expect(a3).toContain("expect(schedule.entries.every((entry) => entry.date < replacementStart)).toBe(true)");
    expect(a3).toContain('getByLabel("Start date", { exact: true }).fill(replacementStart)');
    expect(a3).toContain("await expect(overlap).toHaveCount(0)");
    expect(a3).not.toContain("if (await overlap.count())");
    expect(a3).toContain("expect(newWorkouts.length).toBe(4)");
  });
  it.each([0, 1, 2, 3, 4, 5, 6])("A3 DC-SW7: retains four future replacement swims at weekday offset %i", (offset) => {
    const oldEnd = addDaysToYmd("2026-09-20", offset);
    const start = addDaysToYmd(oldEnd, 1);
    const dates = standaloneWeekRequests(start, 2, [1, 4]).flatMap((week) => week.slots.map((slot) => slot.dateISO));
    expect(dates).toHaveLength(4);
    expect(new Set(dates).size).toBe(4);
    expect(dates.every((date) => date >= start && date <= addDaysToYmd(start, 13))).toBe(true);
    expect(dates.every((date) => [1, 4].includes(new Date(`${date}T00:00:00Z`).getUTCDay()))).toBe(true);
  });
  it.each([false, true])("A3 DC-SW7: opens program history when its initial open state is %s", async (initiallyOpen) => {
    const source = readFileSync(join(webRoot, "e2e/fixtures/swim-navigation.ts"), "utf8");
    const helper = source.slice(source.indexOf("export async function openSwimProgramHistory(")).replace("export ", "");
    let open = initiallyOpen;
    const click = vi.fn(async () => { open = !open; });
    const disclosure = {
      getAttribute: async () => open ? "" : null,
      locator: () => ({ click }),
    };
    const page = { getByRole: (_role: string, options: { includeHidden?: boolean }) => ({
      locator: () => {
        if (!open && !options.includeHidden) throw new Error("Hidden navigation cannot locate its disclosure.");
        return disclosure;
      },
    }) };
    const execute = runInNewContext(transpileModule(`${helper}\nopenSwimProgramHistory`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, { expect: () => ({ toBeVisible: async () => expect(open).toBe(true) }) }) as (page: object) => Promise<void>;
    await execute(page);
    expect(click).toHaveBeenCalledTimes(initiallyOpen ? 0 : 1);
    await execute(page);
    expect(click).toHaveBeenCalledTimes(initiallyOpen ? 0 : 1);
  });
  it("M16 DC-SW8: settles the completion redirect before navigating to retained history", async () => {
    const source = readFileSync(join(webRoot, "e2e/program-builder-mobile.spec.ts"), "utf8");
    const m16 = source.slice(source.indexOf('ownedTest("M16 '));
    const start = m16.indexOf("        await expect(page).toHaveURL(");
    expect(start).toBeGreaterThan(0);
    const body = m16.slice(start, m16.indexOf("        const exported =", start));
    let redirectPending = true;
    const page = {
      goto: vi.fn(async (destination: string) => {
        expect(redirectPending).toBe(false);
        expect(destination).toBe("/app/sessions");
      }),
      locator: (selector: string) => selector,
    };
    const execute = runInNewContext(transpileModule(`(async () => { ${body} })`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      page, runSession: "running", oldSession: "retained",
      expect: (value: unknown) => ({
        toHaveURL: async (pattern: RegExp) => {
          expect(value).toBe(page);
          expect(pattern.test("http://localhost/app/sessions/running?completed=1")).toBe(true);
          expect(pattern.test("http://localhost/app/sessions/running")).toBe(false);
          redirectPending = false;
        },
        toHaveCount: async (count: number) => {
          expect(page.goto).toHaveBeenCalledOnce();
          expect(count).toBe(1);
          expect(['a[href="/app/sessions/retained"]', 'a[href="/app/sessions/running"]']).toContain(value);
        },
      }),
    }) as () => Promise<void>;
    await execute();
  });
  it("A5 DC-SW7/DC-SW9: reads the purged hub as its authenticated owner without altering retained edits or guards", () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const a5 = source.slice(source.indexOf('  test("A5,'), source.indexOf('  test("A7,'));
    expect(a5).toContain("const actor = await retainedSwimActor(seedConfig, freshUser)");
    expect(a5).toContain("await loadSwimHubView(actor, userId, purged.plans[0])");
    expect(a5).not.toContain("loadSwimHubView(admin,");
    expect(a5).toContain("workoutId: target.id, expectedRevision: first.workout.revision");
    expect(a5).toContain("actual.workout.definition.resultHistory?.length === 1");
    expect(a5).toContain("retained.definition.resultHistory === undefined");
  });
  it("B9 DC-SW5/DC-SW8: recognizes exact shared-schedule stale rejections, never generic validation errors", () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-decisions-offline-mobile.spec.ts"), "utf8");
    const start = source.indexOf("      const stale =");
    const body = source.slice(start, source.indexOf("      function submittedArguments(", start));
    const stale = runInNewContext(transpileModule(`${body}\nstale`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText) as (page: object) => RegExp;
    const matcher = stale({ locator: () => ({}), getByRole: () => ({
      and: () => ({ filter: ({ hasText }: { hasText: RegExp }) => hasText }),
    }) });
    for (const message of [
      "Your swim plan changed. Reload and try again.",
      "Swimming: Swimming plan changed. Reload before continuing.",
      "Your schedule changed. Review the dates again.",
      "These dates changed. Preview them again.",
    ]) expect(matcher.test(message)).toBe(true);
    for (const message of [
      "Could not save your swim. Try again.", "Check your swim entries and try again.",
      "Accept the overlapping workouts before resuming.", "Review your active limitations before swimming",
      "Your schedule changed. Review the attachments again.",
    ]) expect(matcher.test(message)).toBe(false);
    const b9 = source.slice(source.indexOf('  test("B9 '));
    expect(b9).toContain("expect(rejected.filter(Boolean)).toHaveLength(1)");
    expect(b9).toContain("expect(!overflow && requests.every((entries) => entries.length === 1)).toBe(true)");
  });
  it("DC-SW1/DC-SW7/DC-SW9: retained arrangement keeps measurements, load and deletion assertions without claiming logger UI", () => {
    const mobile = readFileSync(join(webRoot, "e2e/swimming-mobile.spec.ts"), "utf8");
    expect(mobile).toContain('a[data-kind="swimming"][href="/app/swim?plan=${planId}"]');
    expect(mobile).toContain("const splits = [{ lengths: 4, timeMs: 135125 }]");
    expect(mobile).toContain('result.getByText("200 m", { exact: true })');
    expect(mobile).toContain("expect(await getSwimResult(actor, completed.session_id)).toEqual(retained)");
    const lifecycle = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    for (const [title, end] of [["A2,", "A3,"], ["A3,", "A4,"], ["A4,", "A5,"], ["A5,", "A7,"], ["A7,", null]]) {
      const start = lifecycle.indexOf(`test("${title}`);
      const body = lifecycle.slice(start, end ? lifecycle.indexOf(`test("${end}`) : undefined);
      expect(start).toBeGreaterThan(0);
      expect(body).toContain("completeRetainedSwim(actor,");
      expect(body).toContain("await recomputeRegionState(actor, userId, timezone)");
    }
    expect(lifecycle).toContain('name: "Delete swim", exact: true');
    expect(lifecycle).toContain('name: "Recover", exact: true');
    expect(lifecycle).toContain("expect(await regionRows(admin, userId)).toEqual([])");
    expect(lifecycle).toContain("isDeepStrictEqual(await primary.snapshot(), primary.initial)");
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
        `await expect(page.getByTestId("page-header").getByText("${label} program · Swimming", { exact: true })).toBeVisible({ timeout: remaining });`,
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
      'await expect(page.getByTestId("page-header").getByText("Archived program · Swimming", { exact: true })).toBeVisible();',
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
    expect(assertionLines[0]).toContain('getByText("Finished program · Swimming",');
    expect(assertionLines[1]).toContain('getByText("Archived program · Swimming",');
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
      '})().catch(() => active() ? "read-error" as const : "not-confirmed-expired" as const);',
      "return await polling;",
      "} finally {", "controller.abort();", "clearTimeout(expiry);",
      "await Promise.allSettled([polling]);",
    ]) expect(poll).toContain(part);
    expect(poll.indexOf("if (!active())")).toBeLessThan(poll.indexOf("if (sample.error"));
    expect(poll.indexOf("if (!active())")).toBeLessThan(poll.indexOf('return "reached"'));
    expect(poll).not.toMatch(/performance\.now\(\) \+|\.update\(|\.insert\(|\.rpc\(|page\.|expect\(|annotations|alertAnnotation/);
  });
  it("DC-SW9 A7 uses the already-proven genuine-positive alert at both safety rejections", () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const a7 = source.slice(source.indexOf('test("A7,'));
    const positive = 'page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"))';
    const assertions = a7.split("\n").filter((line) =>
      line.includes('toContainText("Review your active limitations before swimming")') ||
      line.includes("toContainText(REGION_LABELS[region])"));
    expect(assertions).toHaveLength(4);
    for (const line of assertions) expect(line).toContain(`expect(${positive}).toContainText(`);
    const probe = readFileSync(join(webRoot, "scripts/swim-alert-announcer-probe.ts"), "utf8");
    expect(probe).toContain('const old = page.getByRole("alert");');
    expect(probe).toContain('const positive = old.and(page.locator(":not(#__next-route-announcer__)"));');
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

describe("DC-SW1/DC-SW2/DC-SW3/DC-SW4/DC-SW5/DC-SW6/DC-SW7/DC-SW8/DC-SW9/DC-K4 strict twenty-five-case acceptance ledger", () => {
  function originalReport(count = 18) {
    const fixture = report();
    const titles = new Set<string>(SWIM_BROWSER_CASES.slice(0, count).map((item) => item.title));
    for (const file of fixture.suites) for (const suite of file.suites) {
      suite.specs = suite.specs.filter((spec) => titles.has(spec.title));
    }
    return fixture;
  }
  function expectOriginalCohort(fixture: ReturnType<typeof report>, count: number) {
    const identities = fixture.suites.flatMap((file) => file.suites.flatMap((suite) =>
      suite.specs.map((spec) => ({ file: `e2e/${file.file}`, describe: suite.title, title: spec.title }))));
    expect(identities).toHaveLength(count);
    expect(identities).toEqual(expect.arrayContaining(SWIM_BROWSER_CASES.slice(0, count)));
    expect(fixture.stats.expected).toBe(count);
  }
  it("accepts real-shaped file wrappers and emits only fixed identities, counts and measured attempt durations", () => {
    const fixture = report();
    fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!.stdout = [{ text: "private-payload" }];
    const ledger = validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot);
    expect(ledger).toEqual({
      success: true, counts: { expected: 25, unexpected: 0, flaky: 0, skipped: 0 },
      cases: SWIM_BROWSER_CASES.map((item) => ({ ...item, status: "passed", attempts: 1, durationMs: 1 })),
    });
    expect(JSON.stringify(ledger)).not.toContain("private-payload");
  });
  it("maps grouped lifecycle, persistence, B and C file results to their noncontiguous exact casebook identities", () => {
    const fixture = report();
    for (const file of fixture.suites) {
      for (const suite of file.suites) {
        for (const spec of suite.specs) {
          const index = SWIM_BROWSER_CASES.findIndex((item) =>
            basename(item.file) === file.file && item.describe === suite.title && item.title === spec.title);
          expect(index).toBeGreaterThanOrEqual(0);
          spec.tests[0]!.results[0]!.duration = index + 1;
        }
        suite.specs.reverse();
      }
    }
    fixture.suites.reverse();
    const ledger = validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot);
    expect(ledger.cases).toEqual(SWIM_BROWSER_CASES.map((item, index) => ({
      ...item, status: "passed", attempts: 1, durationMs: index + 1,
    })));
  });
  it("rejects the passing original-four report after cohort expansion", () => {
    const fixture = originalReport();
    fixture.suites.splice(2);
    fixture.config.projects[0]!.testMatch.splice(2);
    fixture.stats.expected = 4;
    expectOriginalCohort(fixture, 4);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects the passing original-six report after B1/B2 integration", () => {
    const fixture = originalReport();
    fixture.suites.splice(3);
    fixture.config.projects[0]!.testMatch.splice(3);
    fixture.stats.expected = 6;
    expectOriginalCohort(fixture, 6);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects the passing original-eight report after C/D integration", () => {
    const fixture = originalReport();
    fixture.suites.splice(4);
    fixture.suites[3]!.suites[0]!.specs.splice(2);
    fixture.config.projects[0]!.testMatch.splice(4);
    fixture.stats.expected = 8;
    expectOriginalCohort(fixture, 8);
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(8);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects the passing original-eleven report after C3 integration without removing a file", () => {
    const fixture = originalReport();
    fixture.suites[3]!.suites[0]!.specs.splice(2);
    const suite = fixture.suites[4]!.suites[0]!;
    expect(suite.specs.pop()?.title).toBe(SWIM_BROWSER_CASES[11]!.title);
    fixture.stats.expected = 11;
    expectOriginalCohort(fixture, 11);
    expect(fixture.suites).toHaveLength(6);
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(11);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects the passing original-twelve report by removing all B3–B8 and keeping B1/B2", () => {
    const fixture = originalReport();
    const removed = fixture.suites[3]!.suites[0]!.specs.splice(2);
    expect(removed.map((spec) => spec.title)).toEqual(SWIM_BROWSER_CASES.slice(12, 18).map((item) => item.title));
    fixture.stats.expected = 12;
    expectOriginalCohort(fixture, 12);
    expect(fixture.suites).toHaveLength(6);
    expect(fixture.suites[3]!.suites[0]!.specs.map((spec) => spec.title))
      .toEqual(SWIM_BROWSER_CASES.slice(6, 8).map((item) => item.title));
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(12);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects the passing original-fifteen report by removing A3–A7, E1/E2 and B6/B7/B8", () => {
    const fixture = originalReport();
    const suite = fixture.suites[3]!.suites[0]!;
    const removed = suite.specs.splice(5);
    expect(removed.map((spec) => spec.title)).toEqual(SWIM_BROWSER_CASES.slice(15, 18).map((item) => item.title));
    fixture.stats.expected = 15;
    expectOriginalCohort(fixture, 15);
    expect(fixture.suites).toHaveLength(6);
    expect(suite.specs.map((spec) => spec.title))
      .toEqual([6, 7, 12, 13, 14].map((index) => SWIM_BROWSER_CASES[index]!.title));
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(15);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects the passing original-eighteen report by removing A3–A7 and E1/E2", () => {
    const fixture = originalReport();
    fixture.stats.expected = 18;
    expect(fixture.suites).toHaveLength(6);
    expectOriginalCohort(fixture, 18);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects the passing original-twenty report by removing only A3–A7", () => {
    const fixture = originalReport(20);
    fixture.stats.expected = 20;
    expect(fixture.suites).toHaveLength(6);
    expectOriginalCohort(fixture, 20);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects the accepted original-twenty-two report by removing only A5/A7", () => {
    const fixture = originalReport(22);
    fixture.stats.expected = 22;
    expect(fixture.suites).toHaveLength(6);
    expectOriginalCohort(fixture, 22);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects a truncated twenty-three-case report without A7 and B9", () => {
    const fixture = originalReport(23);
    fixture.stats.expected = 23;
    expect(fixture.suites).toHaveLength(6);
    expectOriginalCohort(fixture, 23);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects a truncated twenty-four-case report without B9", () => {
    const fixture = originalReport(24);
    fixture.stats.expected = 24;
    expect(fixture.suites).toHaveLength(6);
    expectOriginalCohort(fixture, 24);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects a duplicate B8 in place of B9 even with twenty-five results", () => {
    const fixture = report();
    fixture.suites[3]!.suites[0]!.specs[8]!.title = SWIM_BROWSER_CASES[17]!.title;
    expect(rejectedReport(fixture).success).toBe(false);
  });
  it.each([20, 21, 22, 23].flatMap((missing) =>
    [4, 5, 20, 21, 22, 23].filter((replacement) => replacement !== missing).map((replacement) => [missing, replacement]),
  ))("rejects missing A casebook index %d replaced by %d with twenty-five results", (missing, replacement) => {
    const fixture = report();
    const suite = fixture.suites[2]!.suites[0]!;
    const spec = suite.specs.find((item) => item.title === SWIM_BROWSER_CASES[missing]!.title)!;
    spec.title = SWIM_BROWSER_CASES[replacement]!.title;
    expect(suite.specs).toHaveLength(6);
    expect(fixture.suites).toHaveLength(6);
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(25);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it.each([18, 19].flatMap((missing) =>
    [2, 3, 18, 19].filter((replacement) => replacement !== missing).map((replacement) => [missing, replacement]),
  ))("rejects missing E casebook index %d replaced by %d with twenty-five results", (missing, replacement) => {
    const fixture = report();
    const suite = fixture.suites[1]!.suites[0]!;
    const spec = suite.specs.find((item) => item.title === SWIM_BROWSER_CASES[missing]!.title)!;
    spec.title = SWIM_BROWSER_CASES[replacement]!.title;
    expect(suite.specs).toHaveLength(4);
    expect(fixture.suites).toHaveLength(6);
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(25);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it.each([0, 1])("does not substitute account case %d for missing C3 even with twenty-five results", (index) => {
    const fixture = report();
    const suite = fixture.suites[4]!.suites[0]!;
    suite.specs[2] = suite.specs[index]!;
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(25);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("does not substitute another C case for missing D even with twenty-five results", () => {
    const fixture = report();
    fixture.suites.pop();
    fixture.suites[4]!.suites[0]!.specs.push(fixture.suites[4]!.suites[0]!.specs[0]!);
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(25);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it.each([12, 13, 14, 15, 16, 17].flatMap((missing) =>
    [6, 7, 12, 13, 14, 15, 16, 17].filter((replacement) => replacement !== missing).map((replacement) => [missing, replacement]),
  ))("rejects missing casebook index %d replaced by %d with twenty-five results", (missing, replacement) => {
    const fixture = report();
    const suite = fixture.suites[3]!.suites[0]!;
    const spec = suite.specs.find((item) => item.title === SWIM_BROWSER_CASES[missing]!.title)!;
    spec.title = SWIM_BROWSER_CASES[replacement]!.title;
    expect(suite.specs).toHaveLength(9);
    expect(fixture.suites).toHaveLength(6);
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(25);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it.each(SWIM_BROWSER_CASES)("requires $title exactly once with no retry, skip or error", (item) => {
    for (const mode of ["missing", "extra", "unexecuted", "duplicate", "identity", "retry", "skipped", "flaky", "error"]) {
      const fixture = report();
      const suite = fixture.suites.find((file) => file.file === basename(item.file))!.suites[0]!;
      const index = suite.specs.findIndex((spec) => spec.title === item.title);
      const test = suite.specs[index]!.tests[0]!;
      switch (mode) {
        case "missing": suite.specs.splice(index, 1); break;
        case "extra": suite.specs.push({ ...suite.specs[index]!, title: "private-extra" }); break;
        case "unexecuted": test.results = []; break;
        case "duplicate":
          if (suite.specs.length === 1) suite.specs.push(suite.specs[0]!);
          else suite.specs[(index + 1) % suite.specs.length] = suite.specs[index]!;
          break;
        case "identity": suite.specs[index]!.title = "private-identity"; break;
        case "retry": test.results[0]!.retry = 1; break;
        case "skipped": test.status = "skipped"; test.results[0]!.status = "skipped"; break;
        case "flaky": test.status = "flaky"; break;
        case "error": test.results[0]!.errors = [{ message: "private-error" }]; break;
      }
      const projection = rejectedReport(fixture);
      expect(projection.code).toBe(["missing", "extra", "duplicate", "identity"].includes(mode)
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
        failureDetails: { callers: "unavailable", assertion: "unavailable", expected: "unavailable", actual: "unavailable" },
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
        "global-error", "failed-result", "timed-out", "interrupted", "expected-failure", "no-result",
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
  it.each(["\n", "\r\n"])("projects bounded allowlisted callers and only the known private boolean comparison with %j endings", (ending) => {
    const file = "e2e/swimming-decisions-offline-mobile.spec.ts";
    const source = readFileSync(join(webRoot, file), "utf8").replaceAll("\r\n", "\n").split("\n").join(ending);
    expect(source.split("\n")[72])
      .toContain('expect(isDeepStrictEqual(actual, expected), "Private fixture comparison").toBe(true)');
    const stack = "Error: Private fixture comparison\n\nexpect(received).toBe(expected) // Object.is equality\n\n" +
      `Expected: true\nReceived: false\n\n    at same (${join(webRoot, file)}:73:3)\n` +
      `    at ${join(webRoot, file)}:240:7\n    at ${join(webRoot, file)}:241:8\n` +
      `    at ${join(webRoot, file)}:242:9\n`;
    expect(projectStackAttribution([stack], webRoot)).toEqual({
      callers: [
        { source: "swimming-decisions-offline-mobile", line: 240, column: 7 },
        { source: "swimming-decisions-offline-mobile", line: 241, column: 8 },
      ], assertion: "private-fixture-comparison", expected: true, actual: false,
    });
    const fixture = report();
    const result = fixture.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!;
    result.status = "failed";
    Object.assign(result, { errors: [{ stack, location: { file: join(webRoot, file), line: 73, column: 3 } }] });
    const projection = rejectedReport(fixture);
    expect(projection.cases?.[0]?.attributedSources).toEqual([{ source: "swimming-decisions-offline-mobile", line: 73 }]);
    expect(projection.cases?.[0]?.failureDetails).toEqual(projectStackAttribution([stack], webRoot));
    Object.assign(result, { error: { stack }, errors: [] });
    expect(rejectedReport(fixture).cases?.[0]?.failureDetails).toEqual(projectStackAttribution([stack], webRoot));
    expect(JSON.stringify(projection)).not.toContain(webRoot);
    for (const received of ['"secret-token"', '{"id":"secret-token"}', "false\nReceived: true"]) {
      const details = projectStackAttribution([stack.replace("Received: false", `Received: ${received}`)], webRoot);
      expect(details.actual).toBe("unavailable");
      expect(details.expected).toBe("unavailable");
      expect(JSON.stringify(details)).not.toContain("secret-token");
    }
    expect(projectStackAttribution([stack, stack], webRoot).actual).toBe("unavailable");
    const oldLine = projectStackAttribution([stack.replace(":73:3", ":72:3")], webRoot);
    expect(oldLine).toMatchObject({ assertion: "unavailable", expected: "unavailable", actual: "unavailable" });
  });
  it("drops unallowlisted, malformed, oversized and secret-like stack payloads", () => {
    for (const stack of [
      "secret-token", { stack: "secret-token" }, "x".repeat(16_385),
      "    at /tmp/secret-token.ts:1:2",
      `    at ${join(webRoot, "e2e/../e2e")}/secret-token.ts:1:2`,
      `secret-token    at ${join(webRoot, "e2e/fixtures/seed.ts")}:1:2`,
      `    at ${join(webRoot, "e2e/fixtures/seed.ts")}:1:2?secret-token`,
      `    at ${join(webRoot, "e2e/fixtures/seed.ts")}:1000001:2`,
    ]) {
      expect(projectStackAttribution([stack], webRoot)).toEqual({
        callers: "unavailable", assertion: "unavailable", expected: "unavailable", actual: "unavailable",
      });
    }
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
        ...(index === 0 ? { failureDetails: {
          callers: "unavailable", assertion: "unavailable", expected: "unavailable", actual: "unavailable",
        } } : {}),
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
    ["e2e/swimming-decisions-offline-mobile.spec.ts", "swimming-decisions-offline-mobile"],
    ["e2e/swimming-account-mobile.spec.ts", "swimming-account-mobile"],
    ["e2e/swimming-assessment-mobile.spec.ts", "swimming-assessment-mobile"],
    ["src/lib/swim/storage.ts", "swim-storage"],
    ["src/lib/swim/queries.ts", "swim-queries"],
    ["src/lib/offline/outbox-core.ts", "outbox-core"],
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
    `${webRoot}/e2e/swimming-decisions-offline-mobile.spec.ts.bak`,
    ...[
      "e2e/swimming-account-mobile.spec.ts",
      "e2e/swimming-assessment-mobile.spec.ts",
      "src/lib/swim/storage.ts",
    ].flatMap((file) => [
      file, `${webRoot}/${file}.bak`, `${webRoot}/${file}/private`,
      `${webRoot}/./${file}`, `${webRoot}/${file.toUpperCase()}`,
      `/private${webRoot}/${file}`, `file://${webRoot}/${file}`,
    ]),
    `${webRoot}/src/lib/swim/queries.ts.bak`,
    `${webRoot}/src/lib/offline/outbox-core.ts.bak`,
    `${webRoot}/src/lib/offline/outbox.ts`,
    "src/lib/swim/queries.ts", "src/lib/offline/outbox-core.ts",
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
          const item = SWIM_BROWSER_CASES[index]!;
          const file = fixture.suites.find((suite) => suite.file === basename(item.file))!;
          const suite = file.suites.find((suite) => suite.title === item.describe)!;
          return suite.specs.find((spec) => spec.title === item.title)!.tests[0]!;
        }
        it.each(["valid", "reversed", "missing", "duplicate", "conflicting", "extra", "unknown-point",
          "cross-field", "extra-key", "oversized", "over-cap"])(
          "projects A7 %s only at index23 without changing its failed result or the frozen ledger", (mode) => {
            const values = [
              { ...unavailableAlert("a7-finish"), backend: "reached" as const, category: "client-queue" as const,
                control: "log" as const, result: "editing" as const },
              { ...unavailableAlert("a7-finish-transport"), result: "http-2xx" as const },
            ];
            const annotations = values.map((value) => alertAnnotation(value)!);
            const supplied = mode === "reversed" ? [...annotations].reverse() : mode === "missing" ? annotations.slice(1) :
              mode === "duplicate" ? [...annotations, annotations[0]!] :
              mode === "conflicting" ? [...annotations, alertAnnotation(unavailableAlert("a7-finish"))!] :
              mode === "extra" ? [...annotations, alertAnnotation(unavailableAlert("a3-finish"))!] :
              mode === "unknown-point" ? [{ ...annotations[0]!, description: annotations[0]!.description.replace("a7-finish", "a7-other") }] :
              mode === "cross-field" ? [{ ...annotations[1]!, description: annotations[1]!.description.replace("backend=unavailable", "backend=reached") }] :
              mode === "extra-key" ? [{ ...annotations[0]!, raw: "synthetic-private" }] :
              mode === "oversized" ? [{ ...annotations[0]!, description: annotations[0]!.description.repeat(2) }] :
              mode === "over-cap" ? [...annotations, ...Array(15).fill({ type: "unrelated" })] : annotations;
            const fixture = report();
            for (const index of SWIM_BROWSER_CASES.keys()) {
              caseTest(fixture, index).results[0]!.annotations = supplied;
            }
            caseTest(fixture, 23).results[0]!.status = "failed";
            const projection = rejectedReport(fixture);
            expect(projection.code).toBe("browser-failed");
            expect(projection.cases?.[23]?.status).toBe("failed");
            expect(projection.cases?.map(({ alertObservations }) => alertObservations)).toEqual(
              SWIM_BROWSER_CASES.map((_, index) => index !== 23 ? unavailableObservations(index) :
                ["valid", "reversed"].includes(mode) ? values :
                  mode === "missing" ? [unavailableAlert("a7-finish"), values[1]] : unavailableObservations(index)),
            );
            expect(projection.cases?.map(({ file, describe, title }) => ({ file, describe, title }))).toEqual(SWIM_BROWSER_CASES);
            expect(JSON.stringify(projection)).not.toContain("synthetic-private");
          },
        );
        it("projects only closed A3 observations at index20 without converting its UI failure to a pass", () => {
          const values = [
            { ...unavailableAlert("a3-finish"), backend: "reached" as const },
            { ...unavailableAlert("a3-finish-transport"), result: "http-2xx" as const },
          ];
          const annotations = values.map((value) => alertAnnotation(value)!);
          for (const valid of [true, false]) {
            const fixture = report();
            for (const index of SWIM_BROWSER_CASES.keys()) {
              caseTest(fixture, index).results[0]!.annotations = valid ? annotations :
                [...annotations, { ...annotations[0]!, description: annotations[0]!.description.replace("backend=reached", "backend=unknown") }];
            }
            caseTest(fixture, 20).results[0]!.status = "failed";
            const projection = rejectedReport(fixture);
            expect(projection.code).toBe("browser-failed");
            expect(projection.cases?.[20]?.status).toBe("failed");
            expect(projection.cases?.map(({ alertObservations }) => alertObservations)).toEqual(
              SWIM_BROWSER_CASES.map((_, index) => valid && index === 20 ? values : unavailableObservations(index)),
            );
          }
        });
        it.each(["request-unseen", "request-pending", "request-failed", "http-2xx", "http-3xx", "http-4xx", "http-5xx", "unavailable"] as const)(
          "projects A4 %s only at index21, retaining the failed UI ledger even with a completed receipt", (result) => {
            const fixture = report();
            const values = [
              { ...unavailableAlert("a4-replay"), backend: "reached" as const, category: "client-queue" as const,
                control: "log" as const, result: "editing" as const },
              { ...unavailableAlert("a4-replay-transport"), result },
            ];
            for (const index of SWIM_BROWSER_CASES.keys()) {
              caseTest(fixture, index).results[0]!.annotations = values.map((value) => alertAnnotation(value)!);
            }
            caseTest(fixture, 21).results[0]!.status = "failed";
            const projection = rejectedReport(fixture);
            expect(projection.code).toBe("browser-failed");
            expect(projection.cases?.[21]?.status).toBe("failed");
            expect(projection.cases?.map(({ alertObservations }) => alertObservations)).toEqual(
              SWIM_BROWSER_CASES.map((_, index) => index === 21 ? values : unavailableObservations(index)),
            );
            expect(projection.cases?.map(({ file, describe, title }) => ({ file, describe, title }))).toEqual(SWIM_BROWSER_CASES);
          },
        );
        it.each(["a4-replay", "a4-replay-transport"] as const)(
          "defaults missing %s and rejects malformed A4 annotations without losing the frozen ledger", (point) => {
            const value = point === "a4-replay" ? { ...unavailableAlert(point), backend: "reached" as const } :
              { ...unavailableAlert(point), result: "http-2xx" as const };
            const valid = alertAnnotation(value)!;
            for (const [index, annotations] of [
              [valid],
              [valid, alertAnnotation(observations[2])!],
              [valid, alertAnnotation(unavailableAlert(point))!],
              [{ ...valid, description: valid.description.replace(point, "a4-other") }],
              [{ ...valid, raw: "synthetic-private-extra" }],
              [{ ...valid, description: `${valid.description};raw=synthetic-private-extra` }],
              [{ ...valid, description: valid.description.replace("category=unavailable", "category=synthetic-private-secret") }],
              [{ ...valid, description: valid.description.replace("revision=unavailable", "revision=advanced") }],
              [alertAnnotation({ ...unavailableAlert("a4-replay"), backend: "reached" })!,
                { ...alertAnnotation(unavailableAlert("a4-replay-transport"))!,
                  description: alertAnnotation(unavailableAlert("a4-replay-transport"))!.description.replace("backend=unavailable", "backend=reached") }],
              Array(17).fill(valid),
            ].entries()) {
              const fixture = report();
              const result = caseTest(fixture, 21).results[0]!;
              Object.assign(result, { status: "failed", annotations });
              const projection = rejectedReport(fixture);
              expect(projection.code).toBe("browser-failed");
              expect(projection.cases).toHaveLength(25);
              expect(projection.cases?.[21]).toMatchObject({
                status: "failed", alertObservations: unavailableObservations(21).map((item) =>
                  index === 0 && item.point === point ? value : item),
              });
              expect(JSON.stringify(projection)).not.toContain("synthetic-private");
            }
          },
        );
        it.each(["reached", "not-reached", "unavailable"] as const)(
          "retains the nonqualifying C2 failure with backend=%s and no cross-case evidence", (backend) => {
            const fixture = report();
            const value = { ...unavailableAlert("c2-auth-absence"), backend };
            const annotation = alertAnnotation(value)!;
            for (const index of SWIM_BROWSER_CASES.keys()) {
              caseTest(fixture, index).results[0]!.annotations = [annotation, annotation];
            }
            caseTest(fixture, 9).results[0]!.status = "failed";
            const projection = rejectedReport(fixture);
            expect(projection.code).toBe("browser-failed");
            expect(projection.cases).toHaveLength(25);
            expect(projection.cases?.[9]?.status).toBe("failed");
            expect(projection.cases?.map(({ alertObservations }) => alertObservations)).toEqual(
              SWIM_BROWSER_CASES.map((_, index) => index === 9 ? [value] : unavailableObservations(index)),
            );
          },
        );
        it("does not treat an unsampled passing C2 as failed when a different case fails", () => {
          const fixture = report();
          expect(validateSwimBrowserReport(JSON.stringify(fixture), paths, webRoot).cases[9])
            .not.toHaveProperty("alertObservations");
          caseTest(fixture, 0).results[0]!.status = "failed";
          const projection = rejectedReport(fixture);
          expect(projection.cases?.[9]).toMatchObject({
            status: "passed", testStatus: "expected", alertObservations: [unavailableAlert("c2-auth-absence")],
          });
        });
        it("rejects other-case or conflicting C2 observations without losing the failure ledger", () => {
          const value = { ...unavailableAlert("c2-auth-absence"), backend: "reached" as const };
          const valid = alertAnnotation(value)!;
          for (const annotations of [
            [alertAnnotation(observations[2])!],
            [valid, alertAnnotation(observations[2])!],
            [valid, alertAnnotation({ ...value, backend: "not-reached" })!],
            [valid, { ...valid, description: `${valid.description};raw=private-data` }],
          ]) {
            const fixture = report();
            const result = caseTest(fixture, 9).results[0]!;
            result.status = "failed";
            result.annotations = annotations;
            const projection = rejectedReport(fixture);
            expect(projection.code).toBe("browser-failed");
            expect(projection.cases?.[9]).toMatchObject({
              status: "failed", alertObservations: [unavailableAlert("c2-auth-absence")],
            });
            expect(JSON.stringify(projection)).not.toContain("private-");
          }
        });
        it("projects only validated attempt annotations at their known points, capped and deduplicated per case", () => {
          const fixture = report();
          for (const [index, selected] of [[3, observations.slice(0, 2)], [4, [observations[2]]], [5, observations.slice(3)]] as const) {
            const result = caseTest(fixture, index).results[0]!;
            result.status = "failed";
            result.annotations = selected.flatMap((item) => [alertAnnotation(item)!, alertAnnotation(item)!]);
          }
          const projection = rejectedReport(fixture);
          expect(projection.code).toBe("browser-failed");
          expect(projection.cases).toHaveLength(25);
          expect(projection.cases?.map(({ alertObservations }) => alertObservations)).toEqual([
            [], [], [], observations.slice(0, 2), [observations[2]], observations.slice(3), [], [], [],
            [unavailableAlert("c2-auth-absence")], [], [], [], [], [], [], [], [], [], [],                         unavailableObservations(20), unavailableObservations(21), [], unavailableObservations(23), [],
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
          "rejects %s beside two A2 points without losing the failed twenty-two-case ledger", (mode) => {
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
            expect(projection.cases).toHaveLength(25);
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
          expect(projection.cases).toHaveLength(25);
          expect(projection.cases?.[4]?.status).toBe("failed");
          expect(projection.cases?.[4]?.alertObservations).toEqual([unavailableAlert("a1-pause")]);
          expect(JSON.stringify(projection)).not.toContain("private-");
        });
        it("never projects raw payloads or diagnostics from other channels, even beside a valid annotation", () => {
          for (const valid of [false, true]) {
            const fixture = report();
            for (const index of SWIM_BROWSER_CASES.keys()) {
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
            expect(projection.cases).toHaveLength(25);
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
            expect(projection.cases).toHaveLength(25);
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
