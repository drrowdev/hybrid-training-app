import {
  chmodSync, closeSync, fstatSync, fsyncSync, linkSync, mkdirSync, mkdtempSync,
  readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it, vi } from "vitest";
import {
  appendMigrationShutdown, MIGRATION_DIAGNOSTIC_FIELDS, MIGRATION_EVIDENCE_FILE,
  MIGRATION_EVIDENCE_MAX_BYTES, openMigrationEvidence, parseMigrationScid,
  projectMigrationError, readMigrationEvidence, type MigrationTerminal,
} from "../migrate-evidence";
import {
  loadMigrationDependencies, MIGRATION_SHUTDOWN_MS, runMigrationWithEvidence,
  verifyMigrationDependencyParity, type MigrationEntryRuntime,
} from "../migrate-with-evidence";

vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, closeSync: vi.fn(actual.closeSync), fsyncSync: vi.fn(actual.fsyncSync) };
});

async function fixture(action: (path: string, directory: string) => void | Promise<void>) {
  const parent = mkdtempSync(join(tmpdir(), "migration-fixture-"));
  const directory = join(parent, "swim-acceptance-pr802-123-1");
  // The production directory already exists and is owned by the acceptance runner.
  mkdirSync(directory, { mode: 0o700 });
  try { await action(join(directory, MIGRATION_EVIDENCE_FILE), directory); }
  finally { rmSync(parent, { recursive: true, force: true }); }
}
const terminal: MigrationTerminal = {
  event: "terminal", status: "success", phase: "migrate", error: null, position: { status: "unmatched" },
};
const scid = "SCID/1/acl/pre/shared/ftftfttu";
const native = () => Reflect.construct(postgres.PostgresError, [
  { message: scid, code: "P0001", severity: "ERROR" },
]) as postgres.PostgresError;

describe("structured migration evidence (DC-SW8; no database)", () => {
  it("owns the same strict bare SCID codebook", () => {
    for (const guard of Object.keys(MIGRATION_DIAGNOSTIC_FIELDS) as (keyof typeof MIGRATION_DIAGNOSTIC_FIELDS)[]) {
      const object = guard === "roles" ? "roles" : guard === "acl" ? "helper" : "both";
      const message = `SCID/1/${guard}/pre/${object}/${"t".repeat(MIGRATION_DIAGNOSTIC_FIELDS[guard].length)}`;
      expect(parseMigrationScid(message)?.guard).toBe(guard);
      expect(parseMigrationScid(message + "t")).toBeUndefined();
      expect(parseMigrationScid("error: " + message)).toBeUndefined();
    }
    expect(parseMigrationScid("SCID/1/roles/post/roles/tttttt")).toBeUndefined();
  });

  const config = {
    dialect: "postgresql", out: "./drizzle", schema: "./src/schema/*.ts", strict: true, verbose: true,
    dbCredentials: { url: "postgres://fixture.invalid/not-used" },
  };
  function runtime() {
    const end = vi.fn(async () => {});
    const migrate = vi.fn(async () => {});
    const createClient = vi.fn(() => ({ end }));
    const readMigrations = vi.fn(() => [{ sql: ["canonical"] }]);
    const loadConfig = vi.fn(async () => config);
    const loadDependencies = vi.fn(async () => ({ createClient, migrate, readMigrations }));
    return { end, migrate, createClient, readMigrations, loadConfig, loadDependencies };
  }

  describe("migration entry (DC-SW8; fixture clients only)", () => {
    it("verifies installed CLI-context pg absence, driver and exact dependency parity without connecting", async () => {
      expect(verifyMigrationDependencyParity()).toEqual({
        driver: "postgres", kit: "0.30.6", orm: "0.44.7", postgres: "3.4.9", pgAbsent: true,
      });
      const dependencies = await loadMigrationDependencies();
      const client = dependencies.createClient(config as Parameters<typeof dependencies.createClient>[0]) as postgres.Sql;
      try {
        expect(client.options.max).toBe(1);
        for (const type of [1184, 1082, 1083, 1114]) {
          expect(client.options.parsers[type]!("unchanged")).toBe("unchanged");
          expect(client.options.serializers[type]!("unchanged")).toBe("unchanged");
        }
        for (const type of [114, 3802]) expect(client.options.serializers[type]!("unchanged")).toBe("unchanged");
      } finally { await client.end({ timeout: 0 }); }
    });

    it("invokes one migration with default ledger config and durably closes before shutdown", () => fixture(async (path) => {
      const fake = runtime();
      fake.end.mockImplementation(async () => {
        const fd = vi.mocked(fsyncSync).mock.calls.at(-1)![0];
        expect(() => fstatSync(fd)).toThrow();
        expect(vi.mocked(closeSync).mock.invocationCallOrder.at(-1))
          .toBeGreaterThan(vi.mocked(fsyncSync).mock.invocationCallOrder.at(-1)!);
        expect(readMigrationEvidence(path)).toMatchObject({ status: "complete", terminal: { status: "success" }, shutdown: null });
      });
      const result = await runMigrationWithEvidence(path, fake);
      expect(result).toEqual({ exitCode: 0, failed: false, terminalRecorded: true, secondary: [] });
      expect(fake.loadConfig).toHaveBeenCalledTimes(1);
      expect(fake.loadDependencies).toHaveBeenCalledTimes(1);
      expect(fake.createClient).toHaveBeenCalledTimes(1);
      expect(fake.migrate).toHaveBeenCalledTimes(1);
      expect(fake.migrate).toHaveBeenCalledWith({ end: fake.end }, { migrationsFolder: "./drizzle" });
      expect(fake.end).toHaveBeenCalledTimes(1);
      expect(fake.end).toHaveBeenCalledWith({ timeout: 5 });
      expect(fake.readMigrations).not.toHaveBeenCalled();
    }));

    it.each(["config", "dependencies", "client", "migrate"] as const)(
      "captures actual structured %s failures and preserves the primary exception", (phase) => fixture(async (path) => {
        const fake = runtime();
        const error = phase === "migrate" ? new DrizzleQueryError("canonical", ["private"], native()) : new Error("private-phase-data");
        if (phase === "config") fake.loadConfig.mockRejectedValue(error);
        if (phase === "dependencies") fake.loadDependencies.mockRejectedValue(error);
        if (phase === "client") fake.createClient.mockImplementation(() => { throw error; });
        if (phase === "migrate") fake.migrate.mockRejectedValue(error);
        const result = await runMigrationWithEvidence(path, fake);
        expect(result.failure).toBe(error);
        expect(result.exitCode).toBe(1);
        expect(result.terminalRecorded).toBe(true);
        expect(fake.migrate).toHaveBeenCalledTimes(phase === "migrate" ? 1 : 0);
        expect(fake.end).toHaveBeenCalledTimes(phase === "migrate" ? 1 : 0);
        const evidence = readMigrationEvidence(path);
        expect(evidence).toMatchObject({ status: "complete", terminal: { status: "failure", phase, error: { projection: "complete" } } });
        expect(JSON.stringify(evidence)).not.toMatch(/canonical|private/);
      }),
    );

    it("starts before config loading and rejects changed config before creating a client", () => fixture(async (path) => {
      const fake = runtime();
      fake.loadConfig.mockImplementation(async () => {
        expect(readFileSync(path, "utf8")).toBe('{"event":"started","version":1}\n');
        return { ...config, out: "./other" };
      });
      expect((await runMigrationWithEvidence(path, fake)).exitCode).toBe(1);
      expect(fake.createClient).not.toHaveBeenCalled();
      expect(readMigrationEvidence(path)).toMatchObject({ status: "complete", terminal: { phase: "config" } });
    }));

    it.each(["", "relative", "/tmp/arbitrary.json"])("rejects %s before any config or migration", async (path) => {
      const fake = runtime();
      await expect(runMigrationWithEvidence(path, fake)).rejects.toThrow();
      expect(fake.loadConfig).not.toHaveBeenCalled();
      expect(fake.loadDependencies).not.toHaveBeenCalled();
    });

    it.each(["begin", "file", "connection"])("keeps a plain %s failure complete with unknown position", (kind) => fixture(async (path) => {
      const fake = runtime();
      fake.migrate.mockRejectedValue(new Error(kind));
      const result = await runMigrationWithEvidence(path, fake);
      expect(result.exitCode).toBe(1);
      expect(readMigrationEvidence(path)).toMatchObject({
        status: "complete", terminal: { phase: "migrate", error: { sqlstate: null, projection: "complete" }, position: { status: "unmatched" } },
      });
    }));

    it("keeps migration failure primary when end rejects", () => fixture(async (path) => {
      const fake = runtime();
      const primary = native();
      fake.migrate.mockRejectedValue(primary);
      fake.end.mockRejectedValue(new Error("private-end"));
      const result = await runMigrationWithEvidence(path, fake);
      expect(result.failure).toBe(primary);
      expect(result.secondary).toEqual(["shutdown-failed"]);
      expect(readMigrationEvidence(path)).toMatchObject({
        status: "complete", terminal: { error: { sqlstate: "P0001" } },
        shutdown: { status: "failed", error: { projection: "complete", sqlstate: null } },
      });
    }));

    it("bounds a hung end after the original failure is already durable", () => fixture(async (path) => {
      vi.useFakeTimers();
      try {
        const fake = runtime();
        const primary = native();
        fake.migrate.mockRejectedValue(primary);
        fake.end.mockImplementation(() => new Promise(() => {}));
        const pending = runMigrationWithEvidence(path, fake);
        await vi.advanceTimersByTimeAsync(0);
        expect(readMigrationEvidence(path)).toMatchObject({ status: "complete", terminal: { error: { sqlstate: "P0001" } }, shutdown: null });
        await vi.advanceTimersByTimeAsync(MIGRATION_SHUTDOWN_MS);
        const result = await pending;
        expect(result.failure).toBe(primary);
        expect(result.secondary).toEqual(["shutdown-timed-out"]);
        expect(readMigrationEvidence(path)).toMatchObject({ status: "complete", shutdown: { status: "timed-out" } });
      } finally { vi.useRealTimers(); }
    }));

    it("retains the durable terminal if later evidence cannot be appended", () => fixture(async (path, directory) => {
      const fake = runtime();
      const primary = native();
      fake.migrate.mockRejectedValue(primary);
      let original = "";
      fake.end.mockImplementation(async () => {
        original = readFileSync(path, "utf8");
        linkSync(path, join(directory, "hardlink"));
      });
      const result = await runMigrationWithEvidence(path, fake);
      expect(result.failure).toBe(primary);
      expect(result.secondary).toEqual(["collector-failed"]);
      expect(readFileSync(path, "utf8")).toBe(original);
      rmSync(join(directory, "hardlink"));
      expect(readMigrationEvidence(path)).toMatchObject({ status: "complete", terminal: { error: { sqlstate: "P0001" } }, shutdown: null });
    }));

    it("attempts shutdown even when terminal recording fails, without replacing the primary", () => fixture(async (path) => {
      const fake = runtime();
      const primary = native();
      fake.migrate.mockImplementation(async () => {
        chmodSync(path, 0o400);
        throw primary;
      });
      const result = await runMigrationWithEvidence(path, fake);
      expect(result.failure).toBe(primary);
      expect(result.terminalRecorded).toBe(false);
      expect(result.secondary).toEqual(["collector-failed"]);
      expect(fake.end).toHaveBeenCalledOnce();
    }));

    it("importing the entry has no normalizer, config or environment side effects", () => {
      const source = readFileSync(new URL("../migrate-with-evidence.ts", import.meta.url), "utf8");
      expect(source).not.toMatch(/import[^;\n]*normalize-migrations/);
      expect(source).toContain('loadConfig: async () => (await import("../drizzle.config")).default');
      expect(source.indexOf("openMigrationEvidence(path)")).toBeLessThan(source.indexOf("await runtime.loadConfig()"));
      const fake: MigrationEntryRuntime = runtime();
      expect(fake.loadConfig).not.toHaveBeenCalled();
    });
  });

  it("projects actual native and Drizzle errors without accessing private fields", () => {
    const cause = native();
    Object.defineProperty(cause, "query", { value: "canonical" });
    const error = new DrizzleQueryError("canonical", ["private-param"], cause);
    for (const key of ["params", "detail", "stack", "where", "role", "uuid", "claims", "env"]) {
      Object.defineProperty(error, key, { get() { throw new Error("Private field read"); } });
    }
    const value = projectMigrationError(error, () => [{ sql: ["other", "canonical"] }]);
    expect(value.error).toMatchObject({ sqlstate: "P0001", severity: "ERROR", scid: parseMigrationScid(scid), projection: "complete" });
    expect(value.position).toEqual({ status: "matched", migrationIndex: 0, statementIndex: 1 });
    expect(JSON.stringify(value)).not.toMatch(/canonical|private-param|stack|claims|uuid/);
    expect(projectMigrationError({ name: "PostgresError", code: "P0001", severity: "ERROR", message: scid }).error.sqlstate).toBeNull();
  });

  it("keeps ordinary errors complete and uses closed driver codes", () => {
    expect(projectMigrationError(new Error("private")).error).toMatchObject({ classification: "Error", projection: "complete", sqlstate: null });
    expect(projectMigrationError(Object.assign(new Error("private"), { code: "ECONNREFUSED" })).error.driverCode).toBe("ECONNREFUSED");
    expect(projectMigrationError(Object.assign(new Error("private"), { code: "private" })).error.driverCode).toBeNull();
  });

  it("rejects getters, proxies, cycles, deep chains and ambiguous causes", () => {
    for (const key of ["name", "code", "severity", "cause", "query"]) {
      const error = Object.defineProperty(new Error(), key, { get() { throw new Error("Getter called"); } });
      expect(projectMigrationError(error).error.projection).toBe("rejected");
    }
    expect(projectMigrationError(Object.defineProperty(native(), "message", { get() { throw new Error(); } })).error.projection).toBe("rejected");
    const cyclic = Object.assign(new Error(), { cause: {} });
    cyclic.cause = cyclic;
    let deep: Error = new Error();
    for (let i = 0; i < 9; i++) deep = new Error("", { cause: deep });
    for (const value of [cyclic, deep, new Proxy({}, {}), Object.assign(native(), { cause: native() })]) {
      expect(projectMigrationError(value).error.projection).toBe("rejected");
    }
  });

  it("leaves duplicate, absent, oversized or failed attribution unmatched and complete", () => {
    const error = new DrizzleQueryError("same", [], native());
    for (const canonical of [
      () => [{ sql: ["same", "same"] }], () => [{ sql: ["other"] }],
      () => [{ sql: ["same"] }, { sql: ["same"] }], () => { throw new Error("private file"); },
    ]) {
      expect(projectMigrationError(error, canonical)).toMatchObject({ error: { projection: "complete" }, position: { status: "unmatched" } });
    }
  });

  it("writes one exclusive private bounded file and requires a durable terminal", () => fixture((path) => {
    const writer = openMigrationEvidence(path);
    expect(readMigrationEvidence(path)).toEqual({ status: "incomplete" });
    expect(() => openMigrationEvidence(path)).toThrow();
    writer.terminal(terminal);
    expect(readMigrationEvidence(path, writer.identity)).toEqual({ status: "complete", terminal, shutdown: null });
    appendMigrationShutdown(path, writer.identity, { event: "shutdown", status: "closed", error: null });
    expect(readMigrationEvidence(path)).toMatchObject({ status: "complete", shutdown: { status: "closed" } });
    expect(() => appendMigrationShutdown(path, writer.identity, { event: "shutdown", status: "closed", error: null })).toThrow();
    expect(() => writer.terminal(terminal)).toThrow();
  }));

  it("rejects invalid paths and modes before creation", () => fixture((path, directory) => {
    for (const invalid of ["", MIGRATION_EVIDENCE_FILE, join(directory, "arbitrary.json"), path + "/../other"]) {
      expect(() => openMigrationEvidence(invalid)).toThrow();
    }
    chmodSync(directory, 0o755);
    expect(() => openMigrationEvidence(path)).toThrow();
  }));

  it("rejects symlinks, hardlinks, replacement identity and changed modes", () => fixture((path, directory) => {
    const writer = openMigrationEvidence(path);
    writer.terminal(terminal);
    const other = join(directory, "other");
    linkSync(path, other);
    expect(readMigrationEvidence(path)).toEqual({ status: "incomplete" });
    rmSync(other);
    chmodSync(path, 0o644);
    expect(readMigrationEvidence(path)).toEqual({ status: "incomplete" });
    chmodSync(path, 0o600);
    renameSync(path, other);
    symlinkSync(other, path);
    expect(readMigrationEvidence(path)).toEqual({ status: "incomplete" });
    expect(() => appendMigrationShutdown(path, writer.identity, { event: "shutdown", status: "closed", error: null })).toThrow();
    rmSync(path);
    writeFileSync(path, readFileSync(other), { mode: 0o600 });
    expect(readMigrationEvidence(path, writer.identity)).toEqual({ status: "incomplete" });
    expect(() => appendMigrationShutdown(path, writer.identity, { event: "shutdown", status: "closed", error: null })).toThrow();
    expect(readMigrationEvidence(other)).toEqual({ status: "incomplete" });
  }));

  it("rejects missing, oversized, malformed, extra or invalid records", () => fixture((path) => {
    expect(readMigrationEvidence(path)).toEqual({ status: "incomplete" });
    const writer = openMigrationEvidence(path);
    writer.terminal(terminal);
    const valid = readFileSync(path, "utf8");
    for (const text of ["", "{", "x".repeat(MIGRATION_EVIDENCE_MAX_BYTES + 1), valid + "{}\n",
      valid.replace('"version":1', '"version":2'), valid.replace('"phase":"migrate"', '"phase":"private"'),
      valid.replace('"error":null', '"error":null,"raw":"private"'), valid.slice(0, -1)]) {
      writeFileSync(path, text);
      expect(readMigrationEvidence(path)).toEqual({ status: "incomplete" });
    }
  }));
});
