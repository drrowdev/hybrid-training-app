import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { JSONReport } from "@playwright/test/reporter";
import { expect, it } from "vitest";
import { SWIM_BROWSER_CASES } from "../../../../scripts/swim-browser-acceptance";

const root = resolve(__dirname, "../../../../../..");
const web = join(root, "apps/web");
const knownSources = [
  "apps/web/playwright.swim-reference.config.ts",
  "apps/web/scripts/swim-browser-acceptance.ts",
  "apps/web/scripts/swim-acceptance-reporting.ts",
  "packages/db/scripts/migrate-evidence.ts",
  "apps/web/e2e/swimming-mobile.spec.ts",
  "apps/web/e2e/swimming-persistence-mobile.spec.ts",
] as const;
const loaderCodes = [
  "ERR_REQUIRE_ESM", "ERR_MODULE_NOT_FOUND", "ERR_UNKNOWN_FILE_EXTENSION",
  "ERR_UNSUPPORTED_DIR_IMPORT", "MODULE_NOT_FOUND",
] as const;
const expected = SWIM_BROWSER_CASES.map(({ file, describe, title }) => [file.slice("e2e/".length), describe, title]);
const expectedFiles = [...new Set(expected.map(([file]) => file))];

function syntheticJwt(role: "anon" | "service_role") {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  // Expired, random unsigned bytes: shaped for validation, never usable for authentication.
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, ref: "local", exp: 1 })}.${randomBytes(32).toString("base64url")}`;
}

it.skipIf(process.platform === "win32")("DC-SW1/DC-SW7/DC-SW8/DC-SW9: the real pinned CLI collects the exact declared mobile cohort without executing it", async () => {
  let success = false;
  let exit = -1;
  let output = "";
  let directory: string | undefined;
  let original: ReturnType<typeof lstatSync> | undefined;
  try {
    const installed = createRequire(join(web, "package.json"));
    assert.equal(installed("@playwright/test/package.json").version, "1.60.0");
    directory = mkdtempSync(join(realpathSync(tmpdir()), "swim-collection-"));
    original = lstatSync(directory);
    const outside = relative(root, directory);
    assert(outside === ".." || outside.startsWith(`..${sep}`) || isAbsolute(outside));
    assert.equal(original.mode & 0o7777, 0o700);
    const runDirectory = join(directory, "swim-acceptance-pr802-123-1");
    mkdirSync(runDirectory, { mode: 0o700 });
    for (const name of ["home", "tmp", "cache", "browser-output"]) {
      mkdirSync(join(runDirectory, name), { mode: 0o700 });
    }
    const anon = syntheticJwt("anon");
    const env: NodeJS.ProcessEnv = {
      PATH: dirname(process.execPath), LANG: "C.UTF-8", NODE_ENV: "test", CI: "true",
      HOME: join(runDirectory, "home"), TMPDIR: join(runDirectory, "tmp"),
      PWTEST_CACHE_DIR: join(runDirectory, "cache"),
      PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3210",
      E2E_REQUIRE_SEED: "1", E2E_SWIM_NONPROD: "1", E2E_SWIM_LOCAL: "1",
      SWIM_TEST_PROJECT_REF: "local", POOL_SWIMMING_ENABLED: "true",
      E2E_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      E2E_SUPABASE_ANON_KEY: anon, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
      E2E_SUPABASE_SERVICE_ROLE_KEY: syntheticJwt("service_role"),
      HTA_SWIM_BROWSER_REPORT: join(runDirectory, "browser.json"),
      HTA_SWIM_BROWSER_OUTPUT_DIR: join(runDirectory, "browser-output"),
    };
    // Pinned list mode loads in-process and reports discovery; no global setup or run tasks.
    // The collection-only override keeps JSON in bounded private memory, not a live-run report.
    const child = await new Promise<{ ok: boolean; stdout: string; stderr: string; exit: number }>((done) => {
      execFile(process.execPath, [installed.resolve("@playwright/test/cli"), "test",
        "--list", "--config=playwright.swim-reference.config.ts",
        "--project=mobile-chromium", "--reporter=json"], {
        cwd: web, env, encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => done({
        ok: error === null, stdout, stderr,
        exit: error === null ? 0 : typeof error.code === "number" ? error.code : -1,
      }));
    });
    exit = child.exit;
    output = child.stderr;
    let report: JSONReport | undefined;
    try {
      report = JSON.parse(child.stdout) as JSONReport;
      output += JSON.stringify(report.errors ?? []);
    } catch {
      if (!child.ok) output += child.stdout;
    }
    assert(child.ok && report);
    assert.equal(report.config.version, "1.60.0");
    assert.equal(report.config.rootDir, join(web, "e2e"));
    assert.deepEqual(report.errors, []);
    assert.equal(report.suites.length, expectedFiles.length);
    const collected = report.suites.flatMap((file) => {
      const expectedCases = expected.filter(([name]) => name === file.file);
      assert(expectedCases.length > 0);
      assert.equal(file.title, file.file);
      assert.equal(file.specs.length, 0);
      assert.equal(file.suites?.length, 1);
      const suite = file.suites![0]!;
      assert.equal(suite.file, file.file);
      assert(expectedCases.every(([, describe]) => describe === suite.title));
      assert.equal(suite.suites?.length ?? 0, 0);
      assert.equal(suite.specs.length, expectedCases.length);
      return suite.specs.map((spec) => {
        assert.equal(spec.file, file.file);
        assert.equal(spec.tests.length, 1);
        assert.equal(spec.tests[0]!.projectName, "mobile-chromium");
        assert.equal(spec.tests[0]!.expectedStatus, "passed");
        assert.deepEqual(spec.tests[0]!.results, []);
        return [file.file, suite.title, spec.title];
      });
    });
    assert.equal(collected.length, SWIM_BROWSER_CASES.length);
    assert.deepEqual(collected.sort(), [...expected].sort());
    success = true;
  } catch {
    // Never expose child errors, assertion diffs, report bodies or synthetic config.
    success = false;
  } finally {
    if (directory && original) {
      try {
        const current = lstatSync(directory);
        assert(current.isDirectory() && !current.isSymbolicLink());
        assert.equal(realpathSync(directory), directory);
        assert.equal(current.uid, process.getuid?.());
        assert.equal(current.mode & 0o7777, 0o700);
        assert.equal(current.dev, original.dev);
        assert.equal(current.ino, original.ino);
        rmSync(directory, { recursive: true });
        assert.throws(() => lstatSync(directory!), { code: "ENOENT" });
      } catch { success = false; }
    }
  }
  console.log(`[swim-collection]${JSON.stringify({
    success, exit,
    loaderCode: success ? "unknown" : loaderCodes.find((code) => new RegExp(`\\b${code}\\b`).test(output)) ?? "unknown",
    sources: success ? [] : knownSources.filter((path) => output.includes(path)),
  })}`);
  expect(success, "Dedicated collection regression failed; private diagnostics withheld").toBe(true);
}, 20_000);
