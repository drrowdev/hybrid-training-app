import { accessSync, constants, lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import { requirePrivateLocation, requireProcess, type ProcessResult } from "./swim-acceptance-guards";
import { acceptanceAssert as assert, type AcceptanceReporting } from "./swim-acceptance-reporting";
import {
  BROWSER_LIMITS, SWIM_BROWSER_CASES, browserBudget, buildBrowserEnv, prepareSwimBrowserReport,
  projectBrowserFailure, readSwimBrowserReport, sealSwimBrowserReport, requireNoEnvFiles, requireFreePort,
  requirePrivateBrowserPaths, waitForBrowserReady, type BrowserReportTicket,
} from "./swim-browser-acceptance";

type CommandResult = { result: ProcessResult };
export type BrowserCommand = (executable: string, args: string[], options: {
  cwd: string; env: Record<string, string>; timeout: number; allowFailure?: boolean;
  onSpawn?: (stop: () => void) => void; onTerminal?: () => void;
}) => Promise<CommandResult>;

export function requireSwimBrowserCache(
  env: Readonly<Record<string, string | undefined>>, root: string, runDirectory: string,
) {
  assert(env.GITHUB_JOB === "swim-acceptance" &&
    /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") &&
    /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ""), "Browser cache context required");
  const temp = realpathSync(env.RUNNER_TEMP!);
  const cache = join(temp,
    `swim-browser-cache-swim-acceptance-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`);
  assert(env.HTA_SWIM_BROWSER_CACHE === cache && env.PLAYWRIGHT_BROWSERS_PATH === undefined,
    "Unexpected browser cache");
  requirePrivateLocation(cache, temp, realpathSync(root));
  const fromHome = relative(join(runDirectory, "home"), cache);
  assert(fromHome === ".." || fromHome.startsWith(`..${sep}`) || isAbsolute(fromHome),
    "Browser cache must be outside the per-run HOME");
  const stat = lstatSync(cache);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(cache) === cache &&
    stat.uid === process.getuid?.() && (stat.mode & 0o7777) === 0o700, "Private browser cache required");
  return cache;
}

export function requireSwimBrowserInstallation(cache: string, web: string) {
  const installed = createRequire(join(web, "package.json"));
  assert(installed("next/package.json").version === "16.2.6",
    "Unexpected installed Next version");
  assert(installed("@playwright/test/package.json").version === "1.60.0",
    "Unexpected installed Playwright version");
  const test = createRequire(installed.resolve("@playwright/test/package.json"));
  const playwright = createRequire(test.resolve("playwright/package.json"));
  assert(playwright("playwright-core/package.json").version === "1.60.0",
    "Unexpected installed Playwright version");
  // The pinned registry resolves browsers.json revisions and platform-specific executable paths.
  const { registry, registryDirectory } = playwright("playwright-core/lib/coreBundle").registry;
  for (const name of ["chromium", "chromium-headless-shell", "ffmpeg"]) {
    const executable = registry.findExecutable(name)?.executablePath();
    assert(typeof executable === "string", "Pinned browser executable required");
    const path = relative(registryDirectory, executable);
    assert(path && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`),
      "Unexpected browser executable path");
    const expected = join(cache, path);
    const stat = lstatSync(expected);
    assert(stat.isFile() && !stat.isSymbolicLink() && realpathSync(expected) === expected &&
      stat.uid === process.getuid?.(), "Pinned browser installation required");
    accessSync(expected, constants.X_OK);
  }
}

type Completion = { ok: true; value: CommandResult } | { ok: false; error: unknown };
const settle = (promise: Promise<CommandResult>): Promise<Completion> =>
  promise.then((value) => ({ ok: true, value }), (error: unknown) => ({ ok: false, error }));

export async function runSwimBrowserStage(options: {
  command: BrowserCommand; root: string; runDirectory: string; deadline: number;
  target: Parameters<typeof buildBrowserEnv>[0]; cacheEnv: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal; manifest: Record<string, unknown>; reporting: AcceptanceReporting;
}) {
  const { command, root, runDirectory, signal, manifest, reporting } = options;
  const web = join(root, "apps/web");
  const paths = { runDirectory, reportPath: join(runDirectory, "browser.json"),
    outputDir: join(runDirectory, "browser-output") };
  let failed = false;
  let primary: unknown;
  const errors: { stage: string; error: unknown; cleanup: boolean }[] = [];
  const collect = (stage: string, error: unknown, cleanup = false) => {
    errors.push({ stage, error, cleanup });
    if (!cleanup && !failed) { failed = true; primary = error; }
  };
  let server: Promise<Completion> | undefined;
  let browser: Promise<Completion> | undefined;
  let stopServer: (() => void) | undefined;
  let stopBrowser: (() => void) | undefined;
  let serverDone = false;
  let browserDone = false;
  let stopRequested = false;
  let earlyClose = false;
  let ticket: BrowserReportTicket | undefined;
  let ready: Promise<unknown> | undefined;
  const readiness = new AbortController();
  let exited!: () => void;
  const serverExit = new Promise<void>((resolve) => { exited = resolve; });
  let serverRejected!: (error: unknown) => void;
  const serverError = new Promise<never>((_, reject) => { serverRejected = reject; });
  // Observe launch/reaping errors even when another branch wins a race.
  void serverError.catch(() => {});
  let cancelled!: () => void;
  const cancellation = new Promise<"cancelled">((resolve) => { cancelled = () => resolve("cancelled"); });
  const cancel = () => { readiness.abort(); cancelled(); };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const checkLive = () => {
    assert(!signal.aborted, "browser-cancelled");
    assert(!earlyClose, "browser-server-exited");
  };
  const drain = async (completion: Promise<Completion>, stop: (() => void) | undefined,
    done: boolean, name: string) => {
    const timer = setTimeout(() => {
      manifest.browserShutdownDelayed = true;
    }, BROWSER_LIMITS.shutdown);
    try {
      if (!done) {
        try { stop?.(); } catch (error) { collect(name, error, true); }
      }
      return await completion;
    } finally { clearTimeout(timer); }
  };
  try {
    browserBudget(options.deadline - Date.now());
    checkLive();
    const cache = requireSwimBrowserCache(options.cacheEnv, root, runDirectory);
    const env = buildBrowserEnv(options.target, paths);
    requireSwimBrowserInstallation(cache, web);
    const installed = createRequire(join(web, "package.json"));
    const next = installed.resolve("next/dist/bin/next");
    requirePrivateBrowserPaths(paths, web);
    requireNoEnvFiles(root);
    await command(process.execPath, [next, "build"], { cwd: web, env, timeout: BROWSER_LIMITS.build });
    checkLive();
    requireNoEnvFiles(root);
    requirePrivateBrowserPaths(paths, web);
    await requireFreePort();
    checkLive();
    server = settle(command(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", "3210"], {
      cwd: web, env, timeout: BROWSER_LIMITS.serverLifetime, allowFailure: true,
      onSpawn: (stop) => { stopServer = stop; },
      onTerminal: () => { earlyClose = !stopRequested; exited(); },
    }));
    void server.then((completion) => {
      serverDone = true;
      if (!completion.ok) serverRejected(completion.error);
    });
    ready = waitForBrowserReady({ serverExit, signal: readiness.signal });
    await Promise.race([ready, serverError]);
    checkLive();
    ticket = prepareSwimBrowserReport(paths, web);
    browser = settle(command("pnpm", ["exec", "playwright", "test",
      "--config=playwright.swim-reference.config.ts", "--project=mobile-chromium",
      "--workers=1", "--retries=0"], {
      cwd: web, env: { ...env, PLAYWRIGHT_BROWSERS_PATH: cache },
      timeout: BROWSER_LIMITS.browserCommand, allowFailure: true,
      onSpawn: (stop) => { stopBrowser = stop; },
    }));
    void browser.then(() => { browserDone = true; });
    await Promise.race([browser, serverExit, serverError, cancellation]);
    checkLive();
  } catch (error) {
    collect("mobile browser acceptance", error);
  } finally {
    readiness.abort();
    if (ready) await ready.catch(() => {});
    if (browser) {
      const completion = await drain(browser, stopBrowser, browserDone, "browser command shutdown");
      let reportFailed = false;
      let reportError: unknown;
      try {
        sealSwimBrowserReport(ticket!);
        manifest.browserLedger = readSwimBrowserReport(ticket!);
      } catch (error) {
        reportFailed = true;
        reportError = error;
        manifest.browserLedger = projectBrowserFailure(error);
      }
      // Capture safe evidence first, but the failed process remains primary.
      try {
        if (!completion.ok) throw completion.error;
        manifest.browserProcess = completion.value.result;
        requireProcess(completion.value.result);
      } catch (error) { collect("browser command", error); }
      if (reportFailed) collect("browser report", reportError);
    }
    if (server) {
      const stop = () => { stopRequested = true; stopServer?.(); };
      const completion = await drain(server, stop, serverDone, "browser server shutdown");
      try {
        if (!completion.ok) throw completion.error;
        manifest.browserServerProcess = completion.value.result;
        const result = completion.value.result;
        assert(!earlyClose, "browser-server-exited");
        assert(!result.timedOut && (result.code === 0 ||
          (stopRequested && result.code === 143 && result.signal === null) ||
          result.signal === "SIGTERM" || result.signal === "SIGKILL"), "Browser server shutdown failed");
      } catch (error) { collect("browser server shutdown", error, true); }
    }
    signal.removeEventListener("abort", cancel);
  }
  if (signal.aborted) {
    try { assert(false, "browser-cancelled"); }
    catch (error) { collect("mobile browser acceptance", error); }
  }
  if (!failed && errors.length > 0) {
    failed = true;
    primary = errors[0]!.error;
  }
  if (failed) {
    manifest.browser = projectBrowserFailure(primary);
    // Cleanup-only failures still need a primary stage failure.
    reporting.recordFailure("mobile browser acceptance", primary);
    for (const entry of errors) {
      if (entry.cleanup || entry.error !== primary) reporting.recordFailure(entry.stage, entry.error, entry.cleanup);
    }
    throw primary;
  }
  manifest.browser = { success: true, cases: SWIM_BROWSER_CASES.length };
}
