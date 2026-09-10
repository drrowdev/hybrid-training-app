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
import { acceptanceAssert, processFailure, safeFailureCause } from "../../../../scripts/swim-acceptance-errors";
import * as reporting from "../../../../scripts/swim-acceptance-reporting";
import {
  ALERT_ANNOTATION_TYPE, a4ReplayBackend, alertAnnotation, authAbsenceBackend, c2HttpClass, c2Location, c2Transport,
  classifyAlertNodes, classifyWorkoutViewNodes, projectAlertObservations, readAlertAnnotations, SWIM_ALERT_CODEBOOK, unavailableAlert, validateAlertCategory,
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
      index === 5 ? [unavailableAlert("a2-post-start"), unavailableAlert("a2-edit")] :
        index === 9 ? [unavailableAlert("c2-auth-absence")] :
          index === 20 ? [unavailableAlert("a3-finish"), unavailableAlert("a3-finish-transport")] :
            index === 21 ? [unavailableAlert("a4-replay"), unavailableAlert("a4-replay-transport")] :
              index === 24 ? [unavailableAlert("a7-finish"), unavailableAlert("a7-finish-transport")] : [];
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
      'await page.getByRole("button", { name: "Delete account (GDPR Art. 17)", exact: true }).click();',
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

describe("DC-SW7/DC-SW8/DC-SW9 A4 bounded reconnect observations", () => {
  afterEach(() => vi.useRealTimers());
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }
  async function observe(options: {
    holdBackend?: boolean; holdViews?: boolean; readError?: boolean; viewError?: boolean;
    annotationError?: boolean; registrationError?: boolean; detachError?: boolean; category?: string;
  } = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const a4 = source.slice(source.indexOf('test("A4,'));
    const block = a4.slice(a4.indexOf("let completionRequest:"), a4.indexOf("expect(completionRequest !== undefined)"));
    const original = new Error("original-ui-error");
    const privateError = new Error("synthetic-private-query-error");
    const primary = deferred<void>();
    const views = deferred<unknown>();
    const events = new EventEmitter();
    const unrelated = () => {};
    for (const event of ["request", "response", "requestfailed"]) events.on(event, unrelated);
    const entry = { id: receiptId, sessionId };
    const started = { id: swimFixture().workouts[0]!.id };
    const userId = "11111111-1111-4111-8111-111111111111";
    const baseURL = "http://127.0.0.1:3210";
    const request = (overrides: Partial<{ url: string; method: string; body: string; header: string }> = {}) => ({
      url: () => overrides.url ?? `${baseURL}/app/swim/${started.id}`,
      method: () => overrides.method ?? "POST",
      headers: () => ({ "next-action": overrides.header ?? "synthetic-action" }),
      postData: () => overrides.body ?? [entry.id, entry.sessionId, started.id].join(","),
    });
    const unused = vi.fn(() => { throw privateError; });
    const response = (paired: unknown, status: unknown = 200) => ({
      request: () => paired, status: () => status,
      headers: unused, body: unused, text: unused, json: unused, finished: unused,
    });
    let row: unknown = { id: sessionId, user_id: userId, completion_outbox_entry_id: null, completed_at: null };
    let pendingQueries = 0;
    const signals: AbortSignal[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/rest/v1/sessions");
      expect(url.searchParams.get("select")).toBe("id,user_id,completion_outbox_entry_id,completed_at");
      expect(url.searchParams.get("id")).toBe(`eq.${sessionId}`);
      expect(url.searchParams.get("user_id")).toBe(`eq.${userId}`);
      expect(init?.method).toBe("GET");
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      pendingQueries++;
      let abort: (() => void) | undefined;
      try {
        if (options.holdBackend) await new Promise<void>((_resolve, reject) => {
          abort = () => reject(new DOMException("Synthetic cancellation", "AbortError"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        if (options.readError) throw privateError;
        return Response.json(row);
      } finally {
        if (abort) signal.removeEventListener("abort", abort);
        pendingQueries--;
      }
    });
    const admin = createClient("http://127.0.0.1:54321", "synthetic-service", {
      global: { fetch }, auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const evaluateAll = vi.fn(async (classifier: unknown) => {
      if (options.holdViews) return await views.promise;
      if (options.viewError) throw privateError;
      return classifier === classifyWorkoutViewNodes ? { control: "log", result: "editing" } :
        { count: options.category ? 1 : 0, category: options.category ?? "absent" };
    });
    const locator = { or: () => locator, filter: () => locator, evaluateAll };
    const close = vi.fn(async () => { views.reject(privateError); });
    const on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      events.on(event, listener);
      if (options.registrationError && event === "response") throw privateError;
    });
    const off = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      events.off(event, listener);
      if (options.detachError) throw privateError;
    });
    const toBeVisible = vi.fn(() => primary.promise);
    const setOffline = vi.fn(async () => {});
    const testInfo = { annotations: [] as unknown[] };
    const execute = runInNewContext(transpileModule(`(async () => { ${block} return completionRequest; })`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      page: { on, off, getByRole: () => locator, close }, context: { setOffline }, admin,
      userId, entry, started, baseURL, testInfo, expect: () => ({ toBeVisible }),
      a4ReplayBackend, c2HttpClass, c2Transport, unavailableAlert,
      alertAnnotation: options.annotationError ? () => { throw privateError; } : alertAnnotation,
      classifyAlertNodes, classifyWorkoutViewNodes, SWIM_ALERT_CODEBOOK, validateAlertCategory,
      AbortController, URL, performance, setTimeout, clearTimeout,
    }) as () => Promise<unknown>;
    const execution = execute().then((captured) => ({ captured, error: undefined }), (error: unknown) => ({ captured: undefined, error }));
    await vi.advanceTimersByTimeAsync(0);
    async function finish(success = false) {
      if (success) primary.resolve();
      else primary.reject(original);
      const outcome = await execution;
      expect(outcome.error).toBe(success ? undefined : original);
      expect(toBeVisible).toHaveBeenCalledTimes(1);
      expect(toBeVisible).toHaveBeenCalledWith();
      expect(setOffline).toHaveBeenCalledTimes(1);
      expect(setOffline).toHaveBeenCalledWith(false);
      expect(signals.length).toBeGreaterThan(0);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(pendingQueries).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(off.mock.calls.map(([event]) => event)).toEqual(["request", "response", "requestfailed"]);
      for (const event of ["request", "response", "requestfailed"]) expect(events.listeners(event)).toEqual([unrelated]);
      expect(unused).not.toHaveBeenCalled();
      const reads = fetch.mock.calls.length + evaluateAll.mock.calls.length;
      const saved = JSON.stringify(testInfo.annotations);
      events.emit("request", request());
      events.emit("response", response(request()));
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetch.mock.calls.length + evaluateAll.mock.calls.length).toBe(reads);
      expect(JSON.stringify(testInfo.annotations)).toBe(saved);
      expect(saved).not.toMatch(/synthetic-|127\.0\.0\.1|completion_outbox_entry_id|completed_at/);
      for (const id of [userId, entry.id, entry.sessionId, started.id]) expect(saved).not.toContain(id);
      return { ...outcome, observations: readAlertAnnotations(testInfo.annotations) };
    }
    return {
      events, request, response, finish, close, fetch, evaluateAll,
      complete: () => { row = { id: sessionId, user_id: userId, completion_outbox_entry_id: receiptId, completed_at: "2026-09-10T00:00:00Z" }; },
    };
  }
  it.each([
    ["unseen", "request-unseen"], ["pending", "request-pending"], ["failed", "request-failed"],
    ["200", "http-2xx"], ["303", "http-3xx"], ["403", "http-4xx"], ["503", "http-5xx"],
    ["wrong-response", "request-pending"], ["wrong-failure", "request-pending"],
    ["later-request", "http-4xx"], ["invalid-status", "unavailable"], ["getter-error", "unavailable"],
  ])("pairs only the captured original request: %s", async (mode, expected) => {
    const harness = await observe();
    const original = harness.request();
    if (mode !== "unseen" && mode !== "getter-error") harness.events.emit("request", original);
    if (/^\d+$/.test(mode)) harness.events.emit("response", harness.response(original, Number(mode)));
    if (mode === "failed") harness.events.emit("requestfailed", original);
    if (mode === "wrong-response") harness.events.emit("response", harness.response(harness.request()));
    if (mode === "wrong-failure") harness.events.emit("requestfailed", harness.request());
    if (mode === "later-request") {
      const later = harness.request();
      harness.events.emit("request", later);
      harness.events.emit("response", harness.response(later));
      harness.events.emit("response", harness.response(original, 403));
    }
    if (mode === "invalid-status") harness.events.emit("response", harness.response(original, 0));
    if (mode === "getter-error") harness.events.emit("request", { url() { throw new Error("synthetic-private-url"); } });
    const result = await harness.finish(mode === "later-request");
    expect(result.observations?.[1]).toEqual({ ...unavailableAlert("a4-replay-transport"), result: expected });
    expect(result.observations?.[0]?.backend).toBe("not-reached");
    if (mode === "later-request") expect(result.captured).toBe(original);
  });
  it.each(["origin", "port", "path", "credentials", "method", "action", "receipt", "session", "workout"])(
    "does not capture a nonmatching %s", async (mode) => {
    const harness = await observe();
    const target = new URL(harness.request().url());
    if (mode === "origin") target.hostname = "example.invalid";
    if (mode === "port") target.port = "3211";
    if (mode === "path") target.pathname = "/app/swim/other";
    if (mode === "credentials") target.username = "synthetic";
    const override = {
      url: target.href, method: mode === "method" ? "GET" : "POST", header: mode === "action" ? "" : "synthetic-action",
      body: mode === "receipt" ? harness.request().postData().replace(receiptId, "") :
        mode === "session" ? harness.request().postData().replace(sessionId, "") :
          mode === "workout" ? `${receiptId},${sessionId}` : harness.request().postData(),
    };
    const other = harness.request(override);
    harness.events.emit("request", other);
    harness.events.emit("response", harness.response(other));
    harness.events.emit("requestfailed", other);
    expect((await harness.finish()).observations?.[1]?.result).toBe("request-unseen");
  });
  it.each(["absent", "client-queue", "server-stale", "unclassified"])(
    "samples independently of category %s for only the original five-second UI window", async (category) => {
      const harness = await observe({ category });
      harness.complete();
      await vi.advanceTimersByTimeAsync(4999);
      const queries = harness.fetch.mock.calls.length;
      expect(queries).toBeGreaterThan(1);
      expect(queries).toBeLessThanOrEqual(8);
      await vi.advanceTimersByTimeAsync(1);
      const original = harness.request();
      harness.events.emit("request", original);
      harness.events.emit("response", harness.response(original));
      const result = await harness.finish();
      expect(harness.fetch).toHaveBeenCalledTimes(queries);
      expect(result.observations?.[0]).toMatchObject({ category, backend: "reached", control: "log", result: "editing" });
      expect(result.observations?.[1]?.result).toBe("request-unseen");
      expect(harness.close).not.toHaveBeenCalled();
    },
  );
  it.each([true, false])("settles a pending SDK read on early UI success=%s without extra sampling", async (success) => {
    const harness = await observe({ holdBackend: true });
    const result = await harness.finish(success);
    expect(result.observations?.[0]?.backend).toBe("unavailable");
    expect(harness.fetch).toHaveBeenCalledOnce();
    expect(harness.close).not.toHaveBeenCalled();
  });
  it("aborts a pending SDK read at the deadline and closes only failed pending browser reads", async () => {
    const harness = await observe({ holdBackend: true, holdViews: true });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await harness.finish();
    expect(result.observations?.[0]).toEqual(unavailableAlert("a4-replay"));
    expect(harness.fetch).toHaveBeenCalledOnce();
    expect(harness.evaluateAll).toHaveBeenCalledTimes(2);
    expect(harness.close).toHaveBeenCalledOnce();
  });
  it.each(["readError", "viewError", "annotationError", "registrationError", "detachError"] as const)(
    "preserves the primary error through diagnostic %s", async (failure) => {
      const harness = await observe({ [failure]: true });
      const result = await harness.finish();
      if (failure === "annotationError") expect(result.observations).toEqual([]);
      if (failure === "readError") {
        expect(result.observations?.[0]?.backend).toBe("unavailable");
        expect(harness.fetch).toHaveBeenCalledOnce();
      }
      if (failure === "viewError") expect(result.observations?.[0]).toMatchObject({
        category: "unavailable", control: "unavailable", result: "unavailable",
      });
      if (failure === "registrationError" || failure === "detachError") expect(result.observations?.[1]?.result).toBe("unavailable");
    },
  );
});

describe("browser environment and static config", () => {
  it("B9 DC-SW5/DC-SW7/DC-SW8: preserves the accepted B source and decodes actual pinned decision arguments without diagnostics", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-decisions-offline-mobile.spec.ts"), "utf8");
    const boundary = source.indexOf('\n  test("B9 ');
    expect(boundary).toBeGreaterThan(0);
    expect(createHash("sha256").update(source.slice(source.indexOf("const test ="), boundary).trimEnd()).digest("hex"))
      .toBe("2c9b00c52dd8037ee6183cd56c0eece8105b395f183d1c22e5e2c1320f9454e7");
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
    };
    for (const args of [[plan.id, plan.revision, receiptId, "accepted"],
      [plan.id, plan.revision, preview.startDate], [preview]]) {
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
      getByRole: (_role: string, options: { name: string }) => options.name === "Swim plans" ? {
        getByRole: (_role: string, options?: { name: RegExp }) => {
          const id = options?.name.test("Archived") ? "old" : "new";
          return { id, click: async () => { pending = `http://127.0.0.1:3000/app/swim?plan=${id}`; } };
        },
      } : {},
    };
    const execute = runInNewContext(transpileModule(`(async () => { ${block} } })`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, {
      page, original: { planId: "old" }, replacementId: "new", URL,
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
  it("A6 DC-SW8: the authored Start clicks overlap before either settles", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const a6 = source.slice(source.indexOf('test("A6,'));
    const start = a6.indexOf("await Promise.all(pages.map((view) =>");
    const block = a6.slice(start, a6.indexOf("await Promise.all(pages.map(async (view) =>", start));
    const calls: number[] = [];
    const releases: Array<() => void> = [];
    const pages = [0, 1].map((index) => ({
      getByRole: (role: string, options: { name: string; exact: boolean }) => {
        expect([role, options.name, options.exact]).toEqual(["button", "Start swim", true]);
        return { click: ({ timeout }: { timeout: number }) => {
          expect(timeout).toBe(5000);
          calls.push(index);
          return new Promise<void>((resolve) => releases.push(resolve));
        } };
      },
    }));
    const execute = runInNewContext(transpileModule(`(async () => { ${block} })`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, { pages }) as () => Promise<void>;
    const pending = execute();
    try { expect(calls).toEqual([0, 1]); }
    finally { for (const release of releases) release(); }
    await pending;
  });
  it("A5 DC-SW7: the authored purge navigation waits for destination and removed state before reload", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const a5 = source.slice(source.indexOf('test("A5,'), source.indexOf('test("A6,'));
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
  it.each(["fast", "unseen", "pending", "failed", "unpaired", "wrong-origin", "wrong-path", "wrong-query",
    "wrong-method", "missing-action", "wrong-workout", "wrong-session", "invalid-owner", "wrong-receipt",
    "wrong-row-session", "wrong-row-owner", "null-time", "invalid-time", "held-read", "late-read", "read-error",
    "duplicate", "duplicate-response", "late-duplicate", "ambiguous", "duplicate-field", "duplicate-root",
    "held-view", "view-error", "cleanup-error", "click-error", "invalid-status", "response-error",
    "held-decoder", "held-decoder-success", "fast-success", "held-read-success", "held-view-success"])(
    "A7 DC-SW7/DC-SW8/DC-SW9: original Finish %s keeps the original assertion and bounded cleanup", async (mode) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      try {
        const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
        const a7 = source.slice(source.indexOf('  test("A7,'));
        const block = a7.slice(a7.indexOf('    {\n      const diagnostic'),
          a7.indexOf('    await expect(result.getByRole("button", { name: "Edit result"'));
        const helper = source.slice(source.indexOf("  async function submittedCompletionReceipt("), source.indexOf('  test("A3,'));
        const { isUuid } = await import("../../offline/outbox-core");
        const userId = mode === "invalid-owner" ? "invalid" : "11111111-1111-4111-8111-111111111111";
        const workoutId = swimFixture().workouts[0]!.id;
        const baseURL = "http://127.0.0.1:3210";
        const url = `${baseURL}/app/swim/${workoutId}?synthetic=1`;
        const installed = createRequire(join(webRoot, "package.json"));
        vi.stubGlobal("__webpack_require__", { u: vi.fn(() => { throw new Error("Unexpected chunk load."); }) });
        let encodeReply: (args: unknown[]) => Promise<FormData>;
        try { ({ encodeReply } = installed("next/dist/compiled/react-server-dom-webpack/client.browser")); }
        finally { vi.unstubAllGlobals(); }
        const form = new FormData();
        form.set("workoutId", mode === "wrong-workout" ? sessionId : workoutId);
        form.set("sessionId", mode === "wrong-session" ? workoutId : sessionId);
        form.set("clientLogId", receiptId);
        if (mode === "duplicate-field") form.append("clientLogId", receiptId);
        const wire = await encodeReply(mode === "ambiguous" ? [form, form] : [form]);
        if (mode === "duplicate-root") wire.append("0", '["$K1"]');
        const encoded = new Response(wire);
        const body = await encoded.text();
        const request = {
          url: () => mode === "wrong-origin" ? url.replace("3210", "3211") :
            mode === "wrong-path" ? url.replace(workoutId, sessionId) : mode === "wrong-query" ? url.replace("=1", "=2") : url,
          method: () => mode === "wrong-method" ? "GET" : "POST",
          headers: () => ({ "next-action": mode === "missing-action" ? "" : "synthetic-action",
            "content-type": encoded.headers.get("content-type") }),
          postData: () => body,
        };
        const events = new EventEmitter();
        const unrelated = () => {};
        for (const event of ["request", "response", "requestfailed"]) events.on(event, unrelated);
        let rejectPrimary!: (error: Error) => void;
        let resolvePrimary!: () => void;
        const primary = new Promise<void>((resolve, reject) => { resolvePrimary = resolve; rejectPrimary = reject; });
        const originalError = new Error("original-ui-error");
        const order: string[] = [];
        const toContainText = vi.fn(() => { order.push("assertion"); return primary; });
        const signals: AbortSignal[] = [];
        let releaseRead!: () => void;
        const lateRead = new Promise<void>((resolve) => { releaseRead = resolve; });
        const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(toContainText).toHaveBeenCalledTimes(1);
          order.push("receipt");
          const query = new URL(String(input));
          expect(query.pathname).toBe("/rest/v1/sessions");
          expect(query.searchParams.get("user_id")).toBe(`eq.${userId}`);
          expect(query.searchParams.get("id")).toBe(`eq.${sessionId}`);
          expect(query.searchParams.get("select")).toBe("id,user_id,completion_outbox_entry_id,completed_at");
          const signal = init!.signal as AbortSignal;
          signals.push(signal);
          if (mode.startsWith("held-read")) await new Promise<void>((_, reject) => {
            signal.addEventListener("abort", () => reject(new Error("synthetic-private-abort")), { once: true });
          });
          if (mode === "late-read") await lateRead;
          if (mode === "read-error") throw new Error("synthetic-private-read");
          return Response.json({ id: mode === "wrong-row-session" ? workoutId : sessionId,
            user_id: mode === "wrong-row-owner" ? workoutId : userId,
            completion_outbox_entry_id: mode === "wrong-receipt" ? workoutId : receiptId,
            completed_at: mode === "null-time" ? null : mode === "invalid-time" ? "invalid" : "2026-09-10T00:00:00Z" });
        });
        const admin = createClient("http://127.0.0.1:54321", "synthetic-service", {
          global: { fetch }, auth: { autoRefreshToken: false, persistSession: false },
        });
        let releaseView!: () => void;
        const heldView = new Promise<void>((resolve) => { releaseView = resolve; });
        const evaluateAll = vi.fn(async (classifier: unknown) => {
          expect(toContainText).toHaveBeenCalledTimes(1);
          order.push("view");
          if (mode.startsWith("held-view") || mode === "cleanup-error") await heldView;
          if (mode === "view-error") throw new Error("synthetic-private-view");
          return classifier === classifyWorkoutViewNodes ? { control: "log", result: "editing" } :
            { count: 0, category: "absent" };
        });
        const response = {
          request: () => {
            if (mode === "response-error") throw new Error("synthetic-private-response");
            return mode === "unpaired" ? {} : request;
          },
          status: () => mode === "invalid-status" ? 0 : 200,
        };
        const click = vi.fn(async () => {
          for (const event of ["request", "response", "requestfailed"]) expect(events.listenerCount(event)).toBe(2);
          order.push("click");
          if (mode === "click-error") throw originalError;
          if (mode === "unseen") return;
          events.emit("request", request);
          if (mode === "duplicate") events.emit("request", { ...request });
          if (mode === "failed") events.emit("requestfailed", request);
          else if (mode !== "pending") events.emit("response", response);
          if (mode === "duplicate-response") events.emit("response", response);
          expect(toContainText).not.toHaveBeenCalled();
          expect(fetch).not.toHaveBeenCalled();
          expect(evaluateAll).not.toHaveBeenCalled();
        });
        const locator = { or: () => locator, filter: () => locator, evaluateAll, click };
        const close = vi.fn(async () => {
          releaseView();
          if (mode === "cleanup-error") throw new Error("synthetic-private-close");
        });
        const testInfo = { annotations: [] as unknown[] };
        let releaseDecoder!: () => void;
        const heldDecoder = new Promise<void>((resolve) => { releaseDecoder = resolve; });
        class DecoderResponse extends Response {
          override async formData() {
            if (mode.startsWith("held-decoder")) await heldDecoder;
            return super.formData();
          }
        }
        const execute = runInNewContext(transpileModule(`${helper}\n(async () => { ${block} })`, {
          compilerOptions: { target: ScriptTarget.ES2022 },
        }).outputText, {
          page: { url: () => url, on: events.on.bind(events), off: events.off.bind(events), getByRole: () => locator, close },
          admin, userId, baseURL, testInfo, expect: () => ({ toContainText }), result: {}, lengths: 20,
          target: { id: workoutId }, startedWorkout: { session_id: sessionId },
          isUuid, a4ReplayBackend, c2HttpClass, c2Transport, unavailableAlert, alertAnnotation,
          classifyAlertNodes, classifyWorkoutViewNodes, SWIM_ALERT_CODEBOOK, validateAlertCategory,
          AbortController, URL, Response: DecoderResponse, performance, setTimeout, clearTimeout,
        }) as () => Promise<void>;
        const outcome = execute().catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(0);
        if (mode !== "click-error") {
          expect(toContainText).toHaveBeenCalledTimes(1);
          expect(toContainText).toHaveBeenCalledWith("20 lengths · 15:00 · RPE 6");
          expect(order.slice(0, 2)).toEqual(["click", "assertion"]);
          expect(evaluateAll).toHaveBeenCalledTimes(2);
          if (mode === "late-duplicate") events.emit("request", { ...request });
          if (mode.endsWith("-success")) resolvePrimary();
          else {
            await vi.advanceTimersByTimeAsync(5000);
            rejectPrimary(originalError);
          }
        }
        expect(await outcome).toBe(mode.endsWith("-success") ? undefined : originalError);
        expect(click).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledWith();
        expect(vi.getTimerCount()).toBe(0);
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(close).toHaveBeenCalledTimes(["held-view", "cleanup-error"].includes(mode) ? 1 : 0);
        for (const event of ["request", "response", "requestfailed"]) expect(events.listeners(event)).toEqual([unrelated]);
        const observations = readAlertAnnotations(testInfo.annotations)!;
        expect(observations).toHaveLength(2);
        expect(observations.map((value) => value.point)).toEqual(["a7-finish", "a7-finish-transport"]);
        const reached = ["fast", "fast-success", "held-view", "held-view-success", "view-error", "cleanup-error"].includes(mode);
        expect(observations[0]!.backend).toBe(reached ? "reached" : mode === "null-time" ? "not-reached" : "unavailable");
        const unseen = ["unseen", "wrong-origin", "wrong-path", "wrong-query", "wrong-method", "missing-action", "click-error"].includes(mode);
        const invalid = ["held-decoder", "held-decoder-success", "wrong-workout", "wrong-session", "invalid-owner", "duplicate", "duplicate-response", "invalid-status", "response-error",
          "late-duplicate", "ambiguous", "duplicate-field", "duplicate-root"].includes(mode);
        expect(observations[1]!.result).toBe(mode === "click-error" ? "unavailable" : unseen ? "request-unseen" : invalid ? "unavailable" :
          mode === "failed" ? "request-failed" : ["pending", "unpaired"].includes(mode) ? "request-pending" : "http-2xx");
        expect(fetch).toHaveBeenCalledTimes(unseen || invalid && mode !== "late-duplicate" ||
          ["pending", "failed", "unpaired"].includes(mode) ? 0 : 1);
        const saved = JSON.stringify(testInfo.annotations);
        for (const value of [userId, workoutId, sessionId, receiptId, "synthetic-", "127.0.0.1"]) expect(saved).not.toContain(value);
        releaseRead();
        releaseView();
        releaseDecoder();
        events.emit("response", response);
        await vi.advanceTimersByTimeAsync(5000);
        expect(JSON.stringify(testInfo.annotations)).toBe(saved);
        expect(evaluateAll).toHaveBeenCalledTimes(mode === "click-error" ? 0 : 2);
        expect(vi.getTimerCount()).toBe(0);
      } finally { vi.useRealTimers(); }
    },
  );
  it.each(["fast", "unseen", "pending", "failed", "unpaired", "wrong-origin", "wrong-path",
    "invalid-pair", "wrong-receipt", "null-time", "invalid-time", "held-read", "read-error", "duplicate"])(
    "A3 DC-SW7/DC-SW8: original Finish %s observation never gates or replaces the five-second UI goal", async (mode) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      try {
        const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
        const a3 = source.slice(source.indexOf('  test("A3,'));
        const block = a3.slice(a3.indexOf('    {\n      const diagnostic'), a3.indexOf("    await page.goto(original.url);"));
        const { isUuid } = await import("../../offline/outbox-core");
        const userId = "11111111-1111-4111-8111-111111111111";
        const workoutId = swimFixture().workouts[0]!.id;
        const baseURL = "http://127.0.0.1:3210";
        const url = `${baseURL}/app/swim/${workoutId}`;
        const request = {
          url: () => mode === "wrong-origin" ? url.replace("3210", "3211") :
            mode === "wrong-path" ? `${baseURL}/app/swim/${sessionId}` : url,
          method: () => "POST", headers: () => ({ "next-action": "synthetic-action" }),
        };
        const events = new EventEmitter();
        const unrelated = () => {};
        for (const event of ["request", "response", "requestfailed"]) events.on(event, unrelated);
        let rejectPrimary!: (error: Error) => void;
        const primary = new Promise<void>((_, reject) => { rejectPrimary = reject; });
        const originalError = new Error("original-ui-error");
        const toBeVisible = vi.fn(() => primary);
        const signals: AbortSignal[] = [];
        const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const query = new URL(String(input));
          expect(query.pathname).toBe("/rest/v1/sessions");
          expect(query.searchParams.get("user_id")).toBe(`eq.${userId}`);
          expect(query.searchParams.get("id")).toBe(`eq.${sessionId}`);
          expect(query.searchParams.get("select")).toBe("id,user_id,completion_outbox_entry_id,completed_at");
          const signal = init!.signal as AbortSignal;
          signals.push(signal);
          if (mode === "held-read") await new Promise<void>((_, reject) => {
            signal.addEventListener("abort", () => reject(new Error("synthetic-private-abort")), { once: true });
          });
          if (mode === "read-error") throw new Error("synthetic-private-read");
          return Response.json({ id: sessionId, user_id: userId,
            completion_outbox_entry_id: mode === "wrong-receipt" ? workoutId : receiptId,
            completed_at: mode === "null-time" ? null : mode === "invalid-time" ? "invalid" : "2026-09-10T00:00:00Z" });
        });
        const admin = createClient("http://127.0.0.1:54321", "synthetic-service", {
          global: { fetch }, auth: { autoRefreshToken: false, persistSession: false },
        });
        const evaluateAll = vi.fn(async (classifier: unknown) => classifier === classifyWorkoutViewNodes ?
          { control: "log", result: "editing" } : { count: 0, category: "absent" });
        const click = vi.fn(async () => {
          expect(events.listenerCount("response")).toBe(2);
          expect(events.listenerCount("requestfailed")).toBe(2);
          if (mode === "unseen") return;
          events.emit("request", request);
          if (mode === "duplicate") events.emit("request", { ...request });
          if (mode === "failed") events.emit("requestfailed", request);
          else if (mode !== "pending") events.emit("response", {
            request: () => mode === "unpaired" ? {} : request, status: () => 200,
          });
        });
        const locator = { or: () => locator, filter: () => locator, evaluateAll, click };
        const testInfo = { annotations: [] as unknown[] };
        const execute = runInNewContext(transpileModule(`(async () => { ${block} })`, {
          compilerOptions: { target: ScriptTarget.ES2022 },
        }).outputText, {
          page: { url: () => url, on: events.on.bind(events), off: events.off.bind(events), getByRole: () => locator },
          admin, userId, baseURL, testInfo, expect: () => ({ toBeVisible }),
          submittedCompletionReceipt: async () => mode === "invalid-pair" ? undefined : { sessionId, receiptId },
          isUuid, a4ReplayBackend, c2HttpClass, c2Transport, unavailableAlert, alertAnnotation,
          classifyAlertNodes, classifyWorkoutViewNodes, SWIM_ALERT_CODEBOOK, validateAlertCategory,
          AbortController, URL, performance, setTimeout, clearTimeout,
        }) as () => Promise<void>;
        const outcome = execute().catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(0);
        expect(toBeVisible).toHaveBeenCalledTimes(1);
        expect(toBeVisible).toHaveBeenCalledWith();
        await vi.advanceTimersByTimeAsync(5000);
        rejectPrimary(originalError);
        expect(await outcome).toBe(originalError);
        expect(click).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledWith();
        expect(vi.getTimerCount()).toBe(0);
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        for (const event of ["request", "response", "requestfailed"]) expect(events.listeners(event)).toEqual([unrelated]);
        const observations = readAlertAnnotations(testInfo.annotations)!;
        expect(observations).toHaveLength(2);
        expect(observations[0]!.backend).toBe(mode === "fast" ? "reached" :
          ["wrong-receipt", "null-time"].includes(mode) ? "not-reached" : "unavailable");
        expect(fetch).toHaveBeenCalledTimes(["fast", "wrong-receipt", "null-time", "invalid-time", "held-read", "read-error"].includes(mode) ? 1 : 0);
        const saved = JSON.stringify(testInfo.annotations);
        for (const value of [userId, workoutId, sessionId, receiptId, "synthetic-", "127.0.0.1"]) expect(saved).not.toContain(value);
        const reads = evaluateAll.mock.calls.length;
        events.emit("response", { request: () => request, status: () => 200 });
        await vi.advanceTimersByTimeAsync(5000);
        expect(evaluateAll).toHaveBeenCalledTimes(reads);
        expect(JSON.stringify(testInfo.annotations)).toBe(saved);
      } finally { vi.useRealTimers(); }
    },
  );
  it("A3 DC-SW7/DC-SW8: original completion pairing decodes pinned FormData and rejects ambiguous or invalid IDs", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const helper = source.slice(source.indexOf("  async function submittedCompletionReceipt("), source.indexOf('  test("A3,'));
    const { isUuid } = await import("../../offline/outbox-core");
    const verify = runInNewContext(transpileModule(`${helper}\nsubmittedCompletionReceipt`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, { Response, isUuid }) as (request: unknown, workout: string) => Promise<unknown>;
    const installed = createRequire(join(webRoot, "package.json"));
    expect(installed("next/package.json").version).toBe("16.2.6");
    expect(installed("react/package.json").version).toBe("19.2.4");
    vi.stubGlobal("__webpack_require__", { u: vi.fn(() => { throw new Error("Unexpected chunk load."); }) });
    let encodeReply: (args: unknown[]) => Promise<FormData>;
    try {
      ({ encodeReply } = installed("next/dist/compiled/react-server-dom-webpack/client.browser"));
    } finally { vi.unstubAllGlobals(); }
    const workoutId = swimFixture().workouts[0]!.id;
    for (const mode of ["valid", "wrong-workout", "invalid-session", "invalid-receipt", "duplicate",
      "missing-receipt", "ambiguous", "missing-root", "duplicate-root", "malformed-root", "wrong-reference", "suffix", "file"]) {
      const form = new FormData();
      form.set("workoutId", mode === "wrong-workout" ? sessionId : workoutId);
      form.set("sessionId", mode === "invalid-session" ? "invalid" : sessionId);
      form.set("clientLogId", mode === "invalid-receipt" ? "invalid" : receiptId);
      if (mode === "duplicate") form.append("clientLogId", receiptId);
      if (mode === "missing-receipt") form.delete("clientLogId");
      if (mode === "file") form.set("clientLogId", new Blob([receiptId]));
      const transport = await encodeReply(mode === "ambiguous" ? [form, form] : [form]);
      if (mode === "missing-root") transport.delete("0");
      if (mode === "duplicate-root") transport.append("0", '["$K1"]');
      if (mode === "malformed-root") transport.set("0", "not-json");
      if (mode === "wrong-reference") transport.set("0", '["$K2"]');
      if (mode === "suffix") transport.append("_2_clientLogId", receiptId);
      const encoded = new Response(transport);
      const body = await encoded.text();
      const result = await verify({
        postData: () => body, headers: () => ({ "content-type": encoded.headers.get("content-type") }),
      }, workoutId);
      expect(result).toEqual(mode === "valid" ? { sessionId, receiptId } : undefined);
    }
  });
  it("A6 DC-SW8: submitted edit proof decodes the pinned browser action encoder and fails closed", async () => {
    const source = readFileSync(join(webRoot, "e2e/swimming-lifecycle-load-mobile.spec.ts"), "utf8");
    const helper = source.slice(source.indexOf("  async function submittedEditRevision("), source.indexOf('  test("A5,'));
    const verify = runInNewContext(transpileModule(`${helper}\nsubmittedEditRevision`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, { Response, expect }) as (request: unknown, workout: string, session: string, revision: number) => Promise<void>;
    const installed = createRequire(join(webRoot, "package.json"));
    expect(installed("next/package.json").version).toBe("16.2.6");
    expect(installed("react/package.json").version).toBe("19.2.4");
    const loadChunk = vi.fn(() => { throw new Error("Unexpected chunk load."); });
    vi.stubGlobal("__webpack_require__", { u: loadChunk });
    let encodeReply: (args: unknown[]) => Promise<FormData>;
    try {
      ({ encodeReply } = installed("next/dist/compiled/react-server-dom-webpack/client.browser"));
    } finally { vi.unstubAllGlobals(); }
    for (const mode of [
      "stale", "refreshed", "wrong-workout", "wrong-session", "duplicate", "ambiguous",
      "missing-root", "duplicate-root", "malformed-root", "wrong-reference", "suffix", "file",
    ]) {
      const form = new FormData();
      form.set("workoutId", mode === "wrong-workout" ? "other-workout" : "synthetic-workout");
      form.set("sessionId", mode === "wrong-session" ? "other-session" : "synthetic-session");
      form.set("expectedRevision", mode === "refreshed" ? "4" : "3");
      if (mode === "duplicate") form.append("expectedRevision", "3");
      if (mode === "file") form.set("expectedRevision", new Blob(["3"]));
      const transport = await encodeReply(mode === "ambiguous" ? [form, form] : [form]);
      expect(transport.get("0")).toBe(mode === "ambiguous" ? '["$K1","$0:0"]' : '["$K1"]');
      expect(transport.has("_1_workoutId")).toBe(true);
      if (mode === "missing-root") transport.delete("0");
      if (mode === "duplicate-root") transport.append("0", '["$K1"]');
      if (mode === "malformed-root") transport.set("0", "not-json");
      if (mode === "wrong-reference") transport.set("0", '["$K2"]');
      if (mode === "suffix") transport.append("_2_expectedRevision", "3");
      const encoded = new Response(transport);
      const body = await encoded.text();
      const result = verify({
        postData: () => body, headers: () => ({ "content-type": encoded.headers.get("content-type") }),
      }, "synthetic-workout", "synthetic-session", 3);
      if (mode === "stale") await expect(result).resolves.toBeUndefined();
      else await expect(result).rejects.toThrow();
    }
    expect(loadChunk).not.toHaveBeenCalled();
  });
  it("DC-SW1/DC-SW2/DC-SW3/DC-SW4/DC-SW5/DC-SW6/DC-SW7/DC-SW8/DC-SW9/DC-K4: preserves the accepted twenty-five identities and appends only B9", () => {
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
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and offline durability",
        title: "B1 DC-SW4/DC-SW5: settled history advances only the unstarted next-week target once",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and offline durability",
        title: "B2 DC-SW8: native completion survives a committed lost response and replays before another session",
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
        describe: "ADR0079 later-cohort B swimming decisions and offline durability",
        title: "B3 DC-SW4/DC-SW5: plateau rejection preserves issued work and decision history",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and offline durability",
        title: "B4 DC-SW4/DC-SW5/DC-K4: missed high-effort work supports a recorded warning override without catch-up",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and offline durability",
        title: "B5 DC-SW4/DC-SW5: missing effort holds the next week without advancing targets",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and offline durability",
        title: "B6 DC-SW1/DC-SW3: a short calibrated budget preserves whole-length workout purpose",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and offline durability",
        title: "B7 DC-SW2/DC-SW3: an impossible calibrated budget creates no plan and can be corrected",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and offline durability",
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
        title: "A3, DC-SW7: replacing an archived swim plan preserves completed history and primary training",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A4, DC-SW7/DC-SW8/DC-SW9: an offline swim finishes after archival without duplicate history or load",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A5, DC-SW7/DC-SW9: permanent deletion removes a swim result while retaining its planned target",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A6, DC-SW5/DC-SW8/DC-SW9: concurrent starts share one swim and a stale result edit cannot overwrite its saved result",
      },
      {
        file: "e2e/swimming-lifecycle-load-mobile.spec.ts",
        describe: "ADR0079 mobile swimming lifecycle and regional load",
        title: "A7, DC-SW7/DC-SW9: a limitation added after start preserves the result and blocks future swimming",
      },
      {
        file: "e2e/swimming-decisions-offline-mobile.spec.ts",
        describe: "ADR0079 later-cohort B swimming decisions and offline durability",
        title: "B9 DC-SW5/DC-SW7/DC-SW8: concurrent reviewed recommendations and dates keep one accepted decision",
      },
    ]);
    expect(SWIM_BROWSER_CASES).toHaveLength(26);
    const files = [...new Set(SWIM_BROWSER_CASES.map(({ file }) => file))];
    expect(files).toHaveLength(6);
    expect(files.map((file) => SWIM_BROWSER_CASES.filter((item) => item.file === file).length)).toEqual([2, 4, 7, 9, 3, 1]);
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
      '})().catch(() => active() ? "read-error" as const : "not-confirmed-expired" as const);',
      "return await polling;",
      "} finally {", "controller.abort();", "clearTimeout(expiry);",
      "await Promise.allSettled([polling]);",
    ]) expect(poll).toContain(part);
    expect(poll.indexOf("if (!active())")).toBeLessThan(poll.indexOf("if (sample.error"));
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
    const a2 = source.slice(source.indexOf('test("A2,'), source.indexOf('test("A3,'));
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

describe("DC-SW1/DC-SW2/DC-SW3/DC-SW4/DC-SW5/DC-SW6/DC-SW7/DC-SW8/DC-SW9/DC-K4 strict twenty-six-case acceptance ledger", () => {
  function originalReport(count = 18) {
    const fixture = report();
    const b9 = fixture.suites[3]!.suites[0]!.specs.splice(8);
    expect(b9.map((spec) => spec.title)).toEqual(SWIM_BROWSER_CASES.slice(25).map((item) => item.title));
    if (count <= 24) {
      const a7 = fixture.suites[2]!.suites[0]!.specs.splice(6);
      expect(a7.map((spec) => spec.title)).toEqual(SWIM_BROWSER_CASES.slice(24, 25).map((item) => item.title));
    }
    if (count <= 22) {
      const appended = fixture.suites[2]!.suites[0]!.specs.splice(4);
      expect(appended.map((spec) => spec.title)).toEqual(SWIM_BROWSER_CASES.slice(22, 24).map((item) => item.title));
    }
    if (count <= 20) {
      const lifecycle = fixture.suites[2]!.suites[0]!.specs.splice(2);
      expect(lifecycle.map((spec) => spec.title)).toEqual(SWIM_BROWSER_CASES.slice(20, 22).map((item) => item.title));
    }
    if (count <= 18) {
      const removed = fixture.suites[1]!.suites[0]!.specs.splice(2);
      expect(removed.map((spec) => spec.title)).toEqual(SWIM_BROWSER_CASES.slice(18, 20).map((item) => item.title));
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
      success: true, counts: { expected: 26, unexpected: 0, flaky: 0, skipped: 0 },
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
  it("rejects the accepted original-twenty-two report by removing only A5/A6/A7", () => {
    const fixture = originalReport(22);
    fixture.stats.expected = 22;
    expect(fixture.suites).toHaveLength(6);
    expectOriginalCohort(fixture, 22);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects the accepted original-twenty-four report by removing only A7", () => {
    const fixture = originalReport(24);
    fixture.stats.expected = 24;
    expect(fixture.suites).toHaveLength(6);
    expectOriginalCohort(fixture, 24);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects the accepted original-twenty-five report without B9", () => {
    const fixture = originalReport(25);
    fixture.stats.expected = 25;
    expect(fixture.suites).toHaveLength(6);
    expectOriginalCohort(fixture, 25);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("rejects a duplicate B8 in place of B9 even with twenty-six results", () => {
    const fixture = report();
    fixture.suites[3]!.suites[0]!.specs[8]!.title = SWIM_BROWSER_CASES[17]!.title;
    expect(rejectedReport(fixture).success).toBe(false);
  });
  it.each([20, 21, 22, 23, 24].flatMap((missing) =>
    [4, 5, 20, 21, 22, 23, 24].filter((replacement) => replacement !== missing).map((replacement) => [missing, replacement]),
  ))("rejects missing A casebook index %d replaced by %d with twenty-six results", (missing, replacement) => {
    const fixture = report();
    const suite = fixture.suites[2]!.suites[0]!;
    const spec = suite.specs.find((item) => item.title === SWIM_BROWSER_CASES[missing]!.title)!;
    spec.title = SWIM_BROWSER_CASES[replacement]!.title;
    expect(suite.specs).toHaveLength(7);
    expect(fixture.suites).toHaveLength(6);
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(26);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it.each([18, 19].flatMap((missing) =>
    [2, 3, 18, 19].filter((replacement) => replacement !== missing).map((replacement) => [missing, replacement]),
  ))("rejects missing E casebook index %d replaced by %d with twenty-six results", (missing, replacement) => {
    const fixture = report();
    const suite = fixture.suites[1]!.suites[0]!;
    const spec = suite.specs.find((item) => item.title === SWIM_BROWSER_CASES[missing]!.title)!;
    spec.title = SWIM_BROWSER_CASES[replacement]!.title;
    expect(suite.specs).toHaveLength(4);
    expect(fixture.suites).toHaveLength(6);
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(26);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it.each([0, 1])("does not substitute account case %d for missing C3 even with twenty-six results", (index) => {
    const fixture = report();
    const suite = fixture.suites[4]!.suites[0]!;
    suite.specs[2] = suite.specs[index]!;
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(26);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it("does not substitute another C case for missing D even with twenty-six results", () => {
    const fixture = report();
    fixture.suites.pop();
    fixture.suites[4]!.suites[0]!.specs.push(fixture.suites[4]!.suites[0]!.specs[0]!);
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(26);
    expect(rejectedReport(fixture)).toEqual({ success: false, code: "browser-report-schema" });
  });
  it.each([12, 13, 14, 15, 16, 17].flatMap((missing) =>
    [6, 7, 12, 13, 14, 15, 16, 17].filter((replacement) => replacement !== missing).map((replacement) => [missing, replacement]),
  ))("rejects missing casebook index %d replaced by %d with twenty-six results", (missing, replacement) => {
    const fixture = report();
    const suite = fixture.suites[3]!.suites[0]!;
    const spec = suite.specs.find((item) => item.title === SWIM_BROWSER_CASES[missing]!.title)!;
    spec.title = SWIM_BROWSER_CASES[replacement]!.title;
    expect(suite.specs).toHaveLength(9);
    expect(fixture.suites).toHaveLength(6);
    expect(fixture.suites.flatMap((file) => file.suites[0]!.specs)).toHaveLength(26);
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
      expect(projection.code).toBe(["missing", "extra", "unexecuted", "duplicate", "identity"].includes(mode)
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
  it("projects bounded allowlisted callers and only the known private boolean comparison", () => {
    const file = "e2e/swimming-decisions-offline-mobile.spec.ts";
    expect(readFileSync(join(webRoot, file), "utf8").split("\n")[70])
      .toContain('expect(isDeepStrictEqual(actual, expected), "Private fixture comparison").toBe(true)');
    const stack = "Error: Private fixture comparison\n\nexpect(received).toBe(expected) // Object.is equality\n\n" +
      `Expected: true\nReceived: false\n\n    at same (${join(webRoot, file)}:71:3)\n` +
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
    Object.assign(result, { errors: [{ stack, location: { file: join(webRoot, file), line: 71, column: 3 } }] });
    const projection = rejectedReport(fixture);
    expect(projection.cases?.[0]?.attributedSources).toEqual([{ source: "swimming-decisions-offline-mobile", line: 71 }]);
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
          "projects A7 %s only at index24 without changing its failed result or the frozen ledger", (mode) => {
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
            caseTest(fixture, 24).results[0]!.status = "failed";
            const projection = rejectedReport(fixture);
            expect(projection.code).toBe("browser-failed");
            expect(projection.cases?.[24]?.status).toBe("failed");
            expect(projection.cases?.map(({ alertObservations }) => alertObservations)).toEqual(
              SWIM_BROWSER_CASES.map((_, index) => index !== 24 ? unavailableObservations(index) :
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
              expect(projection.cases).toHaveLength(26);
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
            expect(projection.cases).toHaveLength(26);
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
          expect(projection.cases).toHaveLength(26);
          expect(projection.cases?.map(({ alertObservations }) => alertObservations)).toEqual([
            [], [], [], observations.slice(0, 2), [observations[2]], observations.slice(3), [], [], [],
            [unavailableAlert("c2-auth-absence")], [], [], [], [], [], [], [], [], [], [],                         unavailableObservations(20), unavailableObservations(21), [], [], unavailableObservations(24), [],
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
            expect(projection.cases).toHaveLength(26);
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
          expect(projection.cases).toHaveLength(26);
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
            expect(projection.cases).toHaveLength(26);
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
            expect(projection.cases).toHaveLength(26);
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
