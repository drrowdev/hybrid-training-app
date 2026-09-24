import { readFileSync } from "node:fs";
import { Socket } from "node:net";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modularRehearsalMigrations, rehearseModularProductionUpdate, modularUpdateStageReporter,
  MODULAR_UPDATE_REHEARSAL_STAGES, projectModularUpdateSubstep } from "../../integration-tests/modular-production-update-rehearsal";
import { modularUpdateMigrations, MODULAR_UPDATE_SUBSTEPS, type ModularUpdateSubstep } from "../modular-production-update-storage";

function source() {
  const journal: {
    version: string; dialect: string;
    entries: { idx: number; version: string; tag: string; when: number; breakpoints: boolean }[];
  } = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  return { journal, migrations: readMigrationFiles({ migrationsFolder: "./drizzle" }) };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("DC-SW8 exact modular updater rehearsal stays separate from production", () => {
  it("validates the complete159 source without truncating to the obsolete157 prefix", () => {
    const { journal, migrations } = source(), before = structuredClone(migrations);
    const prefix = modularRehearsalMigrations(journal, migrations);
    expect(prefix).toHaveLength(159);
    expect(prefix.map(({ tag: _tag, ...entry }) => entry)).toEqual(before);
    expect(prefix.map(({ tag }) => tag)).toEqual(journal.entries.map(({ tag }) => tag));
    expect(migrations).toEqual(before);
  });

  it("shares the exact159 loader with production and rejects the obsolete0156-only batch", () => {
    const { journal, migrations } = source();
    expect(modularUpdateMigrations()).toEqual(modularRehearsalMigrations(journal, migrations));
    expect(() => modularRehearsalMigrations({ ...journal, entries: journal.entries.slice(0, 157) }, migrations.slice(0, 157)))
      .toThrow("migration_source");
  });

  it("exposes every successful rehearsal stage to the existing storage summary", () => {
    expect(MODULAR_UPDATE_REHEARSAL_STAGES).toHaveLength(14);
    expect(new Set(MODULAR_UPDATE_REHEARSAL_STAGES).size).toBe(14);
    expect(MODULAR_UPDATE_REHEARSAL_STAGES[0]).toBe("modular-production-update-159-guard");
    expect(MODULAR_UPDATE_REHEARSAL_STAGES[1]).toBe("modular-production-update-function-metadata");
    expect(MODULAR_UPDATE_REHEARSAL_STAGES[3]).toBe("modular-production-update-owned-reference-preflight");
    expect(MODULAR_UPDATE_REHEARSAL_STAGES.at(-1)).toBe("modular-production-update-fixture-restored");
    const runner = readFileSync(new URL("../../integration-tests/swim-pool-storage.mts", import.meta.url), "utf8");
    expect(runner).toContain("await rehearseModularProductionUpdate(database, (name) => { stage = name; }, (name) => { stages.push(name); },");
    expect(runner).toContain("(name) => { currentModularUpdateSubstep = name; });");
    expect(runner).not.toContain("stages.push(...await rehearseModularProductionUpdate(");
  });

  it("publishes completed stages before later failure, without publishing the failing stage or duplicates", () => {
    const started: string[] = [], passed: string[] = [];
    let substep: ModularUpdateSubstep | undefined = "added_security";
    const reporter = modularUpdateStageReporter((name) => started.push(name), (name) => passed.push(name), (name) => { substep = name; });
    reporter.mark(0);
    reporter.pass(0);
    expect(substep).toBeUndefined();
    expect(() => reporter.pass(0)).toThrow();
    reporter.mark(1);
    substep = "isolation";
    expect(() => reporter.pass(2)).toThrow();
    expect(substep).toBe("isolation");
    expect(passed).toEqual([MODULAR_UPDATE_REHEARSAL_STAGES[0]]);
    expect(started).toEqual(MODULAR_UPDATE_REHEARSAL_STAGES.slice(0, 2));
  });

  it("exposes exactly the approved eight substeps", () => {
    expect(MODULAR_UPDATE_SUBSTEPS).toEqual([
      "apply", "added_security", "post_apply_catalog", "ledger_reconciliation",
      "graph_hash", "graph_state", "isolation", "cleanup",
    ]);
  });

  it.each(MODULAR_UPDATE_SUBSTEPS)("projects %s only within an updater rehearsal stage", (substep) => {
    expect(projectModularUpdateSubstep("modular-production-update-213-to-216", substep)).toBe(substep);
    expect(projectModularUpdateSubstep("independent-programs-rehearsal", substep)).toBeUndefined();
    expect(projectModularUpdateSubstep("modular-production-update-unapproved", substep)).toBeUndefined();
  });

  it.each([undefined, null, "", "PrivateSyntheticCanary", { value: "apply" }])("omits unclassified substeps", (value) => {
    expect(projectModularUpdateSubstep("modular-production-update-213-to-216", value)).toBeUndefined();
  });

  it.each(["missing-entry", "future-entry", "missing-source", "future-source", "index", "tag-prefix",
    "modular-tag", "outcome-tag", "ownership-tag", "journal-time", "source-time", "breakpoint", "hash", "sql", "duplicate-hash"] as const)(
    "refuses %s instead of truncating an unvalidated source",
    (mode) => {
      const { journal, migrations } = source();
      if (mode === "missing-entry") journal.entries.pop();
      if (mode === "future-entry") journal.entries.push({ ...journal.entries[158]!, idx: 159, tag: "0159_unapproved" });
      if (mode === "missing-source") migrations.pop();
      if (mode === "future-source") migrations.push(structuredClone(migrations[157]!));
      if (mode === "index") journal.entries[5]!.idx = 6;
      if (mode === "tag-prefix") journal.entries[5]!.tag = "0006_wrong";
      if (mode === "modular-tag") journal.entries[156]!.tag = "0156_unexpected";
      if (mode === "outcome-tag") journal.entries[157]!.tag = "0157_unexpected";
      if (mode === "ownership-tag") journal.entries[158]!.tag = "0158_unexpected";
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
    "refuses %s before database access or source use",
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
        await expect(rehearseModularProductionUpdate(sql, vi.fn(), vi.fn())).rejects.toMatchObject({ code: "ERR_ASSERTION" });
        expect(connect).not.toHaveBeenCalled();
      } finally { await sql.end(); }
    },
  );
});
