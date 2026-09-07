import {
  chmodSync, linkSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import {
  appendMigrationShutdown, MIGRATION_DIAGNOSTIC_FIELDS, MIGRATION_EVIDENCE_FILE,
  MIGRATION_EVIDENCE_MAX_BYTES, openMigrationEvidence, parseMigrationScid,
  projectMigrationError, readMigrationEvidence, type MigrationTerminal,
} from "../migrate-evidence";

function fixture(action: (path: string, directory: string) => void | Promise<void>) {
  const parent = mkdtempSync(join(tmpdir(), "migration-fixture-"));
  const directory = join(parent, "swim-acceptance-pr802-123-1");
  // The production directory already exists and is owned by the acceptance runner.
  return import("node:fs").then(async ({ mkdirSync }) => {
    mkdirSync(directory, { mode: 0o700 });
    try { await action(join(directory, MIGRATION_EVIDENCE_FILE), directory); }
    finally { rmSync(parent, { recursive: true, force: true }); }
  });
}
const terminal: MigrationTerminal = {
  event: "terminal", status: "success", phase: "migrate", error: null, position: { status: "unmatched" },
};
const scid = "SCID/1/acl/pre/shared/ftftfttu";
const native = () => new postgres.PostgresError({ message: scid, code: "P0001", severity: "ERROR" });

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

  it("projects actual native and Drizzle errors without accessing private fields", () => {
    const cause = native();
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
