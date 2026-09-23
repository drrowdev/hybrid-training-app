import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { PgDialect } from "drizzle-orm/pg-core";
import { PostgresJsSession } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { migrateCanonical, migrationFileBoundaries } from "../migration-runner";
import { projectMigrationError } from "../migrate-evidence";
import { rehearseMigrationRunner } from "../../integration-tests/migration-runner-rehearsal";

describe("canonical migration file boundaries", () => {
  it("preserves all159 canonical metadata and statement bytes without changing source", () => {
    const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
    const original = structuredClone(migrations);
    const bounded = migrationFileBoundaries(migrations);
    expect(bounded).toHaveLength(159);
    bounded.forEach((migration, index) => {
      const source = original[index]!;
      expect(migration).toEqual({ ...source,
        sql: ["SET LOCAL search_path = public", ...source.sql, "SET LOCAL search_path = public"] });
      expect(migration).not.toBe(migrations[index]);
    });
    expect(migrations).toEqual(original);
    expect(readMigrationFiles({ migrationsFolder: "./drizzle" })).toEqual(original);
    expect(migrations[2]!.sql.join("\n")).toContain('CREATE TYPE "public"."muscle"');
  });

  it("retains canonical error positions and leaves added boundary failures unmatched", () => {
    const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
    const canonicalFailure = new DrizzleQueryError(migrations[155]!.sql[0]!, [], new Error("synthetic"));
    expect(projectMigrationError(canonicalFailure, () => migrations).position)
      .toEqual({ status: "matched", migrationIndex: 155, statementIndex: 0 });
    const boundaryFailure = new DrizzleQueryError("SET LOCAL search_path = public", [], new Error("synthetic"));
    expect(projectMigrationError(boundaryFailure, () => migrations).position).toEqual({ status: "unmatched" });
  });
  it("delegates the complete batch and unchanged ledger configuration to Drizzle once", async () => {
    const client = postgres("postgres://fixture.invalid/not-used", { max: 1 });
    const migrate = vi.spyOn(PgDialect.prototype, "migrate").mockResolvedValue();
    const migrations: MigrationMeta[] = [{ sql: ["SELECT 1"], hash: "canonical-hash", folderMillis: 123, bps: false }];
    const config = { migrationsFolder: "./drizzle" };
    try {
      await migrateCanonical(client, migrations, config);
      expect(migrate).toHaveBeenCalledOnce();
      const [batch, session, passedConfig] = migrate.mock.calls[0]!;
      expect(batch).toEqual(migrationFileBoundaries(migrations));
      expect(session).toBeInstanceOf(PostgresJsSession);
      expect(passedConfig).toBe(config);
    } finally {
      migrate.mockRestore();
      await client.end({ timeout: 0 });
    }
  });

  it("preserves the original migration failure instead of retrying or returning success", async () => {
    const client = postgres("postgres://fixture.invalid/not-used", { max: 1 });
    const failure = new Error("synthetic");
    const migrate = vi.spyOn(PgDialect.prototype, "migrate").mockRejectedValue(failure);
    try {
      await expect(migrateCanonical(client, [], { migrationsFolder: "./drizzle" })).rejects.toBe(failure);
      expect(migrate).toHaveBeenCalledOnce();
    } finally {
      migrate.mockRestore();
      await client.end({ timeout: 0 });
    }
  });

  it("refuses the SQL rehearsal outside its GitHub job before contacting a database", async () => {
    const client = postgres("postgres://fixture.invalid/not-used", { max: 1 });
    vi.stubEnv("GITHUB_ACTIONS", "false");
    try {
      await expect(rehearseMigrationRunner(client, vi.fn())).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
      await client.end({ timeout: 0 });
    }
  });
});
