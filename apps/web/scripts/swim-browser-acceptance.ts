import {
  closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync,
  type Stats,
} from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { isDedicatedSwimEnvironment } from "../e2e/fixtures/swim-environment";
import { acceptanceAssert as assert } from "./swim-acceptance-errors";

export const SWIM_BROWSER_CASES = Object.freeze([
  Object.freeze({
    file: "e2e/swimming-mobile.spec.ts", describe: "ADR0079 standalone swimming",
    title: "blockless setup, local progress, offline finish and native history",
  }),
  Object.freeze({
    file: "e2e/swimming-mobile.spec.ts", describe: "ADR0079 standalone swimming",
    title: "custom pool entry survives validation and compact repeats retain progress",
  }),
  Object.freeze({
    file: "e2e/swimming-persistence-mobile.spec.ts",
    describe: "ADR0079 mobile swimming persistence and isolation",
    title: "DC-SW1/DC-SW8: native course and planned workouts survive reload and a second same-user mobile context",
  }),
  Object.freeze({
    file: "e2e/swimming-persistence-mobile.spec.ts",
    describe: "ADR0079 mobile swimming persistence and isolation",
    title: "DC-SW1/DC-SW8: two mobile users retain distinct usable plans and cannot start or change each other's workouts",
  }),
]);

export const BROWSER_LIMITS = Object.freeze({
  build: 180_000, ready: 60_000, browserCommand: 330_000, shutdown: 10_000,
  allowance: 10_000, required: 590_000, serverLifetime: 410_000,
  globalTimeout: 300_000, testTimeout: 30_000,
});
const BASE_URL = "http://127.0.0.1:3210";
const PROJECT = "mobile-chromium";
const MAX_REPORT_BYTES = 8 * 1024 * 1024;
type Env = Readonly<Record<string, string | undefined>>;
type FailureCode = "browser-environment" | "browser-paths" | "browser-env-files" |
  "browser-port" | "browser-budget" | "browser-readiness-timeout" | "browser-cancelled" |
  "browser-server-exited" | "browser-report-absent" | "browser-report-file" | "browser-report-schema" | "browser-failed";
const failures = new WeakMap<object, FailureCode>();
const failureLedgers = new WeakMap<object, {
  cases: Array<(typeof SWIM_BROWSER_CASES)[number] & {
    status: z.infer<typeof resultStatusSchema>; testStatus: z.infer<typeof testStatusSchema>;
    expectedStatus: z.infer<typeof resultStatusSchema>; attempts: number;
  }>;
  counts: { expected: number; unexpected: number; flaky: number; skipped: number };
}>();

function requireCondition(value: unknown, code: FailureCode): asserts value {
  try { assert(value, code); } catch (error) {
    if (error && typeof error === "object") failures.set(error, code);
    throw error;
  }
}
function failure(code: FailureCode): never { requireCondition(false, code); throw new Error(code); }
export function projectBrowserFailure(error: unknown) {
  return {
    success: false as const,
    code: error && typeof error === "object" ? failures.get(error) ?? "browser-failed" : "browser-failed",
    ...(error && typeof error === "object" ? failureLedgers.get(error) : undefined),
  };
}

export function browserBudget(remainingMs: number) {
  requireCondition(Number.isSafeInteger(remainingMs) && remainingMs >= BROWSER_LIMITS.required, "browser-budget");
  return BROWSER_LIMITS;
}

export type BrowserPaths = Readonly<{ runDirectory: string; reportPath: string; outputDir: string }>;
export function requireBrowserPaths(paths: BrowserPaths) {
  requireCondition(Object.values(paths).every((path) => isAbsolute(path) && resolve(path) === path) &&
    /^swim-acceptance-pr802-[1-9][0-9]*-[1-9][0-9]*$/.test(basename(paths.runDirectory)) &&
    paths.reportPath === join(paths.runDirectory, "browser.json") &&
    paths.outputDir === join(paths.runDirectory, "browser-output"), "browser-paths");
  return paths;
}

export function requireBrowserEnvironment(env: Env) {
  requireCondition(env.CI === "true" && env.PLAYWRIGHT_BASE_URL === BASE_URL &&
    env.E2E_REQUIRE_SEED === "1" && env.E2E_SWIM_NONPROD === "1" &&
    env.E2E_SWIM_LOCAL === "1" && env.SWIM_TEST_PROJECT_REF === "local" &&
    env.E2E_SUPABASE_URL === "http://127.0.0.1:54321" &&
    env.NEXT_PUBLIC_SUPABASE_URL === env.E2E_SUPABASE_URL &&
    !!env.E2E_SUPABASE_ANON_KEY && env.NEXT_PUBLIC_SUPABASE_ANON_KEY === env.E2E_SUPABASE_ANON_KEY &&
    isDedicatedSwimEnvironment(env), "browser-environment");
  const reportPath = env.HTA_SWIM_BROWSER_REPORT ?? "";
  return requireBrowserPaths({
    runDirectory: dirname(reportPath), reportPath, outputDir: env.HTA_SWIM_BROWSER_OUTPUT_DIR ?? "",
  });
}

export function buildBrowserEnv(
  target: Readonly<{ url: string; anonKey: string; serviceRoleKey: string; projectRef: string }>,
  paths: BrowserPaths,
): Record<string, string> {
  requireBrowserPaths(paths);
  const env = {
    CI: "true", NODE_ENV: "production", PLAYWRIGHT_BASE_URL: BASE_URL,
    E2E_REQUIRE_SEED: "1", E2E_SWIM_NONPROD: "1", E2E_SWIM_LOCAL: "1",
    SWIM_TEST_PROJECT_REF: target.projectRef, E2E_SUPABASE_URL: target.url,
    E2E_SUPABASE_ANON_KEY: target.anonKey, E2E_SUPABASE_SERVICE_ROLE_KEY: target.serviceRoleKey,
    NEXT_PUBLIC_SUPABASE_URL: target.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: target.anonKey,
    POOL_SWIMMING_ENABLED: "true",
    HTA_SWIM_BROWSER_REPORT: paths.reportPath, HTA_SWIM_BROWSER_OUTPUT_DIR: paths.outputDir,
  };
  requireBrowserEnvironment(env);
  return env;
}

export function requireNoEnvFiles(repoRoot: string) {
  try {
    for (const directory of [repoRoot, join(repoRoot, "apps/web")]) {
      requireCondition(!readdirSync(directory).some((name) =>
        name === ".env" || (name.startsWith(".env.") && ![".env.example", ".env.template"].includes(name))),
      "browser-env-files");
    }
  } catch { failure("browser-env-files"); }
}

// This only checks that the port is free now; it does not establish ownership after spawn.
export async function requireFreePort() {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", () => {
      try { failure("browser-port"); } catch (error) { reject(error); }
    });
    server.listen({ host: "127.0.0.1", port: 3210, exclusive: true }, () => {
      server.close((error) => {
        if (error) {
          try { failure("browser-port"); } catch (failureError) { reject(failureError); }
        } else resolvePromise();
      });
    });
  });
}

function probe(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let ready = false;
    const req = request(`${BASE_URL}/`, { method: "GET", signal }, (response) => {
      ready = response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 400;
      response.destroy();
    });
    req.on("error", () => { ready = false; });
    req.once("close", () => resolvePromise(ready));
    req.setTimeout(1_000, () => req.destroy());
    req.end();
  });
}

export async function waitForBrowserReady(options: Readonly<{
  serverExit: Promise<unknown>; signal: AbortSignal; timeoutMs?: number;
}>) {
  const timeoutMs = options.timeoutMs ?? BROWSER_LIMITS.ready;
  requireCondition(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= BROWSER_LIMITS.ready,
    "browser-budget");
  const controller = new AbortController();
  let observing = true;
  let stopped: FailureCode | undefined;
  const stop = (code: FailureCode) => {
    if (observing) { stopped ??= code; controller.abort(); }
  };
  const cancel = () => stop("browser-cancelled");
  options.signal.addEventListener("abort", cancel, { once: true });
  if (options.signal.aborted) cancel();
  const timer = setTimeout(() => stop("browser-readiness-timeout"), timeoutMs);
  const exited = options.serverExit.then(
    () => stop("browser-server-exited"), () => stop("browser-server-exited"),
  );
  const polling = (async () => {
    while (!controller.signal.aborted) {
      if (await probe(controller.signal)) return;
      await delay(100, undefined, { signal: controller.signal }).catch(() => undefined);
    }
  })();
  try {
    await Promise.race([polling, exited]);
    if (stopped) failure(stopped);
    return { status: "ready" as const };
  } finally {
    observing = false;
    clearTimeout(timer);
    options.signal.removeEventListener("abort", cancel);
    controller.abort();
    await polling;
  }
}

function owned(stat: Stats, mode: number) {
  return typeof process.getuid === "function" && stat.uid === process.getuid() && (stat.mode & 0o7777) === mode;
}
function absent(path: string) {
  try { lstatSync(path); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
}
function identity(a: Stats, b: Stats) { return a.dev === b.dev && a.ino === b.ino; }

function requirePrivateBrowserRoot(paths: BrowserPaths, webRoot: string) {
  requireBrowserPaths(paths);
  try {
    requireCondition(isAbsolute(webRoot) && realpathSync(webRoot) === webRoot, "browser-paths");
    const checkout = resolve(webRoot, "../..");
    const fromCheckout = relative(checkout, paths.runDirectory);
    requireCondition(fromCheckout === ".." || fromCheckout.startsWith(`..${sep}`) || isAbsolute(fromCheckout),
      "browser-paths");
    const root = lstatSync(paths.runDirectory);
    requireCondition(root.isDirectory() && owned(root, 0o700) &&
      realpathSync(paths.runDirectory) === paths.runDirectory, "browser-paths");
    return root;
  } catch { failure("browser-paths"); }
}

export function requirePrivateBrowserPaths(paths: BrowserPaths, webRoot: string) {
  const root = requirePrivateBrowserRoot(paths, webRoot);
  try {
    if (!absent(paths.outputDir)) {
      const output = lstatSync(paths.outputDir);
      requireCondition(output.isDirectory() && owned(output, 0o700) &&
        realpathSync(paths.outputDir) === paths.outputDir, "browser-paths");
    }
    return root;
  } catch { failure("browser-paths"); }
}

export type BrowserReportTicket = Readonly<{
  paths: BrowserPaths; webRoot: string; startedAt: number;
}>;
const tickets = new WeakMap<BrowserReportTicket, Stats>();
export function prepareSwimBrowserReport(paths: BrowserPaths, webRoot: string): BrowserReportTicket {
  const root = requirePrivateBrowserPaths(paths, webRoot);
  requireCondition(absent(paths.reportPath), "browser-report-file");
  const ticket = Object.freeze({ paths: Object.freeze({ ...paths }), webRoot, startedAt: Date.now() });
  tickets.set(ticket, root);
  return ticket;
}

function presentReport(path: string, checkRoot: () => void) {
  try { return lstatSync(path); }
  catch (error) {
    checkRoot();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") failure("browser-report-absent");
    throw error;
  }
}

export function sealSwimBrowserReport(ticket: BrowserReportTicket) {
  try {
    requireCondition(tickets.has(ticket), "browser-report-file");
    const originalRoot = tickets.get(ticket)!;
    const checkRoot = () => requireCondition(
      identity(originalRoot, requirePrivateBrowserRoot(ticket.paths, ticket.webRoot)), "browser-report-file",
    );
    checkRoot();
    presentReport(ticket.paths.reportPath, checkRoot);
    const seal = (path: string, directory: boolean) => {
      let fd: number | undefined;
      try {
        checkRoot();
        try {
          fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW |
            (directory ? constants.O_DIRECTORY : constants.O_NONBLOCK));
        } catch (error) {
          if (directory && (error as NodeJS.ErrnoException).code === "ENOENT") {
            requireCondition(absent(path), "browser-report-file");
            return;
          }
          throw error;
        }
        const stat = fstatSync(fd);
        requireCondition(typeof process.getuid === "function" && stat.uid === process.getuid() &&
          (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1 &&
            stat.size > 0 && stat.size <= MAX_REPORT_BYTES), "browser-report-file");
        checkRoot();
        requireCondition(identity(stat, lstatSync(path)), "browser-report-file");
        fchmodSync(fd, directory ? 0o700 : 0o600);
        requireCondition(identity(stat, lstatSync(path)), "browser-report-file");
        checkRoot();
      } finally { if (fd !== undefined) closeSync(fd); }
    };
    seal(ticket.paths.reportPath, false);
    seal(ticket.paths.outputDir, true);
  } catch (error) {
    if (error && typeof error === "object" && failures.get(error) === "browser-report-absent") throw error;
    failure("browser-report-file");
  }
}

// Playwright 1.60.0 JSONReport types and src/reporters/json.ts: rootDir-relative
// locations, merged file-suite wrappers, then describe suites and individual specs.
const resultStatusSchema = z.enum(["passed", "failed", "timedOut", "skipped", "interrupted"]);
const testStatusSchema = z.enum(["expected", "unexpected", "flaky", "skipped"]);
const resultSchema = z.object({
  retry: z.number().int().min(0).max(99), status: resultStatusSchema,
  error: z.unknown().transform((value) => value !== undefined),
  errors: z.array(z.unknown()).transform((value) => value.length),
});
const specSchema = z.object({
  file: z.string(), title: z.string(), ok: z.boolean(),
  tests: z.array(z.object({
    timeout: z.literal(30_000),
    projectId: z.literal(PROJECT), projectName: z.literal(PROJECT),
    expectedStatus: resultStatusSchema, status: testStatusSchema,
    results: z.array(resultSchema).min(1).max(100),
  })).length(1),
});
const suiteSchema = z.object({
  title: z.string(), file: z.string(), specs: z.array(z.unknown()),
  suites: z.array(z.unknown()).optional(),
});
const reportSchema = z.object({
  config: z.object({
    version: z.literal("1.60.0"), rootDir: z.string(),
    workers: z.literal(1), fullyParallel: z.literal(false), forbidOnly: z.literal(true),
    globalTimeout: z.literal(300_000),
    projects: z.array(z.object({
      id: z.literal(PROJECT), name: z.literal(PROJECT), testDir: z.string(), outputDir: z.string(),
      repeatEach: z.literal(1), retries: z.literal(0), timeout: z.literal(30_000),
      testMatch: z.array(z.string()), testIgnore: z.array(z.string()).length(0),
    })).length(1),
  }),
  suites: z.array(z.unknown()).length(2), errors: z.array(z.unknown()).transform((value) => value.length),
  stats: z.object({
    expected: z.number().int().min(0).max(4), unexpected: z.number().int().min(0).max(4),
    flaky: z.number().int().min(0).max(4), skipped: z.number().int().min(0).max(4),
  }),
});

export function validateSwimBrowserReport(text: string, paths: BrowserPaths, webRoot: string) {
  try {
    const report = reportSchema.parse(JSON.parse(text));
    const rootDir = join(webRoot, "e2e");
    const posix = (path: string) => path.split(sep).join("/");
    const project = report.config.projects[0]!;
    requireCondition(report.config.rootDir === posix(rootDir) && project.testDir === posix(rootDir) &&
      project.outputDir === posix(paths.outputDir), "browser-report-schema");
    const expectedFiles = [...new Set(SWIM_BROWSER_CASES.map(({ file }) => file))];
    requireCondition(JSON.stringify([...project.testMatch].sort()) ===
      JSON.stringify(expectedFiles.map((file) => posix(join(webRoot, file))).sort()), "browser-report-schema");
    const canonicalFile = (file: string) => {
      const canonical = expectedFiles.find((expected) => resolve(rootDir, file) === join(webRoot, expected));
      requireCondition(canonical, "browser-report-schema");
      return canonical;
    };
    const seen = new Set<number>();
    const specs = new Map<number, z.infer<typeof specSchema>>();
    const files = new Set<string>();
    for (const rawFile of report.suites) {
      const fileSuite = suiteSchema.parse(rawFile);
      const file = canonicalFile(fileSuite.file);
      requireCondition(!files.has(file) && fileSuite.specs.length === 0 &&
        fileSuite.title === relative(rootDir, join(webRoot, file)).split(sep).join("/") &&
        fileSuite.suites?.length === 1, "browser-report-schema");
      files.add(file);
      const describe = suiteSchema.parse(fileSuite.suites[0]);
      requireCondition(canonicalFile(describe.file) === file && !describe.suites?.length &&
        describe.specs.length === 2, "browser-report-schema");
      for (const rawSpec of describe.specs) {
        const spec = specSchema.parse(rawSpec);
        requireCondition(canonicalFile(spec.file) === file, "browser-report-schema");
        const index = SWIM_BROWSER_CASES.findIndex((expected) =>
          expected.file === file && expected.describe === describe.title && expected.title === spec.title);
        requireCondition(index >= 0 && !seen.has(index), "browser-report-schema");
        seen.add(index);
        specs.set(index, spec);
      }
    }
    requireCondition(seen.size === 4, "browser-report-schema");
    const allPassed = [...specs.values()].every((spec) => {
      const test = spec.tests[0]!;
      const result = test.results[0]!;
      return spec.ok && test.status === "expected" && test.expectedStatus === "passed" &&
        test.results.length === 1 && result.retry === 0 && result.status === "passed" &&
        !result.error && result.errors === 0;
    });
    try {
      requireCondition(allPassed && report.errors === 0 && report.stats.expected === 4 &&
        report.stats.unexpected === 0 && report.stats.flaky === 0 && report.stats.skipped === 0,
      "browser-failed");
    } catch (error) {
      if (error && typeof error === "object") failureLedgers.set(error, {
        counts: { ...report.stats },
        cases: SWIM_BROWSER_CASES.map((item, index) => {
          const test = specs.get(index)!.tests[0]!;
          return { ...item, status: test.results.at(-1)!.status, testStatus: test.status,
            expectedStatus: test.expectedStatus, attempts: test.results.length };
        }),
      });
      throw error;
    }
    return {
      success: true as const, counts: { expected: 4, unexpected: 0, flaky: 0, skipped: 0 },
      cases: SWIM_BROWSER_CASES.map((item) => ({ ...item, status: "passed" as const })),
    };
  } catch (error) {
    if (error && typeof error === "object" && failures.has(error)) throw error;
    failure("browser-report-schema");
  }
}

export function readSwimBrowserReport(ticket: BrowserReportTicket) {
  let fd: number | undefined;
  let text: string;
  try {
    requireCondition(tickets.has(ticket), "browser-report-file");
    const originalRoot = tickets.get(ticket)!;
    tickets.delete(ticket);
    const root = requirePrivateBrowserPaths(ticket.paths, ticket.webRoot);
    requireCondition(identity(root, originalRoot), "browser-report-file");
    const path = ticket.paths.reportPath;
    const before = presentReport(path, () => requireCondition(
      identity(root, requirePrivateBrowserPaths(ticket.paths, ticket.webRoot)), "browser-report-file",
    ));
    const valid = (stat: Stats) => stat.isFile() && owned(stat, 0o600) && stat.nlink === 1 &&
      stat.size > 0 && stat.size <= MAX_REPORT_BYTES &&
      stat.mtimeMs >= ticket.startedAt && Math.floor(stat.mtimeMs) <= Date.now();
    requireCondition(valid(before), "browser-report-file");
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    requireCondition(valid(opened) && identity(before, opened), "browser-report-file");
    const buffer = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, offset);
      requireCondition(count > 0, "browser-report-file");
      offset += count;
    }
    for (const after of [fstatSync(fd), lstatSync(path)]) {
      requireCondition(valid(after) && identity(opened, after) && after.size === opened.size &&
        after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs, "browser-report-file");
    }
    requireCondition(identity(root, requirePrivateBrowserPaths(ticket.paths, ticket.webRoot)), "browser-report-file");
    text = buffer.toString("utf8");
  } catch (error) {
    if (error && typeof error === "object" && failures.get(error) === "browser-report-absent") throw error;
    failure("browser-report-file");
  }
  finally { if (fd !== undefined) closeSync(fd); }
  return validateSwimBrowserReport(text, ticket.paths, ticket.webRoot);
}
