import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  symlinkSync, truncateSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reporter } from "vitest/reporters";
import SwimRpcDiagnosticsReporter, {
  collectSwimRpcDiagnostics, DIAGNOSTICS_ENV, DIAGNOSTICS_FILE, DIAGNOSTICS_LIMITS, DIAGNOSTICS_SUITE,
  projectSwimRpcDiagnostics, readSwimRpcDiagnostics, writeSwimRpcDiagnostics,
} from "../../../../scripts/swim-rpc-diagnostics";
import { requireAcceptance } from "../../../../scripts/swim-acceptance-guards";
import { AcceptanceReporting, formatAcceptanceSummary } from "../../../../scripts/swim-acceptance-reporting";
import { MIN_RPC_CASES, RPC_CONFIG, RPC_SUITE, validateSwimRpcReport } from "./storage-rpc-report";

vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>() }));

type Files = Parameters<NonNullable<Reporter["onFinished"]>>[0];
const sha = "a".repeat(40);
const configHash = "b".repeat(64);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const caseName = `${DIAGNOSTICS_SUITE} synthetic case`;
const directories: string[] = [];
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), "swim-rpc-diagnostics-"));
  chmodSync(directory, 0o700);
  directories.push(directory);
  return directory;
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const ledger = (passed = false) => validateSwimRpcReport(JSON.stringify({
  success: passed, numTotalTests: MIN_RPC_CASES, numPassedTests: passed ? MIN_RPC_CASES : 0,
  numFailedTests: passed ? 0 : MIN_RPC_CASES, numPendingTests: 0, numTodoTests: 0,
  numTotalTestSuites: 1, numPassedTestSuites: passed ? 1 : 0, numFailedTestSuites: passed ? 0 : 1,
  numPendingTestSuites: 0,
  testResults: [{ name: RPC_SUITE, status: passed ? "passed" : "failed",
    assertionResults: Array.from({ length: MIN_RPC_CASES }, (_, index) => ({
      fullName: index ? `${caseName} ${index}` : caseName,
      status: passed ? "passed" : "failed", failureMessages: passed ? [] : ["synthetic private failure"],
    })) }],
}), sha, configHash);
const file = (errors: unknown[], name = "synthetic case") => [{
  type: "suite", name: "private/path", filepath: RPC_SUITE,
  tasks: [{ type: "suite", name: DIAGNOSTICS_SUITE, tasks: [
    { type: "test", name, result: { state: "fail", errors } },
  ] }],
}] as unknown as Files;
const serialized = (files = file([]), errors: unknown[] = []) => {
  const value = collectSwimRpcDiagnostics(files, errors);
  return [value.status, ...value.records].map((record) => JSON.stringify(record)).join("\n") + "\n";
};
const postgrest = (message = 'permission denied for table "swim_plans"', code = "42501") => ({
  name: "Error", message: `swim_create_plan: ${message}`,
  cause: { name: "PostgrestError", message, code, details: "synthetic private details", hint: "synthetic private hint" },
});

describe("safe RPC diagnostics (synthetic reporting evidence, not swim acceptance)", () => {
  it("collects nested serialized PostgREST causes and groups shared failures with case/RPC association", () => {
    const files = file([postgrest(), postgrest()]);
    const suite = files[0]!.tasks[0]!;
    const second = file([postgrest()], "synthetic case 1")[0]!.tasks[0]!;
    if (suite.type !== "suite" || second.type !== "suite") throw new Error("Expected synthetic suites");
    suite.tasks.push(...second.tasks);
    const evidence = projectSwimRpcDiagnostics(serialized(files), ledger());
    expect(evidence).toMatchObject({ status: "complete", invalidRecords: 0 });
    expect(evidence.groups).toHaveLength(1);
    expect(evidence.groups[0]).toMatchObject({
      code: "42501", category: "permission", count: 3,
      associations: [{ case: caseName, suite: DIAGNOSTICS_SUITE, phase: "test",
        errorClass: "Error", hasCause: true, rpc: "swim_create_plan", identifiers: ["swim_plans", "swim_create_plan"], count: 2 },
      { case: `${caseName} 1`, phase: "test", rpc: "swim_create_plan", count: 1 }],
    });
    expect(evidence.groups[0]!.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const nested = postgrest();
    Object.assign(nested.cause, { cause: { message: "deepest message", code: "23503" } });
    expect(collectSwimRpcDiagnostics(file([nested])).records[0]).toMatchObject({ code: "23503", category: "constraint" });
  });

  it("normalizes UUIDs, numbers and quoted literals without run/project salts or other serialized fields", () => {
    const fingerprint = (message: string) => collectSwimRpcDiagnostics(file([postgrest(message)])).records[0]!.fingerprint;
    expect(fingerprint('id 12345678-1234-1234-1234-123456789abc count 123 "first" \'second\' `third`'))
      .toBe(fingerprint('id abcdefab-abcd-abcd-abcd-abcdefabcdef count 987 "other" \'secret\' `fourth`'));
    expect(fingerprint("one failure")).not.toBe(fingerprint("different failure"));
    const original = postgrest();
    const changed = { ...original, stack: "synthetic secret stack", request: { token: "synthetic-token" },
      cause: { ...original.cause, details: "changed details", hint: "changed hint" } };
    expect(serialized(file([original]))).toBe(serialized(file([changed])));
  });

  it.each(["Error", "AssertionError", "PostgrestError", "TypeError", "SyntaxError", "RangeError", "Other"])(
    "retains fixed error class %s and explicit absent cause", (name) => {
      expect(collectSwimRpcDiagnostics(file([{ name, message: "unknown failure" }])).records[0])
        .toMatchObject({ errorClass: name, hasCause: false, category: "unclassified" });
    },
  );
  it.each(["arbitrary-secret", "TypeError\n", "", undefined])("never echoes unknown error name %j", (name) => {
    expect(collectSwimRpcDiagnostics(file([{ name, message: "unknown failure" }])).records[0]!.errorClass).toBe("Other");
  });
  it.each([
    ["PGRST202", "schema-cache"], ["PGRST999", "unclassified"], ["ZZ999", "unclassified"],
    ["P0001", "domain"], ["42P01", "undefined-object"], ["23505", "constraint"],
  ])("accepts exact code %s with fixed category %s", (code, category) => {
    expect(collectSwimRpcDiagnostics(file([postgrest("failure", code)])).records[0]).toMatchObject({ code, category });
  });
  it.each(["42501\n", "42501\r", " 42501", "42501x", "pgrst202", "PGRST20", "PGRST2022", "SECRET", "42p01"])(
    "omits invalid code %j", (code) => {
      expect(collectSwimRpcDiagnostics(file([postgrest("failure", code)])).records[0]).not.toHaveProperty("code");
    },
  );
  it.each(["prefix_swim_create_plan: failure", "swim_create_plan_suffix: failure",
    "swim_create_plan : failure", "https://private.invalid/swim_create_plan: failure", "swim_create_plan:\nfailure"])(
    "does not infer an RPC from misleading prefix %j", (message) => {
      expect(collectSwimRpcDiagnostics(file([{ message }])).records[0]).not.toHaveProperty("rpc");
    },
  );
  it("only emits whole allowed identifiers and exact literal domain message IDs", () => {
    const matched = collectSwimRpcDiagnostics(file([{ message: 'public."swim_plans" swim_workouts_owned_plan_fk' },
      { message: "Invalid swimming setup." }])).records;
    expect(matched[0]!.identifiers).toEqual(["public", "swim_plans", "swim_workouts_owned_plan_fk"]);
    expect(matched[1]!.domainMessageId).toBe("invalid-setup");
    for (const message of [
      'private_swim_plans swim_plans_suffix swim_plans$secret swim_plansé swim_plans\u0301 "private.swim_plans"',
      "prefix Invalid swimming setup.", "Invalid swimming setup. suffix", "Invalid swimming setup.\n",
      "Invalid swimming setup. 123", "swim_create_plan: Invalid swimming setup.",
    ]) {
      const record = collectSwimRpcDiagnostics(file([{ message }])).records[0]!;
      expect(record).not.toHaveProperty("domainMessageId");
      expect(record.identifiers).not.toContain("swim_plans");
    }
  });
  it("checks the diagnostic allowlists against tracked migration identifiers and literal exceptions", () => {
    const sql = readFileSync(new URL("../../../../../../packages/db/drizzle/0145_standalone_pool_swimming.sql", import.meta.url), "utf8");
    const source = readFileSync(new URL("../../../../scripts/swim-rpc-diagnostics.ts", import.meta.url), "utf8");
    const literals = source.slice(source.indexOf("const domainMessages"), source.indexOf("const reasons"));
    for (const [, message] of literals.matchAll(/: "([^"]+)"/g)) {
      expect(sql).toContain(`RAISE EXCEPTION '${message}'`);
      expect(message).not.toContain("%");
    }
    const allowed = source.slice(source.indexOf("const rpcNames"), source.indexOf("const errorClasses")) +
      source.slice(source.indexOf("const identifiers"), source.indexOf("const domainMessages"));
    for (const [, identifier] of allowed.matchAll(/"([a-z_]+)"/g)) expect(sql).toContain(identifier);
  });

  it("retains unknown errors but withholds hostile case names and all raw secret-like fields", () => {
    const secret = 'synthetic-private-token https://private.invalid?key=fixture <script> ::warning::';
    const value = projectSwimRpcDiagnostics(serialized(file([
      { name: secret, message: secret, stack: secret, details: secret, hint: secret, code: secret },
      null, 42, "unknown error",
    ], secret)), ledger());
    expect(value).toMatchObject({ status: "partial", reason: "case-unverified", invalidRecords: 4 });
    expect(value.groups.reduce((count, group) => count + group.count, 0)).toBe(4);
    for (const group of value.groups) expect(group.associations[0]).not.toHaveProperty("case");
    const output = formatAcceptanceSummary(value);
    for (const raw of ["synthetic-private-token", "https://", "<script>", "::warning::", "private.invalid", "details", "stack", "hint"]) {
      expect(output).not.toContain(raw);
    }
  });
  it("uses a fixed suite for file collection errors, suite hooks and failed test hooks", () => {
    const files = file([{ name: "Error", message: "test hook failure" }]);
    const suite = files[0]!.tasks[0]!;
    if (suite.type !== "suite") throw new Error("Expected synthetic suite");
    files[0]!.result = { state: "fail", errors: [{ name: "SyntaxError", message: "collection" }] };
    suite.result = { state: "fail", hooks: { beforeAll: "run" }, errors: [{ name: "Error", message: "suite hook" }] };
    suite.tasks[0]!.result!.hooks = { beforeEach: "run" };
    const evidence = projectSwimRpcDiagnostics(serialized(files, [{ name: "Error", message: "unhandled" }]), ledger());
    expect(evidence.groups.flatMap((group) => group.associations).map((item) => item.phase))
      .toEqual(["collection", "hook", "hook", "collection"]);
    for (const item of evidence.groups.flatMap((group) => group.associations)) {
      expect(item.suite).toBe(DIAGNOSTICS_SUITE);
      expect(item).not.toHaveProperty("case");
    }
    expect(formatAcceptanceSummary(evidence)).not.toContain("private/path");
  });
  it("explicitly reports unavailable canonical cases without publishing unverified identities", () => {
    const evidence = projectSwimRpcDiagnostics(serialized(file([postgrest()])));
    expect(evidence).toMatchObject({ status: "partial", reason: "canonical-cases-unavailable", invalidRecords: 1 });
    expect(evidence.groups[0]!.associations[0]).not.toHaveProperty("case");
  });
  it("marks cycles, cause depth, message overflow and record overflow partial", () => {
    const cycle = { message: "cycle", cause: undefined as unknown };
    cycle.cause = cycle;
    expect(collectSwimRpcDiagnostics(file([cycle])).status).toMatchObject({ status: "partial", reason: "cycle" });
    let nested: unknown = postgrest();
    for (let index = 0; index < DIAGNOSTICS_LIMITS.causes; index++) nested = { message: "wrapper", cause: nested };
    const deep = collectSwimRpcDiagnostics(file([nested]));
    expect(deep.status).toMatchObject({ status: "partial", reason: "cause-limit" });
    expect(deep.records[0]!.category).toBe("unclassified");
    const large = collectSwimRpcDiagnostics(file([postgrest("a".repeat(DIAGNOSTICS_LIMITS.messageBytes + 1))]));
    expect(large.status).toMatchObject({ status: "partial", reason: "message-limit" });
    expect(large.records[0]).toMatchObject({ category: "unclassified", identifiers: [] });
    const many = collectSwimRpcDiagnostics(file(Array(DIAGNOSTICS_LIMITS.records + 1).fill(postgrest())));
    expect(many.status).toMatchObject({ status: "partial", reason: "record-limit", records: DIAGNOSTICS_LIMITS.records });
  });
  it("bounds task traversal, cycles and overlong case identities", () => {
    const cyclic = file([]);
    cyclic[0]!.tasks.push(cyclic[0]!);
    expect(collectSwimRpcDiagnostics(cyclic).status.reason).toBe("cycle");
    const many = Array.from({ length: DIAGNOSTICS_LIMITS.tasks + 1 }, () => file([])[0]!);
    expect(collectSwimRpcDiagnostics(many).status.reason).toBe("task-limit");
    const long = collectSwimRpcDiagnostics(file([postgrest()], "x".repeat(DIAGNOSTICS_LIMITS.messageBytes + 1)));
    expect(long.status.reason).toBe("identity-limit");
    expect(long.records[0]).not.toHaveProperty("caseHash");
  });
  it("reports collector failure without exposing getter exceptions or throwing from onFinished", () => {
    const error = { get message(): string { throw new Error("synthetic-private-token"); } };
    expect(collectSwimRpcDiagnostics(file([error]))).toEqual({
      status: { kind: "collector", status: "unavailable", reason: "collector-failure", records: 0 }, records: [],
    });
    const directory = temporary();
    vi.stubEnv("HOME", join(directory, "home"));
    vi.stubEnv(DIAGNOSTICS_ENV, join(directory, DIAGNOSTICS_FILE));
    expect(() => new SwimRpcDiagnosticsReporter().onFinished(file([error]), [])).not.toThrow();
    expect(readSwimRpcDiagnostics(directory, 0, ledger())).toMatchObject({
      status: "unavailable", reason: "collector-failure", invalidRecords: 0, groups: [],
    });
  });
  it("writes a fixed collector-failure marker after a write failure without logging or throwing", () => {
    const directory = temporary();
    const path = join(directory, DIAGNOSTICS_FILE);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => { throw new Error("synthetic-private-write-failure"); });
    expect(writeSwimRpcDiagnostics(directory, path, file([postgrest()]), [])).toBe(false);
    expect(readSwimRpcDiagnostics(directory, 0, ledger())).toEqual({
      status: "unavailable", reason: "collector-failure", invalidRecords: 0, groups: [],
    });
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
  it("makes unreadable sidecars explicit and withholds the filesystem exception", () => {
    const directory = temporary();
    const path = join(directory, DIAGNOSTICS_FILE);
    writeSwimRpcDiagnostics(directory, path, file([postgrest()]), []);
    vi.spyOn(fs, "readSync").mockImplementationOnce(() => { throw new Error("synthetic-private-read-failure"); });
    expect(readSwimRpcDiagnostics(directory, 0, ledger())).toEqual({
      status: "unavailable", reason: "sidecar-unavailable", invalidRecords: 0, groups: [],
    });
  });

  it.each([
    { unexpected: "synthetic-secret" }, { errorClass: "Hostile" }, { phase: "beforeAll" },
    { code: "42501\n" }, { category: "invented" }, { rpc: "swim_create_plan_extra" },
    { fingerprint: "a".repeat(64) + "\n" }, { hasCause: "yes" }, { identifiers: ["private_table"] },
    { domainMessageId: "Invalid swimming setup." }, { caseHash: "not-a-hash" },
  ])("rejects invalid record fields and counts them explicitly: %j", (change) => {
    const collection = collectSwimRpcDiagnostics(file([postgrest()]));
    const text = JSON.stringify(collection.status) + "\n" + JSON.stringify({ ...collection.records[0], ...change });
    expect(projectSwimRpcDiagnostics(text, ledger())).toMatchObject({
      status: "partial", reason: "invalid-records", invalidRecords: 1, groups: [],
    });
  });
  it("rejects malformed records, unknown status keys, inconsistent counts and invalid phase identities", () => {
    const collection = collectSwimRpcDiagnostics(file([postgrest()]));
    const header = JSON.stringify(collection.status);
    expect(projectSwimRpcDiagnostics(header + "\n{not-json", ledger()))
      .toMatchObject({ status: "partial", invalidRecords: 1, groups: [] });
    expect(projectSwimRpcDiagnostics(JSON.stringify({ ...collection.status, raw: "secret" }), ledger()))
      .toMatchObject({ status: "unavailable", reason: "sidecar-invalid", invalidRecords: 1 });
    expect(projectSwimRpcDiagnostics(header, ledger()).status).toBe("unavailable");
    const record = { ...collection.records[0], phase: "hook", caseHash: hash(caseName) };
    expect(projectSwimRpcDiagnostics(header + "\n" + JSON.stringify(record), ledger()))
      .toMatchObject({ status: "partial", invalidRecords: 1, groups: [] });
    expect(projectSwimRpcDiagnostics("not json", ledger())).toMatchObject({ status: "unavailable", invalidRecords: 1 });
  });

  it("writes only the exclusive 0600 regular sidecar and rejects external destinations", () => {
    const directory = temporary();
    const path = join(directory, DIAGNOSTICS_FILE);
    const started = Date.now() - 2000;
    expect(writeSwimRpcDiagnostics(directory, path, file([postgrest()]), [])).toBe(true);
    utimesSync(path, Date.now() / 1000 - 1, Date.now() / 1000 - 1);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    expect(readSwimRpcDiagnostics(directory, started, ledger()).status).toBe("complete");
    const before = readFileSync(path, "utf8");
    expect(writeSwimRpcDiagnostics(directory, path, [], [])).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(before);
    const external = join(temporary(), "external");
    expect(writeSwimRpcDiagnostics(directory, external, [], [])).toBe(false);
    expect(existsSync(external)).toBe(false);
    vi.stubEnv("HOME", join(directory, "home"));
    vi.stubEnv(DIAGNOSTICS_ENV, external);
    expect(() => new SwimRpcDiagnosticsReporter().onFinished([], [])).not.toThrow();
    expect(existsSync(external)).toBe(false);
  });
  it.each(["missing", "directory", "symlink", "stale", "future", "oversized", "empty", "malformed", "mode"])(
    "reports a %s sidecar explicitly without raw filesystem/parser text", (kind) => {
      const directory = temporary();
      const path = join(directory, DIAGNOSTICS_FILE);
      if (kind === "directory") mkdirSync(path);
      else if (kind === "symlink") symlinkSync(join(directory, "missing-private-target"), path);
      else if (kind !== "missing") {
        writeFileSync(path, serialized(file([postgrest()])), { mode: 0o600 });
        if (kind === "stale") utimesSync(path, 1, 1);
        if (kind === "future") utimesSync(path, Date.now() / 1000 + 60, Date.now() / 1000 + 60);
        if (kind === "oversized") truncateSync(path, DIAGNOSTICS_LIMITS.fileBytes + 1);
        if (kind === "empty") truncateSync(path, 0);
        if (kind === "malformed") writeFileSync(path, "synthetic-private-token");
        if (kind === "mode") chmodSync(path, 0o644);
      }
      const evidence = readSwimRpcDiagnostics(directory, Date.now() - 1000, ledger());
      expect(evidence.status).toBe("unavailable");
      expect(evidence.groups).toEqual([]);
      expect(formatAcceptanceSummary(evidence)).not.toMatch(/private|ENOENT|SyntaxError|\/tmp/);
      expect(() => new SwimRpcDiagnosticsReporter().onFinished([], [])).not.toThrow();
    },
  );
  it("does not follow a sidecar symlink or symlinked directory when writing", () => {
    const directory = temporary();
    const external = join(temporary(), "target");
    writeFileSync(external, "unchanged", { mode: 0o600 });
    symlinkSync(external, join(directory, DIAGNOSTICS_FILE));
    expect(writeSwimRpcDiagnostics(directory, join(directory, DIAGNOSTICS_FILE), [], [])).toBe(false);
    expect(readFileSync(external, "utf8")).toBe("unchanged");
    const link = join(temporary(), "link");
    symlinkSync(directory, link);
    expect(writeSwimRpcDiagnostics(link, join(link, DIAGNOSTICS_FILE), [], [])).toBe(false);
    expect(readSwimRpcDiagnostics(link, 0).status).toBe("unavailable");
  });
  it("rejects oversized records and sidecars with fixed evidence", () => {
    const header = '{"kind":"collector","status":"complete","reason":"collected","records":1}';
    expect(projectSwimRpcDiagnostics(header + "\n" + " ".repeat(DIAGNOSTICS_LIMITS.recordBytes + 1) + "{}", ledger()))
      .toMatchObject({ status: "partial", invalidRecords: 1 });
    expect(projectSwimRpcDiagnostics("a".repeat(DIAGNOSTICS_LIMITS.fileBytes + 1), ledger()))
      .toMatchObject({ status: "unavailable", reason: "sidecar-size" });
  });
  it.each([true, false])("diagnostic availability never changes canonical pass=%s or process failure", async (passed) => {
    for (const diagnostic of [
      projectSwimRpcDiagnostics(serialized(file([postgrest()])), ledger(passed)),
      readSwimRpcDiagnostics(temporary(), 0, ledger(passed)),
    ]) {
      for (const exit of [0, 1]) {
        const reporting = new AcceptanceReporting();
        const value = ledger(passed);
        const manifest: Record<string, unknown> = {};
        let cleaned = false;
        try {
          await reporting.stage("RPC ledger", async () => {
            manifest.ledger = value;
            manifest.rpcDiagnostics = diagnostic;
            requireAcceptance({ code: exit, signal: null, timedOut: false }, value, sha, configHash);
          }, () => {});
        } catch { /* Original acceptance failure is retained by the production reporter. */ }
        finally { cleaned = true; }
        expect(reporting.failures.primary !== null).toBe(!passed || exit !== 0);
        expect(manifest.ledger).toBe(value);
        expect(manifest.rpcDiagnostics).toBe(diagnostic);
        expect(cleaned).toBe(true);
      }
    }
  });
  it("wires the third reporter, runner-owned path and diagnostics finally before the unchanged gate", () => {
    const source = readFileSync(new URL("../../../../scripts/swim-acceptance.ts", import.meta.url), "utf8");
    expect(source).toContain('"--reporter=verbose", "--reporter=json", "--reporter=./scripts/swim-rpc-diagnostics.ts"');
    expect(source).toContain("env: { ...target.rpcEnv, [DIAGNOSTICS_ENV]: join(directory, DIAGNOSTICS_FILE) }");
    expect(source).toMatch(/manifest\.ledger = ledger;\s+} finally \{\s+manifest\.rpcDiagnostics = readSwimRpcDiagnostics\(directory, rpcStarted, ledger\);\s+}\s+requireAcceptance\(result, ledger, state\.sha, manifest\.configSha256 as string\)/);
    expect(source).toContain('method: path.includes("/_internal/") || path.includes("/rest-admin/") ? "HEAD" : "GET"');
    expect(source).toContain("try { await cleanup(); }");
  });

  it.each(["pass", "fail", "hook", "collection"])("uses actual Vitest onFinished for synthetic %s without changing exit/report", (kind) => {
    const directory = temporary();
    const root = join(directory, "fixture");
    mkdirSync(join(root, "src"), { recursive: true });
    const vitestDirectory = dirname(createRequire(import.meta.url).resolve("vitest/package.json"));
    const importPath = join(vitestDirectory, "dist/index.js");
    const body = kind === "collection" ? 'throw new SyntaxError("synthetic collection");' :
      `describe(${JSON.stringify(DIAGNOSTICS_SUITE)}, () => {
        ${kind === "hook" ? 'beforeAll(() => { throw new Error("synthetic hook"); });' : ""}
        it("synthetic case", () => {
          ${kind === "fail" ? 'throw new Error("swim_create_plan: synthetic failure", { cause: { name: "PostgrestError", code: "42501", message: "synthetic failure" } });' : 'expect(true).toBe(true);'}
        });
      });`;
    writeFileSync(join(root, "src/synthetic.test.ts"),
      `import { describe, it, expect, beforeAll } from ${JSON.stringify(importPath)};\n${body}`);
    const output = join(directory, "canonical.json");
    const reporter = fileURLToPath(new URL("../../../../scripts/swim-rpc-diagnostics.ts", import.meta.url));
    let exit = 0;
    try {
      execFileSync(process.execPath, [join(vitestDirectory, "vitest.mjs"), "run", "--config", RPC_CONFIG,
        "--root", root, "--reporter=verbose", "--reporter=json", `--reporter=${reporter}`, `--outputFile=${output}`], {
        cwd: resolve(dirname(RPC_CONFIG)), env: { ...process.env, HOME: join(directory, "home"),
          [DIAGNOSTICS_ENV]: join(directory, DIAGNOSTICS_FILE) },
        stdio: "pipe", timeout: 15_000,
      });
    } catch (error) {
      exit = (error as { status: number }).status;
    }
    expect(exit).toBe(kind === "pass" ? 0 : 1);
    const canonical = JSON.parse(readFileSync(output, "utf8"));
    expect(canonical.success).toBe(kind === "pass");
    expect(canonical.numTotalTests).toBe(kind === "collection" ? 0 : 1);
    const evidence = readSwimRpcDiagnostics(directory, 0, kind === "collection" ? undefined : ledger());
    expect(evidence.reason).toBe(kind === "collection" ? "canonical-cases-unavailable" : "collected");
    if (kind === "fail") {
      expect(evidence.groups[0]).toMatchObject({ code: "42501",
        associations: [{ case: caseName, phase: "test", rpc: "swim_create_plan", hasCause: true }] });
    }
    if (kind === "hook" || kind === "collection") {
      expect(evidence.groups.some((group) => group.associations.some((item) => item.phase === kind))).toBe(true);
    }
  });
});
