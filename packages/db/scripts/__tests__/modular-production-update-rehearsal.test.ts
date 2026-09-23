import { readFileSync } from "node:fs";
import { Socket } from "node:net";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modularRehearsalMigrations, rehearseModularProductionUpdate } from "../../integration-tests/modular-production-update-rehearsal";
import { modularUpdateMigrations } from "../modular-production-update-storage";

function source() {
  const journal: {
    version: string; dialect: string;
    entries: { idx: number; version: string; tag: string; when: number; breakpoints: boolean }[];
  } = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  return { journal, migrations: readMigrationFiles({ migrationsFolder: "./drizzle" }) };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("DC-SW8 historical modular updater rehearsal stays separate from production", () => {
  it("validates the complete158 source before returning the unchanged157 prefix", () => {
    const { journal, migrations } = source(), before = structuredClone(migrations);
    const prefix = modularRehearsalMigrations(journal, migrations);
    expect(prefix).toHaveLength(157);
    expect(prefix.map(({ tag: _tag, ...entry }) => entry)).toEqual(before.slice(0, 157));
    expect(prefix.map(({ tag }) => tag)).toEqual(journal.entries.slice(0, 157).map(({ tag }) => tag));
    expect(migrations).toEqual(before);
  });

  it("keeps the actual production loader closed on the current158 journal", () => {
    expect.assertions(2);
    try { modularUpdateMigrations(); }
    catch (error) {
      expect(error).toBeInstanceOf(z.ZodError);
      expect((error as z.ZodError).issues).toContainEqual(expect.objectContaining({
        code: "too_big", maximum: 157, path: ["entries"],
      }));
    }
  });

  it.each(["missing-entry", "future-entry", "missing-source", "future-source", "index", "tag-prefix",
    "modular-tag", "outcome-tag", "journal-time", "source-time", "breakpoint", "hash", "sql", "duplicate-hash"] as const)(
    "refuses %s instead of truncating an unvalidated source",
    (mode) => {
      const { journal, migrations } = source();
      if (mode === "missing-entry") journal.entries.pop();
      if (mode === "future-entry") journal.entries.push({ ...journal.entries[157]!, idx: 158, tag: "0158_unapproved" });
      if (mode === "missing-source") migrations.pop();
      if (mode === "future-source") migrations.push(structuredClone(migrations[157]!));
      if (mode === "index") journal.entries[5]!.idx = 6;
      if (mode === "tag-prefix") journal.entries[5]!.tag = "0006_wrong";
      if (mode === "modular-tag") journal.entries[156]!.tag = "0156_unexpected";
      if (mode === "outcome-tag") journal.entries[157]!.tag = "0157_unexpected";
      if (mode === "journal-time") journal.entries[157]!.when++;
      if (mode === "source-time") migrations[156]!.folderMillis++;
      if (mode === "breakpoint") journal.entries[156]!.breakpoints = true;
      if (mode === "hash") migrations[156]!.hash = "f".repeat(64);
      if (mode === "sql") migrations[156]!.sql[0] += "\nSELECT 1;";
      if (mode === "duplicate-hash") migrations[157]!.hash = migrations[156]!.hash;
      expect(() => modularRehearsalMigrations(journal, migrations)).toThrow();
    },
  );

  it.each(["local", "job", "url-host", "url-database", "client-host", "client-database"] as const)(
    "refuses %s before database access or historical source use",
    async (mode) => {
      vi.stubEnv("GITHUB_ACTIONS", mode === "local" ? "false" : "true");
      vi.stubEnv("GITHUB_JOB", mode === "job" ? "storage" : "pool-storage");
      vi.stubEnv("SWIM_POOL_TEST_DATABASE_URL",
        `postgres://postgres@${mode === "url-host" ? "example.invalid" : "127.0.0.1"}:5432/${mode === "url-database" ? "postgres" : "swim_pool_test"}`);
      const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => {
        throw new Error("Unexpected database connection");
      });
      const sql = postgres({
        host: mode === "client-host" ? "example.invalid" : "127.0.0.1",
        port: 5432, database: mode === "client-database" ? "postgres" : "swim_pool_test", username: "postgres",
      });
      try {
        await expect(rehearseModularProductionUpdate(sql, vi.fn())).rejects.toMatchObject({ code: "ERR_ASSERTION" });
        expect(connect).not.toHaveBeenCalled();
      } finally { await sql.end(); }
    },
  );
});
