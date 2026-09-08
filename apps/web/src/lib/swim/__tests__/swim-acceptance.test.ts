import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  CLI_ASSET, CLI_SHA256, DEFAULT_SERVICES, INSPECT_FORMAT, LIMITS, PROJECT_LABEL, RUN_LABEL,
  containerSchema, outcome, processIdentity, readyServiceNames, requireAcceptance, requireArchive, requireCleanupState,
  requireContainer, requireFreshReport, requireLocalStatus, requireManualContext,
  requireNetwork, requireNoInheritedTargets, requirePinnedDefaultConfig, requirePrivateLocation, requireProcess, requireReadyStack,
  requireStartupContainer, resourceSchema, type Container, type Network, type Resources,
} from "../../../../scripts/swim-acceptance-guards";
import {
  acceptanceAssert, AcceptanceReporting, commandStdout, finishMigrationEvidenceAttempt, formatAcceptanceSummary,
  decodeMigrationDiagnostic, MIGRATION_DIAGNOSTIC_FIELDS, MIGRATION_DIAGNOSTIC_MAX_BYTES,
  openPrivateCommandLog, publishAcceptanceSummary, readMigrationDiagnostic, safeFailureCause,
} from "../../../../scripts/swim-acceptance-reporting";
import { MIN_RPC_CASES, RPC_SUITE, validateSwimRpcReport } from "./storage-rpc-report";
import {
  AUTH_PRIVILEGES_SQL, SWIM_FUNCTION_CONTRACTS, checkAuthBoundary,
  enforceAuthBoundaryAfterRpc, observeAuthPrivileges, projectAuthPrivilegeOutput,
} from "../../../../scripts/swim-auth-privileges";

const sha = "a".repeat(40);
const configHash = "b".repeat(64);
const networkId = "c".repeat(64);
const project = "pr802-123-1";
const context = () => ({
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_JOB: "swim-acceptance",
  SWIM_ACCEPTANCE: "true", GITHUB_REPOSITORY: "drrowdev/hybrid-training-app",
  RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", RUNNER_ARCH: "X64",
  EXPECTED_SHA: sha, GITHUB_SHA: sha, GITHUB_REF_TYPE: "branch",
  GITHUB_REF: "refs/heads/reviewed-swim", MIGRATE_PRODUCTION: "false", ALLOW_UNDEPLOYED: "false",
  GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_WORKFLOW_REF: "drrowdev/hybrid-training-app/.github/workflows/ci.yml@refs/heads/reviewed-swim",
});
const bridge = (): Network => ({
  Id: networkId, Name: `${project}-loopback`, Driver: "bridge", Scope: "local",
  Internal: false, EnableIPv6: false, Containers: {},
  Options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" },
  Labels: { [PROJECT_LABEL]: project, [RUN_LABEL]: project },
});
const container = (service = "db", index = 1): Container => ({
  Id: index.toString(16).padStart(64, "0"), Name: `/supabase_${service}_${project}`,
  Image: `sha256:${"d".repeat(64)}`,
  Config: { Image: `public.ecr.aws/supabase/${service}:reference`, Labels: { [PROJECT_LABEL]: project } },
  State: { Running: true, Status: "running", Health: { Status: "healthy" } },
  HostConfig: { NetworkMode: networkId },
  NetworkSettings: {
    Networks: { [`${project}-loopback`]: { NetworkID: networkId } },
    Ports: service === "db" ? { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }] }
      : service === "kong" ? { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } : {},
  },
  Mounts: [],
});
const localStatus = () => ({
  API_URL: "http://127.0.0.1:54321",
  DB_URL: `postgresql://postgres:${encodeURIComponent("synthetic-only")}@127.0.0.1:54322/postgres`,
  ANON_KEY: "local-anon-fixture-value", SERVICE_ROLE_KEY: "local-service-fixture-value",
});
const passed = { code: 0, signal: null, timedOut: false };
const report = () => ({
  success: true, numTotalTests: MIN_RPC_CASES, numPassedTests: MIN_RPC_CASES,
  numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  numTotalTestSuites: 2, numPassedTestSuites: 2, numFailedTestSuites: 0, numPendingTestSuites: 0,
  testResults: [{ name: RPC_SUITE, status: "passed",
    assertionResults: Array.from({ length: MIN_RPC_CASES }, (_, i) => ({
      fullName: `synthetic runner guard case ${i}`, status: "passed", failureMessages: [] as string[],
    })) }],
});
const ledger = () => validateSwimRpcReport(JSON.stringify(report()), sha, configHash);

describe("DC-SW1/DC-SW8 browser acceptance source coverage", () => {
  it("gates the unchanged normal reference on one required synthetic probe after the owned install", () => {
    const root = resolve(__dirname, "../../../../../..");
    const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    const job = workflow.split("\n  swim-acceptance:\n")[1]!.split("\n  prod-migrate:")[0]!;
    expect(job).toContain("if: github.event_name == 'workflow_dispatch' && inputs.swim_acceptance");
    expect(job).toContain("timeout-minutes: 45");
    const steps = job.split("      - name: ");
    const install = steps.findIndex((step) => step.startsWith("Install owned Chromium\n"));
    expect(install).toBeGreaterThan(0);
    expect(steps[install]).toBe("Install owned Chromium\n" +
      "        timeout-minutes: 5\n        env:\n" +
      "          PLAYWRIGHT_BROWSERS_PATH: ${{ env.HTA_SWIM_BROWSER_CACHE }}\n" +
      "        run: pnpm --filter @hta/web exec playwright install chromium\n\n");
    expect(steps[install + 1]).toBe("Prove synthetic announcer exclusion\n" +
      "        timeout-minutes: 2\n" +
      "        run: pnpm --filter @hta/web exec tsx scripts/swim-alert-announcer-probe.ts\n\n");
    expect(steps[install + 2]).toBe("Run guarded reference acceptance\n" +
      "        run: pnpm --filter @hta/web exec tsx scripts/swim-acceptance.ts\n\n");
    expect(steps[install + 3]).toBe("Verify task cleanup\n" +
      "        if: always()\n        run: |\n" +
      '          if [ -n "${SWIM_ACCEPTANCE_DIR:-}" ]; then\n' +
      "            pnpm --filter @hta/web exec tsx scripts/swim-acceptance.ts --cleanup\n" +
      "          fi\n");
    expect(job.match(/scripts\/swim-alert-announcer-probe\.ts/g)).toHaveLength(1);
    expect(job).not.toContain("continue-on-error");
  });
  it("statically pins probe setup order, process-local isolation and guarded owned cleanup", () => {
    const root = resolve(__dirname, "../../../../../..");
    const probe = readFileSync(join(root, "apps/web/scripts/swim-alert-announcer-probe.ts"), "utf8");
    const ordered = [
      '["-C", root, "rev-parse", "HEAD"]',
      "requireManualContext(process.env, head)",
      "probeDirectory = mkdtempSync(",
      "requirePrivateLocation(probeDirectory, temp, root)",
      'mkdirSync(home, { mode: 0o700 })', 'mkdirSync(tmp, { mode: 0o700 })',
      "requireSwimBrowserCache(process.env, root, probeDirectory)",
      "PLAYWRIGHT_BROWSERS_PATH: cache",
      "for (const key of Object.keys(process.env)) delete process.env[key]",
      "Object.assign(process.env, env)",
      "requireSwimBrowserInstallation(cache, web)",
      'const installed = createRequire(join(web, "package.json"))',
      'const test = createRequire(installed.resolve("@playwright/test/package.json"))',
      'const playwright = createRequire(test.resolve("playwright/package.json"))',
      'playwright("playwright-core")',
      "const executable = chromium.executablePath()",
      "executable.startsWith(`${cache}${sep}`) && realpathSync(executable) === executable",
      "browser = await chromium.launch({ env, timeout: Math.min(10_000, remaining()) })",
      "await close()",
      "assert(cleanup)",
      "const current = lstatSync(probeDirectory)",
      "realpathSync(probeDirectory), probeDirectory",
      "current.uid, process.getuid?.()", "current.mode & 0o7777, 0o700",
      "current.dev, original.dev", "current.ino, original.ino",
      "rmSync(probeDirectory, { recursive: true })",
      'if (!cleanup) failure ??= "cleanup"',
      "publishAcceptanceSummary(summary,",
    ];
    let previous = -1;
    for (const token of ordered) {
      const at = probe.indexOf(token);
      expect(at, token).toBeGreaterThan(previous);
      previous = at;
    }
    expect(probe).toContain('HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp');
    expect(probe.match(/mkdtempSync\(/g)).toHaveLength(1);
    expect(probe.match(/rmSync\(/g)).toHaveLength(1);
    expect(probe).not.toMatch(/GITHUB_ENV|console\.|error\.|stdout|stderr|page\.goto|baseURL|channel:|executablePath:|install",|download/i);
    expect(probe).toContain("Date.now() + 55_000");
    expect(probe).toContain("}, 60_000)");
    expect(probe).toContain("failure ??= timedOut ? \"timeout\" : stage");
    expect(probe).toContain("if (!success) process.exitCode = 1");
    expect(probe).toContain('protocol: "swim-announcer-synthetic-v1"');
    expect(probe).toContain("assert.equal(rows.length, 16)");
    expect(probe).toContain("executedRows: rows.length, rows");
    expect(probe).toContain("passed: countsMatch && categoryMatches && visibilityMatches");
    expect(probe.indexOf("rows.push(")).toBeLessThan(probe.indexOf("assert(rows.at(-1)!.passed)"));
  });
  it("keeps the probe static import graph free of early Playwright runtime initialization", () => {
    const root = resolve(__dirname, "../../../../../..");
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:import|export)\s+(type\s+)?[^;]*?\sfrom\s+["']([^"']+)["']/g)) {
        if (match[1]) continue;
        const target = match[2]!;
        expect(target).not.toMatch(/playwright/);
        if (target.startsWith(".")) visit(resolve(file, "..", `${target}.ts`));
        else expect(target.startsWith("node:") || target === "zod").toBe(true);
      }
    };
    visit(join(root, "apps/web/scripts/swim-alert-announcer-probe.ts"));
    expect(seen.size).toBeGreaterThan(4);
  });
  it("uses the actual candidate callback at every alert site while retaining C2 positive visibility", () => {
    const root = resolve(__dirname, "../../../../../..");
    for (const file of [
      "scripts/swim-alert-announcer-probe.ts", "e2e/swimming-lifecycle-load-mobile.spec.ts",
      "e2e/swimming-persistence-mobile.spec.ts",
    ]) {
      const source = readFileSync(join(root, "apps/web", file), "utf8");
      expect(source).toContain(".evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK)");
      expect(source).not.toContain("getRootNode()");
      if (file.startsWith("e2e/")) {
        expect(source).not.toMatch(/getByRole\("alert"\)\.(?:count|filter|and|first)\(/);
        expect(source).toContain('if (count < 0) return "error" as const');
        expect(source).toContain("expect(lateAlertCount).toBe(0)");
      }
    }
    const c2 = readFileSync(join(root, "apps/web/e2e/swimming-mobile.spec.ts"), "utf8");
    expect(c2).toContain('await expect(page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"))).toBeVisible();');
    const afterAlert = c2.slice(c2.indexOf('await expect(page.getByRole("alert")'));
    expect(afterAlert).toMatch(/toHaveValue\("33\.33"\)/);
  });
  it("extends the existing tracked-input list to consumed app roots without unrelated e2e or generated files", () => {
    const root = resolve(__dirname, "../../../../../..");
    const source = readFileSync(join(root, "apps/web/scripts/swim-acceptance.ts"), "utf8");
    const list = source.slice(source.indexOf('sourceFiles = git("ls-files"'), source.indexOf('sourceHashes = sources();'));
    const paths = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]!)
      .slice(3).filter((path) => path !== "\\0");
    for (const path of [
      "apps/web/src", "apps/web/public", "apps/web/scripts", "apps/web/package.json",
      "apps/web/next.config.*", "apps/web/tsconfig.json", "apps/web/postcss.config.*",
      "apps/web/e2e/swimming-mobile.spec.ts", "apps/web/e2e/swimming-persistence-mobile.spec.ts",
      "apps/web/e2e/fixtures", "apps/web/e2e/global-setup.ts",
      "apps/web/playwright.config.ts", "apps/web/playwright.swim-reference.config.ts",
      "apps/web/e2e-rpc/setup.ts", "apps/web/vitest.config.ts",
      "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", ".github/workflows/ci.yml",
    ]) expect(paths).toContain(path);
    const webPackage = JSON.parse(readFileSync(join(root, "apps/web/package.json"), "utf8"));
    for (const name of Object.keys(webPackage.dependencies).filter((name) => name.startsWith("@hta/"))) {
      expect(paths).toContain(`packages/${name.slice(5)}`);
    }
    expect(paths).toContain("packages/tb-conditioning");
    expect(paths).not.toContain("apps/web/e2e");
    const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--", ...paths],
      { encoding: "utf8" }).split("\0").filter(Boolean);
    expect(files).toContain("packages/db/drizzle/meta/_journal.json");
    expect(files.filter((file) => /^packages\/db\/drizzle\/[^/]+\.sql$/.test(file))).toHaveLength(148);
    expect(files).toContain("apps/web/next.config.ts");
    expect(files).toContain("apps/web/postcss.config.mjs");
    expect(files.filter((file) => file.startsWith("apps/web/e2e/")).every((file) =>
      file.startsWith("apps/web/e2e/fixtures/") || paths.includes(file))).toBe(true);
    expect(files.some((file) => /(?:^|\/)(?:\.next|node_modules|test-results|playwright-report|browser-output)(?:\/|$)|(?:next-env\.d\.ts|tsconfig\.tsbuildinfo|browser\.json)$/.test(file))).toBe(false);
    expect(source).toContain('assert.deepEqual(after, sourceHashes, "Tracked acceptance sources changed")');
    expect(source).toContain('assert(git("status", "--porcelain", "--untracked-files=all") === "", "Checkout changed during acceptance")');
  });
});

describe("migration diagnostics (DC-SW8; synthetic logs only)", () => {
  const token = "SCID/1/acl/pre/shared/ftftfttu";
  const rendering = `PostgresError: ${token}`;
  const evidence = { version: 1, guard: "acl", phase: "pre", object: "shared", bits: "ftftfttu" };
  const migration = readFileSync(new URL(
    "../../../../../../packages/db/drizzle/0147_shared_completion_identity.sql", import.meta.url,
  ), "utf8");

  it.each([
    ["roles", "pre", "roles", 6],
    ["attributes", "pre", "both", 48],
    ["attributes", "post", "both", 48],
    ["acl", "pre", "shared", 8],
    ["acl", "post", "shared", 8],
    ["acl", "pre", "helper", 8],
    ["acl", "post", "helper", 8],
    ["privileges", "pre", "both", 10],
    ["privileges", "post", "both", 10],
  ] as const)("decodes only the fixed %s/%s/%s vector", (guard, phase, object, length) => {
    expect(MIGRATION_DIAGNOSTIC_FIELDS[guard]).toHaveLength(length);
    const bits = "tfu".repeat(length).slice(0, length);
    const line = `PostgresError: SCID/1/${guard}/${phase}/${object}/${bits}`;
    const decoded = decodeMigrationDiagnostic(line);
    expect(decoded).toEqual({ version: 1, guard, phase, object, bits });
    expect(Object.keys(decoded)).toEqual(["version", "guard", "phase", "object", "bits"]);
    expect(decodeMigrationDiagnostic(line.slice(0, -1))).toBe("unavailable");
    expect(decodeMigrationDiagnostic(`${line}t`)).toBe("unavailable");
  });

  it("decodes Node's nested driver cause despite literal-only SQL echoes", () => {
    class PostgresError extends Error {}
    class DrizzleQueryError extends Error {}
    const cause = Object.assign(new PostgresError(token), {
      name: "PostgresError", code: "P0001", severity: "ERROR", detail: "synthetic-private-detail",
    });
    const error = Object.assign(new DrizzleQueryError(`Failed query: ${migration}\nparams: `, { cause }), {
      name: "DrizzleQueryError", query: migration, params: [],
    });
    const text = inspect(error, { colors: false });
    expect(text).toContain("[cause]: PostgresError:");
    expect(decodeMigrationDiagnostic(text)).toEqual(evidence);
    expect(formatAcceptanceSummary(decodeMigrationDiagnostic(text))).not.toContain("synthetic-private-detail");
    expect(decodeMigrationDiagnostic(migration)).toBe("unavailable");
    expect(decodeMigrationDiagnostic(inspect({ query: migration }))).toBe("unavailable");
  });

  it("deduplicates identical actual exception renderings", () => {
    expect(decodeMigrationDiagnostic(`${rendering}\n${rendering}`)).toEqual(evidence);
    expect(decodeMigrationDiagnostic(`${rendering}\n  [cause]: ${rendering}\nerror: ${token}`)).toEqual(evidence);
  });

  it.each([
    "",
    token,
    "RAISE EXCEPTION USING MESSAGE = 'SCID/' || '1/acl/';",
    `RAISE EXCEPTION '${token}';`,
    `SELECT '${rendering}';`,
    `query: '${rendering}'`,
    `query: '\n${rendering}\n'`,
    `DrizzleQueryError: Failed query: SELECT '\n${rendering}\n'`,
    `CONTEXT: ${rendering}`,
    `NOTICE: ${token}`,
    `Error: ${token}`,
    `PostgresError: ${token}/extra`,
    `PostgresError: ${token} `,
    rendering.replace("/1/", "/2/"),
    rendering.replace("/acl/", "/unknown/"),
    rendering.replace("/pre/", "/unknown/"),
    rendering.replace("/shared/", "/unknown/"),
    rendering.replace("/shared/", "/both/"),
    "PostgresError: SCID/1/roles/post/roles/tttttt",
    "PostgresError: SCID/1/attributes/pre/helper/" + "t".repeat(48),
    "PostgresError: SCID/1/privileges/pre/shared/tttttttttt",
    rendering.replace("ftftfttu", "ftftftt0"),
    `${rendering}\n${rendering.replace("/pre/", "/post/")}`,
    `${rendering}\n${rendering.replace("ftftfttu", "tttttttt")}`,
    `${rendering}\n${rendering.replace("/1/", "/2/")}`,
    `${rendering}\nSELECT '${token}';`,
    `\x1b[31m${rendering}\x1b[0m`,
    `discard\r${rendering}`,
    `${rendering}\rhidden`,
    `${rendering}\x00`,
    `${rendering}\x08`,
    `${rendering}\x7f`,
    `${rendering}\u009b0m`,
    `${rendering}\u202e`,
    rendering.replace("/pre/", "/p\x1b[0mre/"),
    `${rendering}\n${rendering}\x1b[1A`,
    `${rendering}\n${"x".repeat(MIGRATION_DIAGNOSTIC_MAX_BYTES)}`,
    `${rendering}\n${"é".repeat(MIGRATION_DIAGNOSTIC_MAX_BYTES / 2)}`,
  ])("fails closed for malformed, conflicting, source or unsafe input %#", (text) => {
    expect(decodeMigrationDiagnostic(text)).toBe("unavailable");
  });

  it("reads only a bounded tail and never treats a clipped line as an exception", () => {
    const directory = mkdtempSync(join(tmpdir(), "swim-migration-log-"));
    const path = join(directory, "command.log");
    const log = openPrivateCommandLog(path);
    closeSync(log.fd);
    try {
      log.append(Buffer.from(`PostgresError: SCID/1/roles/pre/roles/ffffff\n${"x".repeat(MIGRATION_DIAGNOSTIC_MAX_BYTES)}\n${rendering}\n`));
      expect(readMigrationDiagnostic(path)).toEqual(evidence);
      const clippedPath = join(directory, "clipped.log");
      const clipped = openPrivateCommandLog(clippedPath);
      closeSync(clipped.fd);
      // The tail starts at a syntactically valid error, but its omitted prefix was SQL.
      clipped.append(Buffer.from(`SELECT '${rendering}\n${"x".repeat(MIGRATION_DIAGNOSTIC_MAX_BYTES - rendering.length - 1)}`));
      expect(readMigrationDiagnostic(clippedPath)).toBe("unavailable");
      const link = join(directory, "link.log");
      symlinkSync(path, link);
      expect(() => readMigrationDiagnostic(link)).toThrow();
      chmodSync(path, 0o644);
      expect(readMigrationDiagnostic(path)).toBe("unavailable");
      expect(() => readMigrationDiagnostic(join(directory, "absent.log"))).toThrow();
      expect(readMigrationDiagnostic(directory)).toBe("unavailable");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("keeps success, diagnostic failures and process failures separate at the migration call site", () => {
    const source = readFileSync(new URL("../../../../scripts/swim-acceptance.ts", import.meta.url), "utf8");
    const stage = source.slice(source.indexOf('await stage("unchanged migrations"'),
      source.indexOf('await stage("global catalog'));
    expect(stage).toMatch(/requireUnchanged\(\);\s+const \{ result, log \} = await command\("pnpm", \["--filter", "@hta\/db", "db:migrate"\], \{\s+env: target\.dbEnv, timeout: 180_000, allowFailure: true, separateStdout: true,\s+\}\);/);
    expect(source.match(/separateStdout: true/g)).toHaveLength(2);
    expect(stage).toMatch(/if \(result\.code !== 0\) \{\s+try \{\s+manifest\.migrationDiagnostic = readMigrationDiagnostic\(log\);\s+\} catch \{\s+manifest\.migrationDiagnostic = "unavailable";\s+\}\s+\}\s+requireProcess\(result\);\s+requireUnchanged\(\);/);
    expect(source.match(/readMigrationDiagnostic\(log\)/g)).toHaveLength(2);
    for (const diagnostic of [evidence, "unavailable"]) {
      const reporting = new AcceptanceReporting();
      const result = { code: 1, signal: null, timedOut: false };
      try { requireProcess(result); } catch (error) { reporting.recordFailure("unchanged migrations", error); }
      expect(reporting.failures.primary?.cause).toMatchObject({ classification: "process", result });
      expect(outcome(reporting.failures.primary?.stage, true).success).toBe(false);
      expect(formatAcceptanceSummary({ migrationDiagnostic: diagnostic, failures: reporting.failures }))
        .not.toContain("PostgresError");
    }
  });

  it("pins a single diagnostic sibling to source, with a child-only fixed path and no downstream acceptance", () => {
    const source = readFileSync(new URL("../../../../scripts/swim-acceptance.ts", import.meta.url), "utf8");
    const branch = source.slice(source.indexOf("if (MIGRATION_DIAGNOSTIC_ONLY)"),
      source.indexOf('const { result, log } = await command("pnpm", ["--filter", "@hta/db", "db:migrate"]'));
    expect(source).toContain("const MIGRATION_DIAGNOSTIC_ONLY = false;");
    expect(source).toContain('import type { MigrationEvidenceCommand } from "../../../packages/db/scripts/migrate-with-evidence";');
    expect(source).toContain('const migrationEvidenceCommand: MigrationEvidenceCommand = "db:migrate:evidence";');
    expect(branch.match(/await command\(/g)).toHaveLength(1);
    expect(branch).toContain("manifest.qualifying = false;");
    expect(branch).toContain("const evidencePath = join(directory, MIGRATION_EVIDENCE_FILE);");
    expect(branch).toContain("env: { ...target.dbEnv, [MIGRATION_EVIDENCE_ENV]: evidencePath }");
    expect(branch).toContain("finishMigrationEvidenceAttempt(result, readMigrationEvidence(evidencePath), manifest, reporting);");
    expect(branch).not.toMatch(/GITHUB_ENV|process\.env|db:seed|round.?trip|HTTP/);
    expect(source).not.toContain("readMigrationDiagnostic(evidencePath)");
  });

  it("never qualifies a successful diagnostic child and preserves its authored stop reason", async () => {
    const reporting = new AcceptanceReporting();
    const manifest: Record<string, unknown> = {};
    const evidence = { status: "complete" as const, terminal: {
      event: "terminal" as const, phase: "migrate" as const, status: "success" as const,
      error: null, position: { status: "unmatched" as const },
    }, shutdown: { event: "shutdown" as const, status: "closed" as const, error: null } };
    const downstream = vi.fn();
    await expect(reporting.stage("unchanged migrations", async () => {
      finishMigrationEvidenceAttempt({ code: 0, signal: null, timedOut: false }, evidence, manifest, reporting);
      downstream();
    }, () => {})).rejects.toThrow();
    expect(downstream).not.toHaveBeenCalled();
    expect(manifest.qualifying).toBe(false);
    expect(reporting.failures.primary?.cause).toEqual({
      classification: "guard", message: "NON-QUALIFYING: normal-migration-still-required",
    });
  });

  it("keeps original failed process results primary and incomplete collectors explicitly secondary", async () => {
    for (const result of [
      { code: 1, signal: null, timedOut: false },
      { code: null, signal: "SIGTERM", timedOut: true },
      { code: 0, signal: null, timedOut: true },
    ]) {
      const reporting = new AcceptanceReporting();
      const manifest = {};
      await expect(reporting.stage("unchanged migrations", async () => {
        finishMigrationEvidenceAttempt(result, { status: "incomplete" }, manifest, reporting);
      }, () => {})).rejects.toThrow();
      expect(reporting.failures.primary?.cause).toMatchObject({ classification: "process", result });
      expect(reporting.failures.secondary).toHaveLength(1);
      expect(manifest).toMatchObject({ qualifying: false, migrationEvidence: { status: "incomplete" } });
    }
  });

  it("does not call missing or started-only evidence a diagnostic success even on exit zero", () => {
    const reporting = new AcceptanceReporting();
    const manifest = {};
    expect(() => finishMigrationEvidenceAttempt(
      { code: 0, signal: null, timedOut: false }, { status: "incomplete" }, manifest, reporting,
    )).toThrow();
    expect(reporting.failures.secondary).toHaveLength(1);
    expect(manifest).toMatchObject({ qualifying: false, migrationEvidence: { status: "incomplete" } });
  });
});

describe("auth privilege observation (synthetic reporting evidence, no database execution)", () => {
  const observation = {
    connectionRole: "postgres",
    postgresSuperuser: false,
    postgresInherit: true,
    postgresMemberOfSupabaseAdmin: false,
    postgresInheritsSupabaseAdmin: false,
    postgresAuthUsage: true,
    postgresAuthUsageGrantOption: false,
    swimWriterAuthUsage: false,
    swimWriterPublicUsage: true,
    postgresAuthUidExecute: true,
    swimWriterAuthUidExecute: true,
    postgresAuthUidExecuteGrantOption: false,
    authOwner: "supabase_admin",
    authUidOwner: "supabase_auth_admin",
    swimCreatePlanOwner: "swim_writer",
    swimWriterLogin: false,
    swimWriterSuperuser: false,
    swimWriterInherit: false,
    swimWriterBypassRls: false,
    swimCreatePlanSecurityDefiner: true,
    swimCreatePlanRowSecurity: "on",
    serviceRoleAuthUsage: true,
    serviceRoleAuthUidExecute: true,
    serviceRoleLocalTodayExecute: true,
    serviceRoleSafetyExecute: true,
    helper: ["present", true, true, true, false, true, false, false, false, true],
    shared: {
      attributes: true, original: false, amended: true, originalAcl: false, amendedAcl: true,
      authenticated: true, service: true, writer: true, owner: true, anon: false, public: false,
    },
    functions: SWIM_FUNCTION_CONTRACTS.map(([name]) => [name, true, false, true]),
  };
  const text = (value: Record<string, unknown> = observation) => JSON.stringify(Object.entries(value)
    .map(([key, entry]) => [key, key === "shared" && entry !== null && typeof entry === "object"
      ? Object.entries(entry) : entry]));
  const invalid = { status: "unavailable", reason: "invalid-output" };
  const missing = { status: "unavailable", reason: "missing-or-ambiguous-catalog" };
  const unsafe = '<private> https://private.invalid/?key=synthetic-only\nprivate-role';
  const source = readFileSync(new URL("../../../../scripts/swim-acceptance.ts", import.meta.url), "utf8");

  it("uses only the fixed, exact-signature, null-safe catalog query in a bounded read-only transaction", () => {
    const migration = readFileSync(new URL(
      "../../../../../../packages/db/drizzle/0145_standalone_pool_swimming.sql", import.meta.url,
    ), "utf8");
    expect(migration).toContain("CREATE ROLE swim_writer NOLOGIN NOINHERIT NOBYPASSRLS;");
    expect(migration).toMatch(/CREATE FUNCTION public\.swim_create_plan\(\s+p_started_on date, p_ends_on date, p_definition jsonb, p_state jsonb, p_workouts jsonb\s+\)/);
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION auth.uid() TO swim_writer;");
    expect(AUTH_PRIVILEGES_SQL.trim().split(";").map((part) => part.trim())).toEqual([
      "BEGIN READ ONLY", "SET LOCAL statement_timeout = '5s'", expect.stringMatching(/^WITH refs AS/), "ROLLBACK", "",
    ]);
    expect([...AUTH_PRIVILEGES_SQL.matchAll(/to_regrole\('([^']+)'\)/g)].map((m) => m[1]))
      .toEqual(["postgres", "swim_writer", "supabase_admin", "service_role", "anon", "authenticated"]);
    expect([...AUTH_PRIVILEGES_SQL.matchAll(/to_regnamespace\('([^']+)'\)/g)].map((m) => m[1]))
      .toEqual(["auth", "public"]);
    expect([...AUTH_PRIVILEGES_SQL.matchAll(/to_regprocedure\('([^']+)'\)/g)].map((m) => m[1]))
      .toEqual(["auth.uid()", "public.swim_create_plan(date,date,jsonb,jsonb,jsonb)",
        "public.swim_request_user_id()", "public.complete_training_session_with_transition(uuid,text,uuid)",
        "public.swim_local_today()", "public.swim_assert_start_safety(jsonb)",
        ...SWIM_FUNCTION_CONTRACTS.map(([name, args]) => `public.${name}(${args})`)]);
    expect(AUTH_PRIVILEGES_SQL).toContain("uid.oid = refs.uid AND uid.prokind = 'f'");
    expect(AUTH_PRIVILEGES_SQL).toContain("plan.oid = refs.create_plan AND plan.prokind = 'f'");
    const predicates = [
      ["postgres", "admin", "pg_has_role", "MEMBER"],
      ["postgres", "admin", "pg_has_role", "USAGE"],
      ["postgres", "auth", "has_schema_privilege", "USAGE"],
      ["postgres", "auth", "has_schema_privilege", "USAGE WITH GRANT OPTION"],
      ["writer", "auth", "has_schema_privilege", "USAGE"],
      ["writer", "public", "has_schema_privilege", "USAGE"],
      ["postgres", "uid", "has_function_privilege", "EXECUTE"],
      ["writer", "uid", "has_function_privilege", "EXECUTE"],
      ["postgres", "uid", "has_function_privilege", "EXECUTE WITH GRANT OPTION"],
    ];
    for (const [role, object, predicate, privilege] of predicates) {
      expect(AUTH_PRIVILEGES_SQL).toContain(
        `CASE WHEN ${role}.oid IS NOT NULL AND ${object}.oid IS NOT NULL\n` +
        `      THEN pg_catalog.${predicate}(${role}.oid, ${object}.oid, '${privilege}') END`,
      );
    }
    expect(AUTH_PRIVILEGES_SQL.match(/pg_catalog\.(?:has_schema_privilege|has_function_privilege|pg_has_role)\(/g))
      .toHaveLength(predicates.length + 14);
    expect([...AUTH_PRIVILEGES_SQL.matchAll(/json_build_array\('([^']+)'/g)].map((m) => m[1])
      .filter((name) => !["absent", "present", ...Object.keys(observation.shared),
        ...SWIM_FUNCTION_CONTRACTS.map(([name]) => name)].includes(name)))
      .toEqual(Object.keys(observation));
    expect(new Set([...AUTH_PRIVILEGES_SQL.matchAll(/(?:FROM|JOIN) (pg_catalog\.\w+)/g)].map((m) => m[1])))
      .toEqual(new Set(["pg_catalog.pg_roles", "pg_catalog.pg_namespace", "pg_catalog.pg_proc",
        "pg_catalog.pg_language", "pg_catalog.unnest", "pg_catalog.aclexplode"]));
    expect(AUTH_PRIVILEGES_SQL).not.toMatch(/\b(?:SET ROLE|GRANT\s+(?:USAGE|EXECUTE)|CREATE|ALTER|INSERT|UPDATE|DELETE|nspacl)\b/i);
    expect(AUTH_PRIVILEGES_SQL.replace("' SELECT auth.uid() '", "''"))
      .not.toMatch(/(?:SELECT|PERFORM)\s+(?:auth|public)\./i);
    expect(AUTH_PRIVILEGES_SQL).not.toContain("${");
  });

  it("classifies only fixed owner names and the exact function's stored row_security, never raw config", () => {
    for (const alias of ["auth_owner", "uid_owner", "plan_owner"]) {
      expect(AUTH_PRIVILEGES_SQL).toContain(`WHEN ${alias}.oid IS NULL THEN NULL`);
      expect(AUTH_PRIVILEGES_SQL).toContain(
        `WHEN ${alias}.rolname IN ('supabase_admin', 'supabase_auth_admin', 'postgres', 'swim_writer')\n` +
        `      THEN ${alias}.rolname ELSE 'other' END`,
      );
    }
    expect(AUTH_PRIVILEGES_SQL).toContain("FROM pg_catalog.unnest(plan.proconfig)");
    expect(AUTH_PRIVILEGES_SQL).toContain("WHERE setting IS NULL OR pg_catalog.split_part(setting, '=', 1) = 'row_security'");
    expect(AUTH_PRIVILEGES_SQL).toContain("WHEN plan.oid IS NULL THEN NULL");
    expect(AUTH_PRIVILEGES_SQL).toContain("WHEN config.count = 0 THEN 'absent'");
    expect(AUTH_PRIVILEGES_SQL).toContain("WHEN config.count <> 1 OR config.value IS NULL THEN NULL");
    expect(AUTH_PRIVILEGES_SQL).toContain("WHEN config.value = 'row_security=on' THEN 'on'");
    expect(AUTH_PRIVILEGES_SQL).toContain("WHEN config.value = 'row_security=off' THEN 'off'");
    expect(AUTH_PRIVILEGES_SQL).not.toMatch(/json_build_array\('[^']+',\s*\w+\.proconfig/);
  });

  it("retains effective EXECUTE independently of missing schema usage or grant options", () => {
    expect(projectAuthPrivilegeOutput(text())).toEqual({ status: "available", observation });
    expect(projectAuthPrivilegeOutput(`\n${text()}\n`)).toEqual({ status: "available", observation });
  });

  it.each(Object.entries(observation).filter(([, value]) => typeof value === "boolean").map(([key]) => key))(
    "preserves both true and false for %s without treating either as a gate", (key) => {
      for (const value of [true, false]) {
        const input = { ...observation, [key]: value };
        expect(projectAuthPrivilegeOutput(text(input))).toEqual({ status: "available", observation: input });
      }
    },
  );
  it.each([
    ["connectionRole", ["postgres", "other"]],
    ["authOwner", ["supabase_admin", "supabase_auth_admin", "postgres", "swim_writer", "other"]],
    ["authUidOwner", ["supabase_admin", "supabase_auth_admin", "postgres", "swim_writer", "other"]],
    ["swimCreatePlanOwner", ["supabase_admin", "supabase_auth_admin", "postgres", "swim_writer", "other"]],
    ["swimCreatePlanRowSecurity", ["on", "off", "absent", "other"]],
  ] as const)("accepts only the closed %s enum", (key, values) => {
    for (const value of values) {
      const input = { ...observation, [key]: value };
      expect(projectAuthPrivilegeOutput(text(input))).toEqual({ status: "available", observation: input });
    }
    for (const value of [unsafe, "", "unknown", true, 1, "ON"]) {
      expect(projectAuthPrivilegeOutput(text({ ...observation, [key]: value }))).toEqual(invalid);
    }
  });
  it.each(Object.keys(observation))("rejects missing, NULL, hostile, duplicate or unexpected %s evidence", (key) => {
    expect(projectAuthPrivilegeOutput(text({ ...observation, [key]: null }))).toEqual(missing);
    for (const value of [unsafe, "true", "false", 0, 1, {}, [], { [unsafe]: true }]) {
      expect(projectAuthPrivilegeOutput(text({ ...observation, [key]: value }))).toEqual(invalid);
    }
    const entries = Object.entries(observation);
    expect(projectAuthPrivilegeOutput(JSON.stringify(entries.filter(([name]) => name !== key)))).toEqual(invalid);
    expect(projectAuthPrivilegeOutput(JSON.stringify([...entries, [key, true]]))).toEqual(invalid);
    expect(projectAuthPrivilegeOutput(JSON.stringify(entries.map(([name, value]) =>
      [name === key ? unsafe : name, value])))).toEqual(invalid);
    const duplicate = entries.map(([name, value]) => [name === key ? "connectionRole" : name, value]);
    if (key !== "connectionRole") expect(projectAuthPrivilegeOutput(JSON.stringify(duplicate))).toEqual(invalid);
  });
  it.each(["", "null", "false", "[]", "{}", "[[]]", unsafe])("withholds malformed output %j", (input) => {
    expect(projectAuthPrivilegeOutput(input)).toEqual(invalid);
  });
  it("rejects extra fields, prototype keys, duplicate rows and non-protocol JSON", () => {
    for (const input of [
      JSON.stringify(observation), text({ ...observation, proconfig: unsafe }),
      text({ ...observation, ["__proto__"]: unsafe }), `${text()}\n${text()}`,
      JSON.stringify([Object.entries(observation), Object.entries(observation)]),
      `BEGIN\n${text()}\nROLLBACK`, `${text()}\n${unsafe}`,
    ]) expect(projectAuthPrivilegeOutput(input)).toEqual(invalid);
  });

  it("uses the private production command with capture AND allowFailure and no target/env override", async () => {
    const command = vi.fn(async (_executable, _args, options) => {
      const result = { code: 1, signal: null, timedOut: false };
      if (!options.allowFailure) requireProcess(result);
      return { text: unsafe, result, log: unsafe };
    });
    expect(await observeAuthPrivileges(command, networkId)).toEqual({ status: "unavailable", reason: "command-failed" });
    expect(command.mock.calls).toEqual([["docker", [
      "exec", networkId, "psql", "-XqAt", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", AUTH_PRIVILEGES_SQL,
    ], { capture: true, allowFailure: true, timeout: 10_000 }]]);
    expect(source).toMatch(/manifest\.catalog = [^\n]+;\s+requireUnchanged\(\);\s+}\);\s+const authPrivileges = await observeAuthPrivileges\(command, target\.dbId\);\s+manifest\.authPrivileges = authPrivileges;\s+const authBoundary = checkAuthBoundary\(authPrivileges, 148\);\s+manifest\.authBoundary = authBoundary;/);
    expect(source).toContain('await enforceIdentityProofAfterRpc(authBoundary, identityProof, () => stage("complete authenticated RPC file and positive ledger"');
    expect(source).toContain("requireAcceptance(result, ledger, state.sha, manifest.configSha256 as string);\n      requireIdentityHelperRpcCases(ledger);\n    }), reporting);");
    expect(source.match(/await observeAuthPrivileges\(/g)).toHaveLength(1);
    expect(source).toContain("Math.min(options.timeout ?? 60_000, deadline - Date.now())");
    expect(source).toContain('stdio: ["ignore", stdout.stdio, fd]');
    expect(source).toContain("commandStdout(commandLog, options, () => { timedOut = true; terminate(); })");
    expect(source).toContain('child.stdout?.on("data", stdout.onData)');
    expect(source).toContain("if (!options.allowFailure) requireProcess(result);");
  });
  it.each([
    [{ code: 1, signal: null, timedOut: false }, "command-failed"],
    [{ code: null, signal: "SIGTERM", timedOut: false }, "command-failed"],
    [{ code: 0, signal: "SIGTERM", timedOut: false }, "command-failed"],
    [{ code: null, signal: "spawn-error", timedOut: false }, "command-failed"],
    [{ code: null, signal: unsafe, timedOut: false }, "command-failed"],
    [{ code: 0, signal: null, timedOut: true }, "timeout-or-output-limit"],
    [{ code: null, signal: "SIGKILL", timedOut: true }, "timeout-or-output-limit"],
  ] as const)("projects process failure without publishing result or output: %j", async (result, reason) => {
    const command = vi.fn().mockResolvedValue({ text: text(), result, log: unsafe });
    expect(await observeAuthPrivileges(command, networkId)).toEqual({ status: "unavailable", reason });
    expect(command).toHaveBeenCalledTimes(1);
  });
  it("discards oversize capture when the existing command cap terminates its child", async () => {
    const command = vi.fn().mockResolvedValue({
      text: unsafe.repeat(Math.ceil(8 * 1024 * 1024 / unsafe.length)),
      result: { code: null, signal: "SIGTERM", timedOut: true },
    });
    expect(await observeAuthPrivileges(command, networkId)).toEqual({ status: "unavailable", reason: "timeout-or-output-limit" });
  });
  it("does not throw or publish raw command exceptions, including deadline cancellation", async () => {
    for (const error of [new Error(unsafe), new Error("Run cancelled or total time exhausted"), { detail: unsafe }]) {
      const command = vi.fn().mockRejectedValue(error);
      expect(await observeAuthPrivileges(command, networkId)).toEqual({ status: "unavailable", reason: "command-failed" });
      expect(command).toHaveBeenCalledTimes(1);
    }
  });
  it.each(["available", "missing", "invalid", "failed"] as const)(
    "keeps the original 30-case RPC and cleanup outcome with %s observation (DC-SW8)", async (evidence) => {
      for (const rpcOutcome of ["passed", "process-failed", "ledger-failed"] as const) {
        for (const cleaned of [true, false]) {
          const command = vi.fn().mockResolvedValue({
            text: evidence === "missing" ? text({ ...observation, authOwner: null }) : evidence === "invalid" ? unsafe : text(),
            result: { ...passed, code: evidence === "failed" ? 1 : 0 },
          });
          const reporting = new AcceptanceReporting();
          const manifest = { authPrivileges: await observeAuthPrivileges(command, networkId) };
          expect(manifest.authPrivileges.status).toBe(evidence === "available" ? "available" : "unavailable");
          const canonical = ledger();
          const result = { ...passed, code: rpcOutcome === "process-failed" ? 1 : 0 };
          if (rpcOutcome === "ledger-failed") canonical.success = false;
          const rpc = vi.fn(async () => requireAcceptance(result, canonical, sha, configHash));
          const cleanup = vi.fn(async () => {
            if (!cleaned) reporting.recordFailure("cleanup", new Error(unsafe), true);
          });
          try {
            await enforceAuthBoundaryAfterRpc(checkAuthBoundary(manifest.authPrivileges, 148),
              () => reporting.stage("RPC", rpc, () => {}), reporting);
          } catch { /* RPC remains primary; boundary alone also fails acceptance. */ }
          finally { await cleanup(); }
          expect(rpc).toHaveBeenCalledTimes(1);
          expect(cleanup).toHaveBeenCalledTimes(1);
          expect(canonical.suites[0]?.cases).toHaveLength(MIN_RPC_CASES);
          const boundaryFailed = evidence !== "available";
          expect(reporting.failures.primary?.stage).toBe(rpcOutcome !== "passed" ? "RPC"
            : boundaryFailed ? "swimming identity boundary" : undefined);
          expect(reporting.failures.secondary.map((failure) => failure.stage))
            .toEqual(rpcOutcome !== "passed" && boundaryFailed ? ["swimming identity boundary"] : []);
          expect(outcome(reporting.failures.primary?.stage, cleaned).success)
            .toBe(rpcOutcome === "passed" && !boundaryFailed && cleaned);
          const output = formatAcceptanceSummary({ manifest, failures: reporting.failures });
          expect(output).not.toContain("private");
          expect(output).not.toContain('"log"');
        }
      }
    },
  );
  it("publishes only the projection through the existing stdout and StepSummary path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "swim-auth-privileges-"));
    const path = join(directory, "summary.md");
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const input of [text(), text({ ...observation, authOwner: unsafe }), unsafe]) {
        const command = vi.fn().mockResolvedValue({ text: input, result: passed, log: unsafe });
        const manifest = { authPrivileges: await observeAuthPrivileges(command, networkId) };
        const formatted = formatAcceptanceSummary({ manifest });
        publishAcceptanceSummary(path, "Swim acceptance result", { manifest });
        expect(stdout.mock.calls.at(-1)).toEqual([
          `[swim-acceptance-summary]\n### Swim acceptance result\n<pre>${formatted}</pre>\n`,
        ]);
        expect(formatted).not.toContain("private");
        expect(formatted).not.toContain("proconfig");
        expect(formatted).not.toContain("BEGIN");
        expect(formatted).not.toContain('"log"');
      }
      expect(readFileSync(path, "utf8")).toBe(stdout.mock.calls.map(([value]) =>
        (value as string).replace("[swim-acceptance-summary]", "")).join(""));
    } finally {
      stdout.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires all 148 journal entries and SQL files and records 148 without filtering out 0147", () => {
    expect(source).toContain("journal.entries.length === 148");
    expect(source).toContain('sourceFiles.filter((f) => /^packages\\/db\\/drizzle\\/[^/]+\\.sql$/.test(f)).length === 148');
    expect(source).toContain("manifest.migrationCount = 148;");
    const journal = JSON.parse(readFileSync(new URL(
      "../../../../../../packages/db/drizzle/meta/_journal.json", import.meta.url,
    ), "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries).toHaveLength(148);
    expect(journal.entries.at(-1)?.tag).toBe("0147_shared_completion_identity");
  });

  it("pins all ten exact original/up bodies and distinct invoker/definer attributes to reviewed source", () => {
    for (const [file, bodyIndex] of [
      ["0145_standalone_pool_swimming.sql", 5], ["0146_swim_request_identity.sql", 6],
    ] as const) {
      const sql = readFileSync(new URL(`../../../../../../packages/db/drizzle/${file}`, import.meta.url), "utf8");
      for (const contract of SWIM_FUNCTION_CONTRACTS) {
        const [name, args, language, volatility, definer] = contract;
        const definition = sql.match(new RegExp(
          `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\((.*?)\\)(.*?)AS \\$\\$(.*?)\\$\\$;`, "s",
        ));
        expect(definition, name).not.toBeNull();
        expect(createHash("md5").update(definition![3]).digest("hex")).toBe(contract[bodyIndex]);
        expect(definition![2]).toContain(`LANGUAGE ${language} ${volatility === "s" ? "STABLE" : "VOLATILE"}`);
        expect(definition![2]).toContain(`SECURITY ${definer ? "DEFINER" : "INVOKER"}`);
        const returnType = name === "swim_local_today" ? "date" : name === "swim_assert_start_safety" ? "void" : "jsonb";
        expect(definition![2]).toContain(`RETURNS ${returnType}`);
        expect(AUTH_PRIVILEGES_SQL).toContain(`f.prorettype = 'pg_catalog.${returnType}'::pg_catalog.regtype`);
        expect(definition![2]).toContain("SET search_path = pg_catalog, public");
        expect(definition![2].includes("SET row_security = on")).toBe(definer);
        expect(AUTH_PRIVILEGES_SQL).toContain(`to_regprocedure('public.${name}(${args})')`);
        expect(AUTH_PRIVILEGES_SQL).toContain(`f.provolatile = '${volatility}' AND f.prosecdef = ${definer}`);
      }
    }
    for (const fragment of [
      "f.proowner = refs.swim_writer AND l.lanname",
      "AND NOT f.proleakproof",
      "AND NOT f.proretset",
      "f.proconfig @> ARRAY['search_path=pg_catalog, public', 'row_security=on']",
      "f.proconfig <@ ARRAY['search_path=pg_catalog, public', 'row_security=on']",
      "pg_catalog.cardinality(f.proconfig) = 2",
      "f.proconfig @> ARRAY['search_path=pg_catalog, public']",
      "f.proconfig <@ ARRAY['search_path=pg_catalog, public']",
      "pg_catalog.cardinality(f.proconfig) = 1",
    ]) expect(AUTH_PRIVILEGES_SQL).toContain(fragment);
  });

  it("checks the exact private helper contract and treats default NULL ACL as unsafe, not absent", () => {
    for (const fragment of [
      "WHEN helper_count.count = 0 THEN pg_catalog.json_build_array('absent')",
      "WHEN helper_count.count <> 1 OR helper.oid IS NULL OR helper_lang.oid IS NULL",
      "helper.proowner = refs.postgres AND helper.pronargs = 0 AND NOT helper.proretset",
      "AND helper.proallargtypes IS NULL",
      "helper.prorettype = 'pg_catalog.uuid'::pg_catalog.regtype",
      "helper_lang.lanname = 'sql' AND helper.provolatile = 's'",
      "helper.prosecdef AND NOT helper.proleakproof",
      "helper.proconfig = ARRAY['search_path=pg_catalog']::text[]",
      "helper.prosrc = ' SELECT auth.uid() '",
      "acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'",
      "acl.grantee NOT IN (helper.proowner, refs.swim_writer, refs.service, refs.authenticated)",
    ]) expect(AUTH_PRIVILEGES_SQL).toContain(fragment);
    expect(AUTH_PRIVILEGES_SQL.match(/COALESCE\(helper\.proacl, pg_catalog\.acldefault\('f', helper\.proowner\)\)/g))
      .toHaveLength(4);
    expect(AUTH_PRIVILEGES_SQL).not.toContain("helper.proacl IS NULL");
    expect(AUTH_PRIVILEGES_SQL).not.toMatch(/(?:to_regrole|has_function_privilege)\('PUBLIC'/i);
    for (const role of ["swim_writer", "service", "anon", "authenticated"]) {
      expect(AUTH_PRIVILEGES_SQL).toContain(`pg_catalog.has_function_privilege(refs.${role}, helper.oid, 'EXECUTE')`);
    }
    // Default PUBLIC EXECUTE implies effective anon/authenticated access and an unapproved grantee.
    const evidence = projectAuthPrivilegeOutput(text({
      ...observation, helper: ["present", true, true, true, true, true, true, true, false, false],
    }));
    expect(evidence.status).toBe("available");
    expect(checkAuthBoundary(evidence, 148)).toBe("mismatched");
  });

  it.each(["up", "original", "neither"] as const)("preserves ten-function evidence with %s bodies and legitimate helper absence", (mode) => {
    const functions = SWIM_FUNCTION_CONTRACTS.map(([name]) => [name, true, mode === "original", mode === "up"]);
    for (const helper of [observation.helper, ["absent"]]) {
      const input = { ...observation, functions, helper };
      const evidence = projectAuthPrivilegeOutput(text(input));
      expect(evidence).toEqual({ status: "available", observation: input });
      expect(checkAuthBoundary(evidence, 148)).toBe(mode === "up" && helper[0] === "present" ? "matched" : "mismatched");
      const original = projectAuthPrivilegeOutput(text({ ...input, shared: {
        ...observation.shared, original: true, amended: false, originalAcl: true, amendedAcl: false, anon: true, public: true,
      } }));
      expect(checkAuthBoundary(original, 146))
        .toBe(mode === "original" && helper[0] === "absent" ? "matched" : "mismatched");
    }
  });

  it("rejects ambiguous helper/function facts and closed-tuple violations without losing evidence on absence", () => {
    for (const helper of [["absent", true], ["present"], ["other"], ["absent", unsafe],
      [...observation.helper, false], { presence: "absent" }]) {
      expect(projectAuthPrivilegeOutput(text({ ...observation, helper }))).toEqual(invalid);
    }
    for (let index = 1; index < observation.helper.length; index++) {
      const helper = [...observation.helper];
      helper[index] = unsafe;
      expect(projectAuthPrivilegeOutput(text({ ...observation, helper }))).toEqual(invalid);
    }
    expect(projectAuthPrivilegeOutput(text({ ...observation, helper: null }))).toEqual(missing);
    for (const functions of [
      observation.functions.slice(1), [...observation.functions, observation.functions[0]],
      observation.functions.map((entry, index) => index === 1 ? observation.functions[0] : entry),
      observation.functions.map((entry, index) => index === 0 ? [unsafe, ...entry.slice(1)] : entry),
      observation.functions.map((entry, index) => index === 0 ? [...entry, false] : entry),
    ]) expect(projectAuthPrivilegeOutput(text({ ...observation, functions }))).toEqual(invalid);
    for (let index = 0; index < 10; index++) {
      const functions = [...observation.functions];
      for (const value of [null, ["swim_local_today", null, true, false]]) {
        expect(projectAuthPrivilegeOutput(text({
          ...observation, functions: functions.map((entry, i) => i === index ? value : entry),
        }))).toEqual(missing);
      }
    }
    expect(projectAuthPrivilegeOutput(text({ ...observation, phase: "rolled-back" }))).toEqual(invalid);
  });

  const levelObservation = (level: 146 | 147 | 148) => ({
    ...observation,
    helper: level === 146 ? ["absent"]
      : ["present", true, true, true, false, level === 148, false, false, level === 147, level === 148],
    shared: {
      ...observation.shared, original: level !== 148, amended: level === 148,
      originalAcl: level !== 148, amendedAcl: level === 148, anon: level !== 148, public: level !== 148,
    },
    functions: SWIM_FUNCTION_CONTRACTS.map(([name]) => [name, true, level === 146, level !== 146]),
  });

  it("DC-SW8 pins exact shared prior and amended ACL sets without relaxing grantor or options", () => {
    for (const callers of [
      "refs.postgres, refs.authenticated, refs.service, refs.swim_writer, 0::oid, refs.anon",
      "refs.postgres, refs.authenticated, refs.service, refs.swim_writer",
    ]) {
      expect(AUTH_PRIVILEGES_SQL.split(`FROM unnest(ARRAY[${callers}]) grantee)`)).toHaveLength(2);
    }
    const shared = AUTH_PRIVILEGES_SQL.slice(AUTH_PRIVILEGES_SQL.indexOf("pg_catalog.json_build_array('shared'"));
    expect(shared.match(/AND bool_and\(acl.grantor = refs.postgres AND acl.privilege_type = 'EXECUTE' AND NOT acl.is_grantable\), false\)/g))
      .toHaveLength(2);
  });

  it.each([146, 147] as const)("DC-SW8 rejects prior %i missing direct anon even with PUBLIC effective access", (level) => {
    const input = levelObservation(level);
    input.shared.originalAcl = false;
    expect(input.shared).toMatchObject({ anon: true, public: true });
    expect(checkAuthBoundary(projectAuthPrivilegeOutput(text(input)), level)).toBe("mismatched");
  });

  it.each([146, 147, 148] as const)("DC-SW8 rejects an unknown extra shared grantee at %i", (level) => {
    const input = levelObservation(level);
    input.shared.originalAcl = false;
    input.shared.amendedAcl = false;
    expect(checkAuthBoundary(projectAuthPrivilegeOutput(text(input)), level)).toBe("mismatched");
  });

  it.each(["grant option", "wrong grantor"])("DC-SW8 rejects shared %s evidence with otherwise matching callers", () => {
    for (const level of [146, 147, 148] as const) {
      const input = levelObservation(level);
      input.shared.originalAcl = false;
      input.shared.amendedAcl = false;
      expect(checkAuthBoundary(projectAuthPrivilegeOutput(text(input)), level)).toBe("mismatched");
    }
  });

  it("DC-SW8 rejects direct and effective anon at 148 even after PUBLIC denial", () => {
    const input = levelObservation(148);
    input.shared.amendedAcl = false;
    input.shared.anon = true;
    expect(input.shared.public).toBe(false);
    expect(checkAuthBoundary(projectAuthPrivilegeOutput(text(input)), 148)).toBe("mismatched");
  });

  it.each(Object.keys(observation.shared) as (keyof typeof observation.shared)[])(
    "DC-SW8 rejects flipped shared %s evidence at every closed level", (key) => {
      for (const level of [146, 147, 148] as const) {
        const input = levelObservation(level);
        expect(checkAuthBoundary(projectAuthPrivilegeOutput(text(input)), level)).toBe("matched");
        input.shared[key] = !input.shared[key];
        const evidence = projectAuthPrivilegeOutput(text(input));
        expect(evidence.status).toBe("available");
        expect(checkAuthBoundary(evidence, level)).toBe("mismatched");
      }
    },
  );

  it.each([[148, 147], [147, 148]] as const)(
    "DC-SW8 rejects level %i evidence against expected %i", (actual, expected) => {
      const evidence = projectAuthPrivilegeOutput(text(levelObservation(actual)));
      expect(checkAuthBoundary(evidence, actual)).toBe("matched");
      expect(checkAuthBoundary(evidence, expected)).toBe("mismatched");
    },
  );

  it("rejects each forbidden caller, missing permitted caller, role flag and service capability", () => {
    expect(checkAuthBoundary(projectAuthPrivilegeOutput(text()), 148)).toBe("matched");
    for (let index = 1; index < observation.helper.length; index++) {
      const helper = [...observation.helper];
      helper[index] = !helper[index];
      expect(checkAuthBoundary(projectAuthPrivilegeOutput(text({ ...observation, helper })), 148)).toBe("mismatched");
    }
    for (const key of [
      "swimWriterLogin", "swimWriterSuperuser", "swimWriterInherit", "swimWriterBypassRls", "swimWriterAuthUsage",
      "swimWriterPublicUsage", "serviceRoleAuthUsage", "serviceRoleAuthUidExecute",
      "serviceRoleLocalTodayExecute", "serviceRoleSafetyExecute", "swimCreatePlanSecurityDefiner",
    ] as const) {
      expect(checkAuthBoundary(projectAuthPrivilegeOutput(text({
        ...observation, [key]: !observation[key],
      })), 148)).toBe("mismatched");
    }
    for (const [key, value] of [["connectionRole", "other"], ["swimCreatePlanOwner", "postgres"],
      ["swimCreatePlanRowSecurity", "off"]]) {
      expect(checkAuthBoundary(projectAuthPrivilegeOutput(text({ ...observation, [key]: value })), 148))
        .toBe("mismatched");
    }
    for (let index = 0; index < 10; index++) {
      for (const slot of [1, 3]) {
        const functions = observation.functions.map((entry) => [...entry]);
        functions[index][slot] = false;
        expect(checkAuthBoundary(projectAuthPrivilegeOutput(text({ ...observation, functions })), 148))
          .toBe("mismatched");
      }
    }
  });

  it.each(["matched", "unavailable", "mismatched"] as const)(
    "attempts canonical process/ledger for every outcome with %s boundary and preserves the primary failure", async (boundary) => {
      for (const processPassed of [true, false]) {
        for (const ledgerPassed of [true, false]) {
          const reporting = new AcceptanceReporting();
          const canonical = ledger();
          canonical.success = ledgerPassed;
          const result = { ...passed, code: processPassed ? 0 : 1 };
          let rpcError: unknown;
          let thrown: unknown;
          const rpc = vi.fn(() => reporting.stage("RPC", async () => {
            expect(reporting.failures.primary).toBeNull();
            try { requireAcceptance(result, canonical, sha, configHash); }
            catch (error) { rpcError = error; throw error; }
          }, () => {}));
          try { await enforceAuthBoundaryAfterRpc(boundary, rpc, reporting); } catch (error) { thrown = error; }
          const rpcPassed = processPassed && ledgerPassed;
          expect(rpc).toHaveBeenCalledTimes(1);
          expect(canonical.suites[0]?.cases).toHaveLength(30);
          expect(reporting.failures.primary?.stage).toBe(!rpcPassed ? "RPC"
            : boundary !== "matched" ? "swimming identity boundary" : undefined);
          expect(reporting.failures.secondary.map(({ stage }) => stage))
            .toEqual(!rpcPassed && boundary !== "matched" ? ["swimming identity boundary"] : []);
          if (!rpcPassed) expect(thrown).toBe(rpcError);
          else if (boundary === "matched") expect(thrown).toBeUndefined();
          else expect(thrown).toBeInstanceOf(Error);
        }
      }
    },
  );

  it("preserves raw RPC/parser throw identity privately while publishing only authored failures", async () => {
    for (const error of [new Error(unsafe), new SyntaxError(unsafe), undefined]) {
      const reporting = new AcceptanceReporting();
      const rpc = vi.fn(() => reporting.stage("RPC", async () => { throw error; }, () => {}));
      let caught = false;
      try { await enforceAuthBoundaryAfterRpc("unavailable", rpc, reporting); }
      catch (actual) { caught = true; expect(actual).toBe(error); }
      expect(caught).toBe(true);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(reporting.failures.primary?.stage).toBe("RPC");
      expect(reporting.failures.secondary[0]?.stage).toBe("swimming identity boundary");
      const output = formatAcceptanceSummary(reporting.failures);
      expect(output).not.toContain("private");
      expect(output).not.toContain(unsafe);
      expect(reporting.failures.secondary[0]?.cause.classification).toBe("guard");
    }
  });
});

describe("manual swim acceptance preflight (no Docker or RPC execution)", () => {
  it("requires the reviewed manual standard-runner context and checked-out SHA", () => {
    expect(requireManualContext(context(), sha)).toBe(project);
    expect(() => requireManualContext(context(), "b".repeat(40))).toThrow();
  });
  it.each([
    ["GITHUB_ACTIONS", "false"], ["GITHUB_EVENT_NAME", "pull_request"], ["GITHUB_JOB", "ci"],
    ["SWIM_ACCEPTANCE", "false"], ["GITHUB_REPOSITORY", "other/repo"],
    ["RUNNER_ENVIRONMENT", "self-hosted"], ["RUNNER_OS", "Windows"], ["RUNNER_ARCH", "ARM64"],
    ["EXPECTED_SHA", ""], ["EXPECTED_SHA", "A".repeat(40)], ["EXPECTED_SHA", `${sha}; echo unsafe`],
    ["EXPECTED_SHA", "a".repeat(39)], ["GITHUB_SHA", "b".repeat(40)],
    ["GITHUB_REF_TYPE", "tag"], ["GITHUB_REF", "refs/heads/main"], ["GITHUB_REF", "refs/tags/v1"],
    ["MIGRATE_PRODUCTION", "true"], ["ALLOW_UNDEPLOYED", "true"], ["ALLOW_UNDEPLOYED", ""],
    ["GITHUB_WORKFLOW_REF", "other"], ["GITHUB_RUN_ID", "../../escape"], ["GITHUB_RUN_ATTEMPT", "0"],
  ])("rejects %s=%s", (key, value) => {
    expect(() => requireManualContext({ ...context(), [key]: value }, sha)).toThrow();
  });
  it.each([
    "DATABASE_URL", "SUPABASE_DB_URL", "NEXT_PUBLIC_SUPABASE_URL", "E2E_SUPABASE_URL",
    "SMOKE_SUPABASE_SERVICE_ROLE_KEY", "PGHOST", "PGSERVICE", "PGSSLMODE",
    "SWIM_RPC_TEST_LOCAL", "SWIM_TEST_PROJECT_REF", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG",
    "NODE_OPTIONS", "VITEST_TEST_NAME_PATTERN", "DOTENV_CONFIG_PATH", "S3_HOST", "HTTPS_PROXY",
  ])("rejects inherited %s without exposing its value", (key) => {
    expect(() => requireNoInheritedTargets({ [key]: "private-value" })).toThrow();
    try { requireNoInheritedTargets({ [key]: "private-value" }); }
    catch (error) { expect(String(error)).not.toContain("private-value"); }
  });
  it("allows ordinary context and empty unset target values", () => {
    expect(() => requireNoInheritedTargets({ ...context(), DATABASE_URL: "" })).not.toThrow();
  });
  it("requires a private runner-temp directory outside checkout", () => {
    expect(() => requirePrivateLocation("/tmp/run/private", "/tmp/run", "/repo")).not.toThrow();
    for (const path of ["/repo/tmp/private", "/tmp/run", "/tmp/run/../../repo", "/tmp/runner/private", "relative"]) {
      expect(() => requirePrivateLocation(path, "/tmp/run", "/repo")).toThrow();
    }
  });
  it("requires both pinned and published archive checksums for the exact asset", () => {
    const published = `${CLI_SHA256}  ${CLI_ASSET}\r\n`;
    expect(() => requireArchive(CLI_SHA256, published)).not.toThrow();
    for (const [digest, checksums] of [
      ["e".repeat(64), published], [CLI_SHA256, `${"e".repeat(64)}  ${CLI_ASSET}`],
      [CLI_SHA256, `${CLI_SHA256}  different.tar.gz`], [CLI_SHA256, published + published],
    ]) expect(() => requireArchive(digest!, checksums!)).toThrow();
  });
  it("retains bounded process ceilings and a cleanup reserve", () => {
    expect(LIMITS).toEqual({ total: 35 * 60_000, cleanup: 3 * 60_000, startup: 20 * 60_000, rpc: 12 * 60_000 });
  });
});

describe("pinned native init service configuration (no CLI execution)", () => {
  // Service-relevant projection of project-init.templates.ts at CLI v2.116.0.
  const config = `project_id = "synthetic"
[api]
enabled = true
[api.tls]
enabled = false
[db]
major_version = 17
[db.pooler]
enabled = false
[db.migrations]
enabled = true
[realtime]
enabled = true
[studio]
enabled = true
[local_smtp]
enabled = true
[storage]
enabled = true
[storage.s3_protocol]
enabled = true
# [storage.image_transformation]
# enabled = true
[storage.analytics]
enabled = false
[storage.vector]
enabled = true
[auth]
enabled = true
[auth.external.apple]
enabled = false
[edge_runtime]
enabled = true
[analytics]
enabled = true
`;
  const required = ["api", "auth", "realtime", "local_smtp", "studio", "storage", "edge_runtime", "analytics", "db.pooler"];
  const stanza = (section: string) => `[${section}]\nenabled = ${section === "db.pooler" ? "false" : "true"}`;

  it("accepts native defaults, including enabled storage.vector and commented image transformation", () => {
    expect(() => requirePinnedDefaultConfig(config)).not.toThrow();
    expect(() => requirePinnedDefaultConfig(config.replaceAll("\n", "\r\n"))).not.toThrow();
    expect(() => requirePinnedDefaultConfig(config.replaceAll("enabled =", "  enabled  ="))).not.toThrow();
    expect(() => requirePinnedDefaultConfig(config.replaceAll("enabled = true", "enabled = true # comment"))).not.toThrow();
    expect(() => requirePinnedDefaultConfig(config.replace("[api]", "[api] # enabled = false"))).not.toThrow();
    expect(() => requirePinnedDefaultConfig(config.replace("[api]", "# [api]\n# enabled = false\n[api]"))).not.toThrow();
  });

  it.each(required)("rejects missing, inverted, duplicate or malformed %s sections/flags", (section) => {
    const block = stanza(section);
    for (const replacement of [
      "", `# ${block.replace("\n", "\n# ")}`, `[${section}]`,
      block.replace(/= (true|false)/, `= ${section === "db.pooler" ? "true" : "false"}`),
      `${block}\n${block}`, `${block}\nenabled = true`,
      `${block}\nenabled = false`, `${block}\nenabled = "true"`,
      block.replace(`[${section}]`, `[${section}`),
      block.replace(`[${section}]`, `[${section}]]`),
      block.replace(`[${section}]`, `[[${section}]]`),
      block.replace(`[${section}]`, `[${section}] trailing`),
      block.replace(`[${section}]`, `["${section}"]`),
      block.replace("enabled =", "# enabled ="),
      block.replace("enabled =", "enabled :"),
      block.replace("enabled =", '"enabled" ='),
      block.replace(/= (true|false)/, "= TRUE"),
      block.replace(/= (true|false)/, '= "true"'),
      block.replace(/= (true|false)/, "= 1"),
      block.replace(/= (true|false)/, "= true trailing"),
      block.replace(/= (true|false)/, "= # true"),
      block.replace(/= (true|false)/, "=\ntrue"),
      `[${section}]\n# enabled = true\n[${section}.unrelated]\nenabled = true`,
      `[${section}]\n[${section}.unrelated]\nenabled = false`,
    ]) {
      expect(() => requirePinnedDefaultConfig(config.replace(block, replacement)), replacement).toThrow();
    }
  });

  it.each(["true", "false", '"true"', ""])("rejects an active image-transformation section with flag %j", (flag) => {
    expect(() => requirePinnedDefaultConfig(`${config}\n[storage.image_transformation]\nenabled = ${flag}`)).toThrow();
  });

  it.each([
    "[storage.image_transformation]", "[storage.image_transformation] # enabled = false",
    "[storage.image_transformation.extra]", "[storage.image_transformation",
    '["storage"."image_transformation"]', "[storage . image_transformation]",
    "[[storage.image_transformation]]",
  ])("rejects non-default image-transformation syntax %s even without an enabled line", (section) => {
    expect(() => requirePinnedDefaultConfig(`${config}\n${section}`)).toThrow();
  });

  it("rejects dotted/inline gate overrides and multiline syntax outside the generated format", () => {
    for (const changed of [
      `storage.image_transformation.enabled = true\n${config}`,
      `storage = { image_transformation = { enabled = true } }\n${config}`,
      config.replace("[storage]", "[storage]\nimage_transformation = { enabled = true }"),
      config.replace("[storage]", "[storage]\nimage_transformation.enabled = true"),
      config.replace("[api]", 'extra = """\n[api]'),
    ]) expect(() => requirePinnedDefaultConfig(changed)).toThrow();
  });

  it("does not expose malformed config values in safe failures", () => {
    let cause;
    try { requirePinnedDefaultConfig(config.replace("[api]", "[private-invalid-section")); }
    catch (error) { cause = safeFailureCause(error); }
    expect(cause).toEqual({ classification: "guard", message: "Malformed generated config section" });
    expect(formatAcceptanceSummary(cause)).not.toContain("private-invalid-section");
  });

  it("validates the freshly read, hashed config before bridge creation/startup (static wiring)", () => {
    const source = readFileSync(new URL("../../../../scripts/swim-acceptance.ts", import.meta.url), "utf8");
    expect(source).toContain('const generatedConfig = readFileSync(configPath, "utf8");');
    expect(source).toMatch(/manifest\.localConfigSha256 = hash\(generatedConfig\);\s+requirePinnedDefaultConfig\(generatedConfig\);/);
    expect(source.indexOf("requirePinnedDefaultConfig(generatedConfig)")).toBeLessThan(source.indexOf('await stage("loopback task bridge"'));
  });
});

describe("selected container inspection (fixtures/static template, not Docker Go rendering)", () => {
  it("keeps the production projection selective, with .Id JSON spelling and safe optional-map lookups", () => {
    expect(INSPECT_FORMAT).toBe([
      '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},',
      '"Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}},',
      '"State":{"Running":{{json .State.Running}},"Status":{{json .State.Status}},',
      '"Health":{{with (index .State "Health")}}{"Status":{{json (index . "Status")}}}{{else}}null{{end}}},',
      '"HostConfig":{"NetworkMode":{{json .HostConfig.NetworkMode}}},',
      '"NetworkSettings":{"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .NetworkSettings.Ports}}},',
      '"Mounts":{{json .Mounts}}}',
    ].join(" "));
  });

  it.each([
    ["missing", { Running: true, Status: "running" }],
    ["null", { Running: true, Status: "running", Health: null }],
    ["healthy", { Running: true, Status: "running", Health: { Status: "healthy" } }],
  ])("accepts %s Health without bypassing readiness, ownership, network or publication guards", (_, state) => {
    const value = containerSchema.parse({ ...container(), State: state });
    expect(value.State).toEqual(state);
    expect(() => requireContainer(value, project, networkId, true)).not.toThrow();
    expect(() => requireContainer(value, "other", networkId, true)).toThrow();
    expect(() => requireContainer(value, project, "d".repeat(64), true)).toThrow();
    value.State.Running = false;
    expect(() => requireContainer(value, project, networkId, true)).toThrow();
    value.State.Running = true;
    value.NetworkSettings.Ports["5432/tcp"]![0]!.HostIp = "0.0.0.0";
    expect(() => requireContainer(value, project, networkId, true)).toThrow();
  });

  it.each(["unhealthy", "starting", ""])("retains %j Health for inspection but rejects readiness", (status) => {
    const value = containerSchema.parse({ ...container(),
      State: { Running: true, Status: "running", Health: { Status: status } } });
    expect(value.State.Health).toEqual({ Status: status });
    expect(() => requireContainer(value, project, networkId)).not.toThrow();
    expect(() => requireContainer(value, project, networkId, true)).toThrow();
  });

  it.each([{}, { Status: null }, { Status: 1 }, false])("rejects malformed Health metadata: %j", (health) => {
    expect(() => containerSchema.parse({ ...container(),
      State: { Running: true, Status: "running", Health: health } })).toThrow();
  });

  it("checks a complete mixed-Health stack and still rejects an unhealthy service", () => {
    const containers = DEFAULT_SERVICES.map((name, index) => container(name, index + 1));
    delete containers[2]!.State.Health;
    containers[3]!.State.Health = null;
    const values = containers.map((value) => containerSchema.parse(value));
    const network = { ...bridge(), Containers: Object.fromEntries(values.map((c) => [c.Id, {}])) };
    expect(() => requireReadyStack(values, network, project)).not.toThrow();
    values[2]!.State.Health = { Status: "unhealthy" };
    expect(() => requireReadyStack(values, network, project)).toThrow();
  });
});

describe("startup-only bootstrap classification (synthetic inspection fixtures)", () => {
  const job = (image = "public.ecr.aws/supabase/realtime:v2.129.3"): Container => ({
    ...container("realtime", 99),
    Name: "/interesting_elbakyan",
    Config: { Image: image, Labels: { [PROJECT_LABEL]: project, "com.docker.compose.project": project } },
    State: { Running: true, Status: "running", Health: null },
  });
  const images = ["", "public.ecr.aws/", "ghcr.io/"].flatMap((prefix) =>
    ["supabase/realtime:v2.129.3", "supabase/storage-api:v1.70.3", "supabase/gotrue:v2.196.0"]
      .map((image) => `${prefix}${image}`));
  const digest = `@sha256:${"abcdef0123456789".repeat(4)}`;

  it.each(images.flatMap((image) => [image, `${image}${digest}`]))(
    "accepts only startup for official reference %s without changing inspected identity", (image) => {
      const value = job(image);
      const original = structuredClone(value);
      expect(() => requireStartupContainer(value, project, networkId)).not.toThrow();
      expect(value).toEqual(original);
      expect(() => requireContainer(value, project, networkId)).toThrow();
      expect(() => requireContainer(value, project, networkId, true)).toThrow();
    },
  );

  it("allows exposed but unpublished ports, volume mounts and the owned network name mode", () => {
    const value = job();
    value.HostConfig.NetworkMode = `${project}-loopback`;
    value.NetworkSettings.Ports = { "4000/tcp": null };
    value.Mounts = [{ Type: "volume", Name: `supabase_db_${project}` }, { Type: "volume" }];
    expect(() => requireStartupContainer(value, project, networkId)).not.toThrow();
  });

  it.each([PROJECT_LABEL, "com.docker.compose.project"])("requires the exact %s label", (label) => {
    for (const replacement of ["other", "", undefined]) {
      const value = job();
      if (replacement === undefined) delete value.Config.Labels![label];
      else value.Config.Labels![label] = replacement;
      expect(() => requireStartupContainer(value, project, networkId)).toThrow("Foreign startup job");
    }
    const value = job();
    value.Config.Labels = null;
    expect(() => requireStartupContainer(value, project, networkId)).toThrow("Foreign startup job");
  });

  it.each<Container["NetworkSettings"]["Networks"]>([
    {}, { foreign: { NetworkID: "e".repeat(64) } },
    { ...job().NetworkSettings.Networks, extra: { NetworkID: "e".repeat(64) } },
    { ...job().NetworkSettings.Networks, extra: { NetworkID: networkId } },
  ])("rejects missing, foreign or multiple networks: %j", (networks) => {
    const value = job();
    value.NetworkSettings.Networks = networks;
    expect(() => requireStartupContainer(value, project, networkId)).toThrow("Unexpected container network");
  });

  it.each(["host", "bridge", "none", "other-loopback", "e".repeat(64)])("rejects network mode %s", (mode) => {
    const value = job();
    value.HostConfig.NetworkMode = mode;
    expect(() => requireStartupContainer(value, project, networkId)).toThrow("Unexpected container network");
  });

  it.each(["127.0.0.1", "0.0.0.0", "::", "::1", "", "192.0.2.1"])(
    "rejects every host publication, including %j", (host) => {
      const value = job();
      value.NetworkSettings.Ports = { "4000/tcp": null, "5432/tcp": [{ HostIp: host, HostPort: "54322" }] };
      expect(() => requireStartupContainer(value, project, networkId)).toThrow("Startup job publication forbidden");
    },
  );

  it.each(["bind", "tmpfs", "", "other", "Volume"])("rejects mount type %j alongside volumes", (type) => {
    const value = job();
    value.Mounts = [{ Type: "volume" }, { Type: type }];
    expect(() => requireStartupContainer(value, project, networkId)).toThrow("Unexpected startup job mount");
  });

  it.each([
    "supabase/realtime:latest", "supabase/realtime:v2.129.4", "supabase/storage-api:v1.70.4",
    "supabase/gotrue:v2.196.1", "supabase/postgres:v2.129.3", "other/realtime:v2.129.3",
    "docker.io/supabase/realtime:v2.129.3", "example.invalid/supabase/realtime:v2.129.3",
    "public.ecr.aws/other/realtime:v2.129.3", "public.ecr.aws/supabase/realtime:v2.129.3-extra",
    "ghcr.io/supabase/realtime", "supabase/realtime", `supabase/realtime${digest}`,
    `supabase/realtime:v2.129.3${digest}${digest}`,
    `supabase/realtime:v2.129.3@sha256:${"a".repeat(63)}`,
    `supabase/realtime:v2.129.3@sha256:${"a".repeat(65)}`,
    `supabase/realtime:v2.129.3@sha256:${"A".repeat(64)}`,
    `supabase/realtime:v2.129.3@sha256:${"g".repeat(64)}`,
    `supabase/realtime:v2.129.3@sha512:${"a".repeat(64)}`,
    `supabase/realtime:v2.129.3${digest}/extra`,
    `supabase/realtime:v2.129.3${digest}\n`, `supabase/realtime:v2.129.3@bad${digest}`,
    "supabase/realtime:v2.129.3@sha256:", "",
  ])("rejects unapproved or malformed Config.Image %j", (image) => {
    const value = job(image);
    expect(() => requireStartupContainer(value, project, networkId)).toThrow("Unexpected startup job image");
  });

  it("does not use the resolved image ID as the approved reference", () => {
    const value = job();
    value.Config.Image = value.Image;
    expect(() => requireStartupContainer(value, project, networkId)).toThrow("Unexpected startup job image");
  });

  it.each(["/supabase_realtime_other", "/supabase_", `/supabase_realtime_${project}_extra`])(
    "never falls back to bootstrap classification for named service %s", (name) => {
      const value = job();
      value.Name = name;
      expect(() => requireStartupContainer(value, project, networkId)).toThrow("Foreign container");
    },
  );

  it("preserves named startup rules without requiring temporary-job restrictions or readiness", () => {
    for (const name of DEFAULT_SERVICES) {
      const value = container(name);
      value.State.Health = { Status: "starting" };
      expect(() => requireContainer(value, project, networkId)).not.toThrow();
      expect(() => requireStartupContainer(value, project, networkId)).not.toThrow();
      expect(() => requireContainer(value, project, networkId, true)).toThrow("Service not ready");
      value.Config.Labels![PROJECT_LABEL] = "other";
      expect(() => requireStartupContainer(value, project, networkId)).toThrow("Foreign container");
    }
  });

  it("rejects a leftover bootstrap job even when network membership includes it", () => {
    const containers = [...DEFAULT_SERVICES.map((name, index) => container(name, index + 1)), job()];
    const network = { ...bridge(), Containers: Object.fromEntries(containers.map((c) => [c.Id, {}])) };
    expect(() => requireReadyStack(containers, network, project)).toThrow("Incomplete default service set");
  });

  it("retains a safe classified reason for an unsafe transient", () => {
    const value = job("private-invalid-image");
    let cause;
    try { requireStartupContainer(value, project, networkId); }
    catch (error) { cause = safeFailureCause(error); }
    expect(cause).toEqual({ classification: "guard", message: "Unexpected startup job image" });
    expect(formatAcceptanceSummary(cause)).not.toContain("private-invalid-image");
  });

  it("wires startup classification and safe cause recording before stop in the observer (static check)", () => {
    const source = readFileSync(new URL("../../../../scripts/swim-acceptance.ts", import.meta.url), "utf8");
    expect(source).toMatch(/try \{ requireStartupContainer\(container, project, state\.networkId!\); \}\s+catch \(error\) \{\s+manifest\.startupViolation \?\?= safeFailureCause\(error\);\s+unsafe = true;\s+stopStartup\?\.\(\);/);
    expect(source.match(/requireStartupContainer\(/g)).toHaveLength(1);
  });
});

describe("disposable targets and effective Docker publications", () => {
  it("reuses the explicit local/nonproduction RPC guard and restricts database TLS", () => {
    const target = requireLocalStatus(localStatus());
    expect(target.rpcEnv).toMatchObject({ SWIM_TEST_PROJECT_REF: "local", SWIM_RPC_TEST_LOCAL: "true",
      SWIM_RPC_TEST_NONPRODUCTION: "true", SMOKE_SUPABASE_URL: "http://127.0.0.1:54321" });
    expect(target.dbEnv.PGSSLMODE).toBe("disable");
  });
  it.each([
    ["API_URL", "https://test.supabase.co"], ["API_URL", "http://localhost:54321"],
    ["API_URL", "http://127.0.0.1:54322"], ["API_URL", "http://127.0.0.1:54321/path"],
    ["DB_URL", localStatus().DB_URL.replace("127.0.0.1", "remote")],
    ["DB_URL", localStatus().DB_URL.replace("54322", "54329")],
    ["DB_URL", localStatus().DB_URL.replace("//postgres:", "//other:")],
    ["DB_URL", "postgresql://postgres@127.0.0.1:54322/postgres"],
    ["DB_URL", localStatus().DB_URL.replace(/\/postgres$/, "/other")],
    ["DB_URL", `${localStatus().DB_URL}?host=remote`],
    ["DB_URL", `${localStatus().DB_URL}#fragment`],
    ["ANON_KEY", ""], ["SERVICE_ROLE_KEY", "placeholder"],
  ])("rejects an unexpected local status field %s", (key, value) => {
    expect(() => requireLocalStatus({ ...localStatus(), [key]: value })).toThrow();
  });
  it("requires the labeled, default-NAT, IPv6-disabled loopback bridge", () => {
    expect(() => requireNetwork(bridge(), project, true)).not.toThrow();
    for (const change of [
      { Driver: "host" }, { Scope: "swarm" }, { Internal: true }, { EnableIPv6: true }, { Labels: {} },
      { Options: {} }, { Options: { ...bridge().Options, "com.docker.network.bridge.gateway_mode_ipv4": "routed" } },
      { Containers: { foreign: {} } },
    ]) expect(() => requireNetwork({ ...bridge(), ...change }, project, true)).toThrow();
  });
  it.each(["0.0.0.0", "::", "", "::1", "192.0.2.1"])("rejects unexpected host binding %j", (host) => {
    const value = container();
    value.NetworkSettings.Ports["5432/tcp"]![0]!.HostIp = host;
    expect(() => requireContainer(value, project, networkId)).toThrow();
  });
  it("rejects an unexpected HostPort even on loopback", () => {
    const value = container();
    value.NetworkSettings.Ports["5432/tcp"]![0]!.HostPort = "54329";
    expect(() => requireContainer(value, project, networkId)).toThrow();
  });
  it("checks both address families, port, ownership, network and health", () => {
    const value = container();
    expect(() => requireContainer(value, project, networkId, true)).not.toThrow();
    value.NetworkSettings.Ports["5432/tcp"]!.push({ HostIp: "::", HostPort: "54322" });
    expect(() => requireContainer(value, project, networkId)).toThrow();
    expect(() => requireContainer(container(), "other", networkId)).toThrow();
    expect(() => requireContainer(container(), project, "d".repeat(64))).toThrow();
    const unhealthy = container();
    unhealthy.State.Health!.Status = "unhealthy";
    expect(() => requireContainer(unhealthy, project, networkId, true)).toThrow();
    const multiNetwork = container();
    multiNetwork.NetworkSettings.Networks.extra = { NetworkID: "d".repeat(64) };
    expect(() => requireContainer(multiNetwork, project, networkId)).toThrow();
  });

  describe("production acceptance reporting (synthetic evidence only)", () => {
    const noSummary = () => {};
    const unsafe = 'synthetic-private-key "quoted"\nhttps://private.invalid/status?key=synthetic-only <secret>';

    it("retains a useful guard reason after a successful process without blaming that process", async () => {
      const reporting = new AcceptanceReporting();
      await expect(reporting.stage("RPC report", async () => {
        requireProcess(passed);
        requireFreshReport({ size: 0, mtimeMs: 150, isFile: true }, 100, 200);
      }, noSummary)).rejects.toThrow();
      expect(reporting.stages[0]).toMatchObject({
        status: "failed",
        failure: { classification: "guard", message: "RPC report missing, empty or stale" },
      });
      expect(reporting.stages[0]).not.toHaveProperty("result");
      expect(reporting.stages[0]!.failure).not.toHaveProperty("result");
      expect(reporting.failures.primary?.cause).toEqual(reporting.stages[0]!.failure);
      expect(formatAcceptanceSummary(reporting)).not.toContain('"code": 0');
    });

    it("attributes process failure to its own result, not a later successful command", async () => {
      const reporting = new AcceptanceReporting();
      const failed = { code: 1, signal: null, timedOut: false };
      await expect(reporting.stage("startup", async () => {
        requireProcess(passed);
        requireProcess(failed);
      }, noSummary)).rejects.toThrow();
      expect(reporting.failures.primary?.cause).toMatchObject({ classification: "process", result: failed });
      await reporting.stage("next stage", async () => requireProcess(passed), noSummary);
      expect(reporting.stages[1]).not.toHaveProperty("failure");
      expect(reporting.failures.primary?.cause.result).toEqual(failed);
    });

    it.each([
      ["parser", () => JSON.parse(`{"key":${unsafe}}`)],
      ["unexpected", () => { throw new Error(unsafe); }],
      ["unexpected", () => resourceSchema.parse({ project: unsafe })],
      ["unexpected", () => { throw { message: unsafe, stack: unsafe }; }],
      ["assertion", () => assert.deepEqual({ key: unsafe }, {})],
      ["assertion", () => assert(false, unsafe)],
    ])("withholds unsafe %s errors, including unregistered explicit assertion messages", async (classification, action) => {
      const reporting = new AcceptanceReporting();
      await expect(reporting.stage("status", async () => action(), noSummary)).rejects.toBeDefined();
      expect(reporting.failures.primary?.cause.classification).toBe(classification);
      const output = formatAcceptanceSummary(reporting);
      for (const value of ["synthetic-private-key", "private.invalid", "https://", "<secret>", "stack"]) {
        expect(output).not.toContain(value);
      }
    });

    it("does not trust an arbitrary error merely because its message matches a guard", () => {
      expect(safeFailureCause(new Error("Unexpected local API")).classification).toBe("unexpected");
    });

    it("withholds unsafe signal material even on a classified process failure", () => {
      let cause;
      try { requireProcess({ code: null, signal: unsafe, timedOut: false }); }
      catch (error) { cause = safeFailureCause(error); }
      expect(cause).toMatchObject({ classification: "process", result: { signal: "unknown-signal" } });
      expect(formatAcceptanceSummary(cause)).not.toContain("private.invalid");
    });

    it("retains canonical ledger issues without publishing raw assertion failures", async () => {
      const input = report();
      input.success = false;
      input.numFailedTests = 1;
      input.numPassedTests--;
      input.testResults[0]!.assertionResults[0]!.status = "failed";
      input.testResults[0]!.assertionResults[0]!.failureMessages.push(unsafe);
      const value = validateSwimRpcReport(JSON.stringify(input), sha, configHash);
      const reporting = new AcceptanceReporting();
      await expect(reporting.stage("RPC ledger", async () => {
        requireAcceptance(passed, value, sha, configHash);
      }, noSummary)).rejects.toThrow();
      const output = formatAcceptanceSummary({ failures: reporting.failures, ledger: value });
      expect(output).toContain("Positive canonical RPC ledger required");
      expect(output).toContain("Non-passed RPC assertion");
      expect(output).not.toContain("private.invalid");
      expect(reporting.failures.primary?.cause).not.toHaveProperty("result");
    });

    it("publishes only authored assertion text and redacts JSON-escaped secrets before HTML escaping", () => {
      let cause;
      try { acceptanceAssert.deepEqual({ key: unsafe }, {}, "Local <guard> & failed"); }
      catch (error) { cause = safeFailureCause(error); }
      const output = formatAcceptanceSummary({ cause, secret: unsafe }, [unsafe]);
      expect(output).toContain("Local &lt;guard&gt; &amp; failed");
      expect(output).toContain("[redacted]");
      expect(output).not.toContain("synthetic-private-key");
      expect(output).not.toContain("private.invalid");
      expect(output).not.toContain("actual");
    });

    it("appends the same sanitized summary to stdout and the summary file", () => {
      const directory = mkdtempSync(join(tmpdir(), "swim-acceptance-summary-"));
      const path = join(directory, "summary.md");
      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const reporting = new AcceptanceReporting();
        try { acceptanceAssert(false, "Local <guard> & failed"); }
        catch (error) { reporting.recordFailure("status", error); }
        reporting.recordFailure("source verification", new Error(unsafe));
        const secrets = [localStatus().ANON_KEY, localStatus().SERVICE_ROLE_KEY, 'synthetic-key "quoted"\r\n<&>'];
        const data = { failures: reporting.failures, evidence: secrets };
        const text = formatAcceptanceSummary(data, secrets);
        const summary = `\n### Swim acceptance result\n<pre>${text}</pre>\n`;
        publishAcceptanceSummary(path, "Swim acceptance result", data, secrets);
        publishAcceptanceSummary(path, "Swim acceptance result", data, secrets);
        expect(stdout.mock.calls).toEqual([
          [`[swim-acceptance-summary]${summary}`], [`[swim-acceptance-summary]${summary}`],
        ]);
        expect(readFileSync(path, "utf8")).toBe(summary.repeat(2));
        for (const output of [stdout.mock.calls[0]![0] as string, readFileSync(path, "utf8")]) {
          expect(output).toContain("Local &lt;guard&gt; &amp; failed");
          expect(output).toContain("[redacted]");
          expect(output).toContain("Unexpected acceptance error; details withheld");
          for (const value of [...secrets, "synthetic-key", "synthetic-private-key", "private.invalid", "<secret>", "stack"]) {
            expect(output).not.toContain(value);
          }
        }
      } finally {
        stdout.mockRestore();
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it("keeps safe stdout evidence and throws when the summary destination is unwritable", async () => {
      const directory = mkdtempSync(join(tmpdir(), "swim-acceptance-summary-"));
      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const reporting = new AcceptanceReporting();
        await expect(reporting.stage("startup", async () => {
          requireProcess({ code: 1, signal: null, timedOut: false });
        }, noSummary)).rejects.toThrow();
        reporting.recordFailure("cleanup", new Error(unsafe), true);
        const primary = reporting.failures.primary;
        const data = { ...outcome(primary?.stage, false), stages: reporting.stages, failures: reporting.failures };
        const text = formatAcceptanceSummary(data);
        expect(() => publishAcceptanceSummary(directory, "Swim acceptance result", data)).toThrow();
        expect(stdout.mock.calls).toEqual([
          [`[swim-acceptance-summary]\n### Swim acceptance result\n<pre>${text}</pre>\n`],
        ]);
        expect(text).toContain('"success": false');
        expect(text).toContain('"cleanup": "unconfirmed"');
        expect(reporting.failures.primary).toBe(primary);
        expect(reporting.failures.cleanup).toHaveLength(1);
        for (const value of [directory, "synthetic-private-key", "private.invalid", "stack"]) {
          expect(stdout.mock.calls[0]![0]).not.toContain(value);
        }
      } finally {
        stdout.mockRestore();
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it("keeps original, source-verification and cleanup failures distinct and fails closed", async () => {
      const reporting = new AcceptanceReporting();
      await expect(reporting.stage("migrations", async () => {
        requireProcess({ code: 1, signal: null, timedOut: false });
      }, noSummary)).rejects.toThrow();
      const original = reporting.failures.primary;
      reporting.recordFailure("source verification", new Error(unsafe));
      try { requireCleanupState({ project: "other" } as Resources, project, sha); }
      catch (error) { reporting.recordFailure("cleanup", error, true); }
      expect(reporting.failures.primary).toBe(original);
      expect(reporting.failures.secondary[0]?.stage).toBe("source verification");
      expect(reporting.failures.cleanup[0]).toMatchObject({
        stage: "cleanup", cause: { classification: "guard", message: "Foreign cleanup state" },
      });
      expect(outcome(reporting.failures.primary?.stage, false).success).toBe(false);
      expect(formatAcceptanceSummary(reporting)).not.toContain("private.invalid");
    });

    it("reports cleanup-only failures without inventing a primary failure", () => {
      const reporting = new AcceptanceReporting();
      reporting.recordFailure("cleanup", new Error(unsafe), true);
      expect(reporting.failures.primary).toBeNull();
      expect(reporting.failures.cleanup[0]?.cause.classification).toBe("unexpected");
      expect(outcome(reporting.failures.primary?.stage, false).success).toBe(false);
    });
  });

  describe("production private command logs", () => {
    async function fixture(options: { capture?: boolean; separateStdout?: boolean }, oversized = false) {
      const directory = mkdtempSync(join(tmpdir(), "swim-stdout-routing-"));
      const path = join(directory, "command.log");
      const log = openPrivateCommandLog(path);
      const diagnostic = "PostgresError: SCID/1/roles/pre/roles/tttttt\n";
      const size = oversized ? 8 * 1024 * 1024 : 8;
      let timedOut = false;
      let acknowledged = false;
      let ready = false;
      const stdout = commandStdout(log, options, () => {
        timedOut = true;
        child.kill("SIGTERM");
      });
      const child = spawn(process.execPath, ["-e", `
        const { writeSync } = require("node:fs");
        const diagnostic = ${JSON.stringify(diagnostic)};
        if (${oversized}) writeSync(2, diagnostic);
        process.on("message", () => {
          if (${oversized}) process.stdout.write("x");
          else {
            writeSync(2, diagnostic);
            process.disconnect();
          }
        });
        process.stdout.write(Buffer.alloc(${size}, "x"), () => process.send("ready"));
      `], { stdio: ["ignore", stdout.stdio, log.fd, "ipc"] });
      const acknowledge = () => {
        if (!ready || acknowledged || (child.stdout && stdout.text.length !== size)) return;
        acknowledged = true;
        child.send("continue");
      };
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout.onData(chunk);
        acknowledge();
      });
      child.on("message", () => { ready = true; acknowledge(); });
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      let spawnFailed = false;
      child.once("error", () => { spawnFailed = true; });
      const watchdog = setTimeout(() => { child.kill("SIGKILL"); }, 4_000);
      try {
        const result = await closed;
        expect(spawnFailed).toBe(false);
        expect(acknowledged).toBe(true);
        expect(lstatSync(path).mode & 0o777).toBe(0o600);
        expect(() => openPrivateCommandLog(path)).toThrow();
        return {
          ...result, timedOut, text: stdout.text,
          log: readFileSync(path, "utf8"), evidence: readMigrationDiagnostic(path), diagnostic,
        };
      } finally {
        clearTimeout(watchdog);
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await closed;
        expect(child.exitCode !== null || child.signalCode !== null || spawnFailed).toBe(true);
        closeSync(log.fd);
        rmSync(directory, { recursive: true });
        expect(existsSync(directory)).toBe(false);
      }
    }

    it.each([{}, { capture: true }])("retains corrupt combined append with options %j", async (options) => {
      const result = await fixture(options);
      expect(result).toMatchObject({ code: 0, signal: null, timedOut: false, evidence: "unavailable" });
      expect(result.log).toBe(`xxxxxxxx${result.diagnostic}`);
      expect(result.text).toBe("capture" in options ? "xxxxxxxx" : "");
    });

    it.each([{ separateStdout: true }, { capture: true, separateStdout: true }])(
      "separates newline-less stdout through the production helper with options %j", async (options) => {
        const result = await fixture(options);
        expect(result).toMatchObject({ code: 0, signal: null, timedOut: false, text: "xxxxxxxx",
          evidence: { version: 1, guard: "roles", phase: "pre", object: "roles", bits: "tttttt" } });
        expect(result.log).toBe(result.diagnostic);
      },
    );

    it("terminates oversized separated stdout at the unchanged capture bound without logging it", async () => {
      const result = await fixture({ separateStdout: true }, true);
      expect(result).toMatchObject({ code: null, signal: "SIGTERM", timedOut: true });
      expect(result.text.length).toBe(8 * 1024 * 1024 + 1);
      expect(result.log).toBe(result.diagnostic);
      expect(result.evidence).toMatchObject({ guard: "roles", bits: "tttttt" });
    });

    it("preserves interleaved captured stdout and descriptor stderr with exclusive 0600 creation", () => {
      const directory = mkdtempSync(join(tmpdir(), "swim-acceptance-log-"));
      const path = join(directory, "command.log");
      try {
        const log = openPrivateCommandLog(path);
        try {
          log.append(Buffer.from("stdout-1\n"));
          writeSync(log.fd, "stderr-1\n");
          log.append(Buffer.from("stdout-2\n"));
          writeSync(log.fd, "stderr-2\n");
          expect(readFileSync(path, "utf8")).toBe("stdout-1\nstderr-1\nstdout-2\nstderr-2\n");
          expect(lstatSync(path).mode & 0o777).toBe(0o600);
          expect(() => openPrivateCommandLog(path)).toThrow();
          expect(readFileSync(path, "utf8")).toBe("stdout-1\nstderr-1\nstdout-2\nstderr-2\n");
        } finally { closeSync(log.fd); }
      } finally { rmSync(directory, { recursive: true, force: true }); }
    });
  });
  it("requires all official default services and exact API/database publications", () => {
    expect(DEFAULT_SERVICES).toEqual([
      "db", "kong", "auth", "inbucket", "realtime", "rest", "storage",
      "pg_meta", "studio", "edge_runtime", "analytics", "vector",
    ]);
    const containers = DEFAULT_SERVICES.map((name, index) => container(name, index + 1));
    const network = { ...bridge(), Containers: Object.fromEntries(containers.map((c) => [c.Id, {}])) };
    expect(() => requireReadyStack(containers, network, project)).not.toThrow();
    expect(() => requireReadyStack(containers.slice(1), network, project)).toThrow();
    containers[0]!.NetworkSettings.Ports = {};
    expect(() => requireReadyStack(containers, network, project)).toThrow();
  });
  it.each(DEFAULT_SERVICES)("rejects missing required service %s even with matching network membership", (missing) => {
    const containers = DEFAULT_SERVICES.filter((name) => name !== missing).map((name, index) => container(name, index + 1));
    const network = { ...bridge(), Containers: Object.fromEntries(containers.map((c) => [c.Id, {}])) };
    expect(() => requireReadyStack(containers, network, project)).toThrow("Incomplete default service set");
    expect(readyServiceNames(containers, project)).toMatchObject({
      missing: [`/supabase_${missing}_${project}`], unexpected: [],
    });
  });
  it.each(["imgproxy", "unknown", "db"])("rejects extra/duplicate %s even with matching network membership", (extra) => {
    const containers = [...DEFAULT_SERVICES.map((name, index) => container(name, index + 1)), container(extra, 99)];
    const network = { ...bridge(), Containers: Object.fromEntries(containers.map((c) => [c.Id, {}])) };
    expect(() => requireReadyStack(containers, network, project)).toThrow("Incomplete default service set");
  });
  it.each(["0.0.0.0", "::", "::1", "", "192.0.2.1"])("rejects non-default binding %j at full-stack readiness", (host) => {
    const containers = DEFAULT_SERVICES.map((name, index) => container(name, index + 1));
    const network = { ...bridge(), Containers: Object.fromEntries(containers.map((c) => [c.Id, {}])) };
    containers[0]!.NetworkSettings.Ports["5432/tcp"]![0]!.HostIp = host;
    expect(() => requireReadyStack(containers, network, project)).toThrow();
  });
  it("retains only current service names, including missing, extra and leftover job identities", () => {
    const containers = DEFAULT_SERVICES.map((name, index) => container(name, index + 1));
    const expected = containers.map((c) => c.Name).sort();
    expect(readyServiceNames(containers, project)).toEqual({ expected, observed: expected, missing: [], unexpected: [] });
    const current = [...containers.slice(1), container("imgproxy", 99),
      { ...container("realtime", 100), Name: "/interesting_elbakyan" }];
    expect(readyServiceNames(current, project)).toEqual({
      expected, observed: current.map((c) => c.Name).sort(),
      missing: [`/supabase_db_${project}`],
      unexpected: ["/interesting_elbakyan", `/supabase_imgproxy_${project}`],
    });
    const source = readFileSync(new URL("../../../../scripts/swim-acceptance.ts", import.meta.url), "utf8");
    expect(source).toMatch(/const containers = await inspect\(ids\);\s+manifest\.serviceNames = readyServiceNames\(containers, project\);\s+const bridge = await network\(\);\s+requireReadyStack\(containers, bridge, project\);/);
  });
  it("withholds non-name inspection fields and malformed names from service diagnostics", () => {
    const value = container();
    value.Name = "/private-invalid-name\nhttps://private.invalid";
    value.Config.Labels!["private-label"] = "private-label-value";
    value.Config.Image = "private-image-value";
    const names = readyServiceNames([value], project);
    expect(names.observed).toEqual(["[invalid container name]"]);
    expect(names.unexpected).toEqual(["[invalid container name]"]);
    expect(formatAcceptanceSummary(names)).not.toContain("private");
  });
  it("rejects unhealthy, stopped or foreign services and foreign network membership at readiness", () => {
    const containers = DEFAULT_SERVICES.map((name, index) => container(name, index + 1));
    const network = { ...bridge(), Containers: Object.fromEntries(containers.map((c) => [c.Id, {}])) };
    for (const change of [
      { State: { Running: true, Status: "running", Health: { Status: "unhealthy" } } },
      { State: { Running: false, Status: "exited", Health: null } },
      { Config: { ...containers[0]!.Config, Labels: { [PROJECT_LABEL]: "other" } } },
      { Name: "/supabase_db_other" },
    ]) {
      expect(() => requireReadyStack([{ ...containers[0]!, ...change }, ...containers.slice(1)], network, project)).toThrow();
    }
    network.Containers["e".repeat(64)] = {};
    expect(() => requireReadyStack(containers, network, project)).toThrow("Unexpected network membership");
  });
});

describe("stage results, canonical ledger and cleanup state", () => {
  it.each([
    { code: 1, signal: null, timedOut: false }, { code: null, signal: "SIGTERM", timedOut: false },
    { code: 0, signal: null, timedOut: true }, { code: null, signal: "spawn-error", timedOut: false },
  ])("rejects unsuccessful processes even with a positive ledger: %j", (result) => {
    expect(() => requireProcess(result)).toThrow();
    expect(() => requireAcceptance(result, ledger(), sha, configHash)).toThrow();
  });
  it("requires nonempty fresh regular-file evidence", () => {
    expect(() => requireFreshReport({ size: 100, mtimeMs: 150, isFile: true }, 100, 200)).not.toThrow();
    for (const change of [{ size: 0 }, { mtimeMs: 99 }, { mtimeMs: 201 }, { isFile: false }]) {
      expect(() => requireFreshReport({ size: 100, mtimeMs: 150, isFile: true, ...change }, 100, 200)).toThrow();
    }
  });
  it("exit zero cannot replace the canonical positive ledger, SHA or config", () => {
    expect(() => requireAcceptance(passed, ledger(), sha, configHash)).not.toThrow();
    for (const value of [
      { ...ledger(), success: false }, { ...ledger(), testedSha: "d".repeat(40) },
      { ...ledger(), configSha256: "d".repeat(64) }, { ...ledger(), suites: [] },
    ]) expect(() => requireAcceptance(passed, value, sha, configHash)).toThrow();
    const skipped = report();
    skipped.testResults[0]!.assertionResults[0]!.status = "skipped";
    expect(() => requireAcceptance(passed,
      validateSwimRpcReport(JSON.stringify(skipped), sha, configHash), sha, configHash)).toThrow();
  });
  it("validates exact task cleanup state and process fingerprints", () => {
    const state: Resources = { project, sha, createdAt: 1, containers: [container().Id],
      volumes: [`supabase_db_${project}`], networkId, processes: [{ pid: 123, startTicks: "456" }], cleanup: "unconfirmed" };
    expect(resourceSchema.parse(state)).toEqual(state);
    expect(() => requireCleanupState(state, project, sha)).not.toThrow();
    expect(() => requireCleanupState(state, "pr802-124-1", sha)).toThrow();
    expect(() => requireCleanupState(state, project, "d".repeat(40))).toThrow();
    expect(() => resourceSchema.parse({ ...state, volumes: ["*"] })).toThrow();
    expect(() => resourceSchema.parse({ ...state, processes: [{ pid: 1, startTicks: "456" }] })).toThrow();
    const fields = ["S", "1", "123", ...Array(16).fill("0"), "456"];
    expect(processIdentity(`123 (name with ) spaces) ${fields.join(" ")}`)).toEqual({ group: 123, startTicks: "456" });
  });
  it("retains the original failed stage when cleanup also fails", () => {
    expect(outcome("migrations", false)).toEqual({ success: false, primary: "migrations", cleanup: "unconfirmed" });
    expect(outcome(undefined, false).success).toBe(false);
    expect(outcome("RPC", true).success).toBe(false);
    expect(outcome(undefined, true).success).toBe(true);
  });
});
