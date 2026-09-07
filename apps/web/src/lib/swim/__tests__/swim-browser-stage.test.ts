import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_LIMITS, SWIM_BROWSER_CASES, prepareSwimBrowserReport, projectBrowserFailure,
  readSwimBrowserReport, requireFreePort, requireNoEnvFiles, waitForBrowserReady,
} from "../../../../scripts/swim-browser-acceptance";
import {
  requireSwimBrowserCache, runSwimBrowserStage, type BrowserCommand,
} from "../../../../scripts/swim-browser-stage";
import { AcceptanceReporting, safeFailureCause } from "../../../../scripts/swim-acceptance-reporting";

vi.mock("../../../../scripts/swim-browser-acceptance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../scripts/swim-browser-acceptance")>();
  return {
    ...actual,
    requireNoEnvFiles: vi.fn(actual.requireNoEnvFiles),
    requireFreePort: vi.fn(async () => {}),
    waitForBrowserReady: vi.fn(async () => ({ status: "ready" })),
    prepareSwimBrowserReport: vi.fn(actual.prepareSwimBrowserReport),
    readSwimBrowserReport: vi.fn(),
  };
});
const root = resolve(__dirname, "../../../../../..");
const temporary: string[] = [];
const passed = { code: 0, signal: null, timedOut: false };
const stopped = { code: null, signal: "SIGTERM", timedOut: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireNoEnvFiles).mockReset();
  vi.mocked(requireNoEnvFiles).mockImplementation(() => {});
  vi.mocked(requireFreePort).mockReset().mockResolvedValue(undefined);
  vi.mocked(waitForBrowserReady).mockReset().mockResolvedValue({ status: "ready" });
  vi.useRealTimers();
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function setup() {
  const temp = mkdtempSync(join(tmpdir(), "swim-browser-stage-unit-"));
  temporary.push(temp);
  const runDirectory = join(temp, "swim-acceptance-pr802-123-1");
  const cache = join(temp, "swim-browser-cache-swim-acceptance-123-1");
  mkdirSync(runDirectory, { mode: 0o700 });
  mkdirSync(cache, { mode: 0o700 });
  const cacheEnv = { GITHUB_JOB: "swim-acceptance", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
    RUNNER_TEMP: temp, PLAYWRIGHT_BROWSERS_PATH: cache };
  const server = deferred<{ result: typeof stopped | typeof passed }>();
  const browser = deferred<{ result: typeof stopped | typeof passed }>();
  const browserStarted = deferred<void>();
  const controller = new AbortController();
  const manifest: Record<string, unknown> = {};
  const reporting = new AcceptanceReporting();
  const events: string[] = [];
  let terminal: (() => void) | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    terminal?.();
  };
  const stopServer = vi.fn(() => {
    events.push("stop-server");
    close();
    server.resolve({ result: stopped });
  });
  const stopBrowser = vi.fn(() => {
    events.push("stop-browser");
    browser.resolve({ result: stopped });
  });
  const command = vi.fn<BrowserCommand>(async (_executable, args, options) => {
    if (args[1] === "build") { events.push("build"); return { result: passed }; }
    if (args[1] === "start") {
      events.push("start");
      terminal = options.onTerminal;
      options.onSpawn?.(stopServer);
      return server.promise;
    }
    events.push("browser");
    options.onSpawn?.(stopBrowser);
    browserStarted.resolve();
    return browser.promise;
  });
  vi.mocked(readSwimBrowserReport).mockReset().mockImplementation(() => {
    events.push("report");
    return { success: true, counts: { expected: 4, unexpected: 0, flaky: 0, skipped: 0 },
      cases: SWIM_BROWSER_CASES.map((item) => ({ ...item, status: "passed" })) };
  });
  const options = { command, root, runDirectory, deadline: Date.now() + BROWSER_LIMITS.required + 1_000,
    target: { url: "http://127.0.0.1:54321", projectRef: "local",
      anonKey: `sb_publishable_${"a".repeat(24)}`, serviceRoleKey: `sb_secret_${"b".repeat(24)}` },
    cacheEnv, signal: controller.signal, manifest, reporting };
  return { options, cache, temp, command, server, browser, browserStarted, controller,
    stopServer, stopBrowser, events, manifest, reporting, close };
}

describe("DC-SW1/DC-SW8 browser runner lifecycle (synthetic command completions only)", () => {
  it("builds production, runs the dedicated config, and drains its exact server", async () => {
    const h = setup();
    const run = runSwimBrowserStage(h.options);
    await h.browserStarted.promise;
    expect(prepareSwimBrowserReport).toHaveBeenCalledOnce();
    expect(waitForBrowserReady).toHaveBeenCalledOnce();
    expect(requireNoEnvFiles).toHaveBeenCalledTimes(2);
    expect(requireFreePort).toHaveBeenCalledOnce();
    const [build, start, browser] = h.command.mock.calls;
    expect(build![0]).toBe(process.execPath);
    expect(build![1][0]).toMatch(/next\/dist\/bin\/next$/);
    expect(start![0]).toBe(process.execPath);
    expect(start![1]).toEqual([build![1][0], "start", "--hostname", "127.0.0.1", "--port", "3210"]);
    expect(start![2]).toMatchObject({ timeout: 410_000, allowFailure: true });
    expect(build![2]).toMatchObject({ timeout: 180_000, cwd: join(root, "apps/web") });
    expect(start![2].env).toEqual(build![2].env);
    expect(browser![1]).toEqual(["exec", "playwright", "test",
      "--config=playwright.swim-reference.config.ts", "--project=mobile-chromium", "--workers=1", "--retries=0"]);
    expect(browser![2]).toMatchObject({ timeout: 330_000, allowFailure: true,
      env: { NODE_ENV: "production", PLAYWRIGHT_BROWSERS_PATH: h.cache,
        HTA_SWIM_BROWSER_REPORT: join(h.options.runDirectory, "browser.json"),
        HTA_SWIM_BROWSER_OUTPUT_DIR: join(h.options.runDirectory, "browser-output") } });
    h.browser.resolve({ result: passed });
    await run;
    expect(h.events).toEqual(["build", "start", "browser", "report", "stop-server"]);
    expect(h.manifest.browser).toEqual({ success: true, cases: 4 });
  });

  it.each(["budget", "build", "env-before-start", "port", "readiness"] as const)(
    "does not invent a missing report after %s failure", async (phase) => {
      const h = setup();
      const error = new Error("synthetic preparation failure");
      if (phase === "budget") h.options.deadline = Date.now() + 589_999;
      if (phase === "build") h.command.mockRejectedValueOnce(error);
      if (phase === "env-before-start") vi.mocked(requireNoEnvFiles)
        .mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw error; });
      if (phase === "port") vi.mocked(requireFreePort).mockRejectedValueOnce(error);
      if (phase === "readiness") vi.mocked(waitForBrowserReady).mockRejectedValueOnce(error);
      await expect(runSwimBrowserStage(h.options)).rejects.toThrow();
      expect(prepareSwimBrowserReport).not.toHaveBeenCalled();
      expect(readSwimBrowserReport).not.toHaveBeenCalled();
      expect(h.stopServer).toHaveBeenCalledTimes(phase === "readiness" ? 1 : 0);
      if (phase === "budget") expect(h.command).not.toHaveBeenCalled();
    });

  it.each(["build", "readiness"] as const)("rejects a report created during %s", async (phase) => {
    const h = setup();
    const stale = () => writeFileSync(join(h.options.runDirectory, "browser.json"), "{}", { mode: 0o600 });
    if (phase === "build") h.command.mockImplementationOnce(async () => { stale(); return { result: passed }; });
    else vi.mocked(waitForBrowserReady).mockImplementationOnce(async () => { stale(); return { status: "ready" }; });
    await expect(runSwimBrowserStage(h.options)).rejects.toThrow();
    expect(h.command).toHaveBeenCalledTimes(2);
    expect(readSwimBrowserReport).not.toHaveBeenCalled();
    expect(h.manifest.browser).toEqual({ success: false, code: "browser-report-file" });
    expect(h.stopServer).toHaveBeenCalledOnce();
  });

  it.each([passed, { code: 1, signal: null, timedOut: false }, { ...stopped, timedOut: true }])(
    "fails on physical close before delayed server completion: %j", async (result) => {
      const h = setup();
      const run = runSwimBrowserStage(h.options);
      const rejected = expect(run).rejects.toThrow();
      await h.browserStarted.promise;
      h.close();
      // The close event wins even while command() is still reaping descendants.
      await vi.waitFor(() => expect(h.stopBrowser).toHaveBeenCalledOnce());
      expect(h.events.indexOf("stop-browser")).toBeLessThan(h.events.indexOf("report"));
      h.server.resolve({ result });
      await rejected;
      expect(h.manifest.browser).toMatchObject({ success: false });
      expect(h.reporting.failures.primary?.cause.message).toBe("browser-server-exited");
    });

  it("uses physical close during readiness and drains the losing readiness operation", async () => {
    const h = setup();
    let drained = false;
    vi.mocked(waitForBrowserReady).mockImplementationOnce(async ({ serverExit, signal }) => {
      await serverExit;
      expect(signal.aborted).toBe(false);
      drained = true;
      throw new Error("synthetic server close");
    });
    const run = runSwimBrowserStage(h.options);
    const rejected = expect(run).rejects.toThrow();
    await vi.waitFor(() => expect(waitForBrowserReady).toHaveBeenCalledOnce());
    h.close();
    await rejected;
    expect(drained).toBe(true);
    expect(h.stopServer).toHaveBeenCalledOnce();
    expect(readSwimBrowserReport).not.toHaveBeenCalled();
  });

  it("stops and awaits a cancelled browser before reading, retaining cancellation as primary", async () => {
    const h = setup();
    h.stopBrowser.mockImplementation(() => { h.events.push("stop-browser"); });
    const run = runSwimBrowserStage(h.options);
    const rejected = expect(run).rejects.toThrow();
    await h.browserStarted.promise;
    h.controller.abort();
    await vi.waitFor(() => expect(h.stopBrowser).toHaveBeenCalledOnce());
    expect(readSwimBrowserReport).not.toHaveBeenCalled();
    h.browser.resolve({ result: stopped });
    await rejected;
    expect(readSwimBrowserReport).toHaveBeenCalledOnce();
    expect(h.stopServer).toHaveBeenCalledOnce();
    expect(h.reporting.failures.primary?.cause.message).toBe("browser-cancelled");
  });

  it.each([passed, { code: 1, signal: null, timedOut: false }])(
    "reads every attempted report and preserves process failure precedence: %j", async (result) => {
      const h = setup();
      const reportError = new Error("synthetic report failure");
      vi.mocked(readSwimBrowserReport).mockImplementationOnce(() => { throw reportError; });
      const run = runSwimBrowserStage(h.options);
      const caught = run.catch((error: unknown) => error);
      await h.browserStarted.promise;
      h.browser.resolve({ result });
      const error = await caught;
      expect(readSwimBrowserReport).toHaveBeenCalledOnce();
      expect(h.manifest.browserProcess).toEqual(result);
      if (result.code === 0) expect(error).toBe(reportError);
      else expect(safeFailureCause(error)).toMatchObject({ classification: "process", result });
      expect(h.stopServer).toHaveBeenCalledOnce();
    });

  it("throws the same projected primary despite cleanup failure", async () => {
    const h = setup();
    let primary: unknown;
    try {
      prepareSwimBrowserReport({ runDirectory: "", reportPath: "", outputDir: "" }, join(root, "apps/web"));
    } catch (error) { primary = error; }
    vi.mocked(waitForBrowserReady).mockRejectedValueOnce(primary);
    h.stopServer.mockImplementation(() => { h.server.reject(new Error("synthetic cleanup failure")); });
    await expect(runSwimBrowserStage(h.options)).rejects.toBe(primary);
    expect(h.manifest.browser).toEqual(projectBrowserFailure(primary));
    expect(h.reporting.failures.cleanup).toHaveLength(1);
  });

  it.each([undefined, null, false, new Error("synthetic primary")])(
    "retains an explicit failure flag for %s", async (primary) => {
      const h = setup();
      vi.mocked(waitForBrowserReady).mockRejectedValueOnce(primary);
      await expect(runSwimBrowserStage(h.options)).rejects.toBe(primary);
      expect(h.manifest.browser).toMatchObject({ success: false });
    });

  it("fails the stage on cleanup-only error", async () => {
    const h = setup();
    const cleanup = new Error("synthetic cleanup-only failure");
    h.stopServer.mockImplementation(() => { h.server.reject(cleanup); });
    const run = runSwimBrowserStage(h.options);
    const rejected = expect(run).rejects.toBe(cleanup);
    await h.browserStarted.promise;
    h.browser.resolve({ result: passed });
    await rejected;
    expect(h.reporting.failures.primary).not.toBeNull();
    expect(h.reporting.failures.cleanup).toHaveLength(1);
    expect(h.manifest.browser).toMatchObject({ success: false });
  });

  it("drains the browser before reading even when its completion rejects", async () => {
    const h = setup();
    const failure = new Error("synthetic command rejection");
    const run = runSwimBrowserStage(h.options);
    const rejected = expect(run).rejects.toBe(failure);
    await h.browserStarted.promise;
    h.browser.reject(failure);
    await rejected;
    expect(readSwimBrowserReport).toHaveBeenCalledOnce();
    expect(h.stopServer).toHaveBeenCalledOnce();
  });

  it("cancels and drains readiness on server command rejection without a terminal event", async () => {
    const h = setup();
    const failure = new Error("synthetic pre-spawn rejection");
    let drained = false;
    vi.mocked(waitForBrowserReady).mockImplementationOnce(async ({ signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      drained = true;
      return { status: "ready" };
    });
    const run = runSwimBrowserStage(h.options);
    const rejected = expect(run).rejects.toBe(failure);
    await vi.waitFor(() => expect(waitForBrowserReady).toHaveBeenCalledOnce());
    h.server.reject(failure);
    await rejected;
    expect(drained).toBe(true);
    expect(readSwimBrowserReport).not.toHaveBeenCalled();
  });

  it("fails on a close after browser completion but before our stop", async () => {
    const h = setup();
    vi.mocked(readSwimBrowserReport).mockImplementationOnce(() => {
      h.close();
      return { success: true, counts: { expected: 4, unexpected: 0, flaky: 0, skipped: 0 }, cases: [] };
    });
    const run = runSwimBrowserStage(h.options);
    const rejected = expect(run).rejects.toThrow();
    await h.browserStarted.promise;
    h.browser.resolve({ result: passed });
    await rejected;
    expect(h.reporting.failures.primary?.cause.message).toBe("browser-server-exited");
  });

  it("does not start the server if cancellation arrives during build", async () => {
    const h = setup();
    h.command.mockImplementationOnce(async () => {
      h.controller.abort();
      return { result: passed };
    });
    await expect(runSwimBrowserStage(h.options)).rejects.toThrow();
    expect(h.command).toHaveBeenCalledOnce();
    expect(readSwimBrowserReport).not.toHaveBeenCalled();
  });

  it("does not pass if cancellation arrives while the server is stopping", async () => {
    const h = setup();
    h.stopServer.mockImplementation(() => {
      h.controller.abort();
      h.close();
      h.server.resolve({ result: stopped });
    });
    const run = runSwimBrowserStage(h.options);
    const rejected = expect(run).rejects.toThrow();
    await h.browserStarted.promise;
    h.browser.resolve({ result: passed });
    await rejected;
    expect(h.reporting.failures.primary?.cause.message).toBe("browser-cancelled");
  });

  it("fails a slow shutdown but still awaits completion instead of leaving a writer", async () => {
    vi.useFakeTimers();
    const h = setup();
    h.stopServer.mockImplementation(() => { h.events.push("stop-server"); });
    const run = runSwimBrowserStage(h.options);
    const rejected = expect(run).rejects.toThrow("Browser shutdown timed out");
    await h.browserStarted.promise;
    h.browser.resolve({ result: passed });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(h.stopServer).toHaveBeenCalledOnce();
    expect(h.manifest.browser).toBeUndefined();
    h.close();
    h.server.resolve({ result: stopped });
    await rejected;
    expect(h.reporting.failures.cleanup).toHaveLength(1);
  });

  it("keeps terminal events single-shot and before existing command reaping, and gates browser after proof", () => {
    const source = readFileSync(join(root, "apps/web/scripts/swim-acceptance.ts"), "utf8");
    expect(source).toContain('LANG: "C.UTF-8", NODE_ENV: "test"');
    expect(source).toContain('child.once("error", () => finish(');
    expect(source).toContain('child.once("close", (code, signal) => finish(');
    expect(source).toMatch(/if \(terminal\) return;\s+terminal = true;\s+options.onTerminal\?\.\(\);\s+done\(result\)/);
    expect(source.indexOf("options.onTerminal?.()")).toBeLessThan(source.indexOf("await killed;"));
    expect(source.indexOf('await stage("mobile browser acceptance"'))
      .toBeGreaterThan(source.indexOf("}), reporting);", source.indexOf("await enforceIdentityProofAfterRpc")));
    for (const file of ["apps/web/e2e", "apps/web/playwright.swim-reference.config.ts"]) expect(source).toContain(`"${file}"`);
  });
});

describe("workflow-owned browser cache", () => {
  it("accepts RUNNER_TEMP inside the OS home but outside the overridden per-run HOME", () => {
    const h = setup();
    expect(requireSwimBrowserCache({ ...h.options.cacheEnv, HOME: h.temp }, root, h.options.runDirectory)).toBe(h.cache);
  });
  it.each(["override", "symlink", "public", "checkout", "job", "attempt"] as const)(
    "rejects %s cache paths", (kind) => {
      const h = setup();
      const env = { ...h.options.cacheEnv };
      let checkout = root;
      if (kind === "override") env.PLAYWRIGHT_BROWSERS_PATH = join(h.temp, "other");
      if (kind === "symlink") {
        rmSync(h.cache, { recursive: true });
        symlinkSync(h.options.runDirectory, h.cache);
      }
      if (kind === "public") chmodSync(h.cache, 0o755);
      if (kind === "checkout") checkout = h.temp;
      if (kind === "job") env.GITHUB_JOB = "copilot";
      if (kind === "attempt") env.GITHUB_RUN_ATTEMPT = "2";
      expect(() => requireSwimBrowserCache(env, checkout, h.options.runDirectory)).toThrow();
    });

  it("creates a fresh private fixed cache and installs the locked browser only in the swim job", () => {
    const source = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    const job = source.slice(source.indexOf("  swim-acceptance:"), source.indexOf("  prod-migrate:"));
    expect(job).toContain("umask 077");
    expect(job).toContain('cache="$temp/swim-browser-cache-swim-acceptance-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"');
    expect(job).toContain('[[ ! -e "$cache" && ! -L "$cache" ]]');
    expect(job).toContain('mkdir -m 700 -- "$cache"');
    expect(job).not.toContain("actions/cache");
    expect(job).toContain("pnpm --filter @hta/web exec playwright install-deps chromium");
    expect(job).toContain("pnpm --filter @hta/web exec playwright install chromium");
    expect(job.indexOf("playwright install chromium")).toBeLessThan(job.indexOf("scripts/swim-acceptance.ts"));
  });
});
