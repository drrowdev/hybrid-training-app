import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import type postgres from "postgres";
import { z } from "zod";
import {
  appendModularProduction, modularUpdateMigrations, modularUpdateInventory, MODULAR_LEDGER_SQL,
} from "../scripts/modular-production-update-storage";
import { productionHistoryFingerprint, productionHistoryRows } from "../scripts/swim-production-reconciliation";
import type { ProductionUpdateProgress } from "../scripts/swim-production-update-storage";

export function modularRehearsalMigrations(rawJournal: unknown, source: readonly MigrationMeta[]) {
  const journal = z.object({
    version: z.literal("7"), dialect: z.literal("postgresql"),
    entries: z.array(z.object({
      idx: z.number().int().nonnegative(), version: z.literal("7"),
      tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
      when: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), breakpoints: z.boolean(),
    }).strict()).length(159),
  }).strict().parse(rawJournal);
  assert.equal(source.length, 159);
  assert.equal(new Set(source.map(({ hash }) => hash)).size, 159);
  journal.entries.forEach((entry, index) => {
    const migration = source[index]!;
    assert.equal(entry.idx, index);
    assert.equal(Number(entry.tag.slice(0, 4)), index);
    assert.equal(entry.when, migration.folderMillis);
    assert.equal(entry.breakpoints, migration.bps);
    assert.ok(index === 0 || entry.when > journal.entries[index - 1]!.when);
    assert.ok(migration.sql.length > 0);
    assert.equal(createHash("sha256").update(migration.sql.join("--> statement-breakpoint")).digest("hex"), migration.hash);
  });
  assert.equal(journal.entries[156]!.tag, "0156_modular_training_schedule");
  assert.equal(journal.entries[157]!.tag, "0157_standalone_swim_import_outcomes");
  assert.equal(journal.entries[158]!.tag, "0158_independent_program_ownership");
  for (const index of [156, 157, 158]) {
    assert.equal(source[index]!.bps, false);
    assert.equal(source[index]!.sql.length, 1);
  }
  return source.slice(0, 157).map((entry, index) => ({ ...entry, tag: journal.entries[index]!.tag }));
}

export async function rehearseModularProductionUpdate(database: postgres.Sql, stage: (name: string) => void) {
  stage("modular-production-update-rehearsal-guard");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_JOB, "pool-storage");
  const url = new URL(process.env.SWIM_POOL_TEST_DATABASE_URL!);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.username, "postgres");
  assert.equal(url.password + url.search + url.hash, "");
  assert.equal(url.pathname, "/swim_pool_test");
  assert.deepEqual(database.options.host, ["127.0.0.1"]);
  assert.equal(database.options.database, "swim_pool_test");
  const migrations = modularRehearsalMigrations(
    JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")),
    readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) }),
  );
  assert.throws(modularUpdateMigrations, (error: unknown) => error instanceof z.ZodError &&
    error.issues.some((issue) => issue.code === "too_big" && issue.maximum === 157 &&
      issue.path.length === 1 && issue.path[0] === "entries"));
  const original = productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL)));
  const catalog = async () => {
    const rows = await database.unsafe(`SELECT encode(sha256(convert_to(jsonb_build_array(
      (SELECT string_agg(pg_get_functiondef(p.oid)||p.proowner::text||COALESCE(p.proacl::text,''),E'\\n' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'),
      (SELECT jsonb_agg(jsonb_build_array(c.oid::regclass::text,k.conname,pg_get_constraintdef(k.oid,false),k.convalidated,k.connoinherit)
        ORDER BY c.oid::regclass::text,k.conname)
       FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND k.contype='c')
    )::text,'UTF8')),'hex') AS fingerprint`);
    return rows[0]!.fingerprint;
  };
  const originalCatalog = await catalog();
  const connection = await database.reserve();
  try { await connection.unsafe(readFileSync(new URL("../rollbacks/0156_modular_training_schedule.down.sql", import.meta.url), "utf8")); }
  catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
  finally { connection.release(); }
  const beforeCatalog = await catalog();
  assert.notEqual(beforeCatalog, originalCatalog);
  const progress = (): ProductionUpdateProgress => ({
    attemptedMigrations: 0, stagedMigrations: 0, commitAttempted: false, commitConfirmed: false,
  });
  const committed = progress();
  try {
    stage("modular-production-update-synthetic-history");
    // Only this loopback disposable fixture replaces its ledger; its sequence is never reset.
    await database.unsafe("DELETE FROM drizzle.__drizzle_migrations");
    for (let index = 0; index < 203; index += 1) {
      const migration = migrations[index % 146]!;
      const hash = index < 146 ? migration.hash : createHash("sha256").update(`synthetic-modular-history-${index}`).digest("hex");
      await database`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES (${hash},${migration.folderMillis})`;
    }
    const baseline = { entries: 203, fingerprint: productionHistoryFingerprint(Array.from(await database.unsafe(MODULAR_LEDGER_SQL))) };
    for (const migration of migrations.slice(146, 156)) {
      await database`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES (${migration.hash},${migration.folderMillis})`;
    }
    const initial = productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL)));
    assert.equal(initial.length, 213);
    const unchanged = async () => {
      assert.deepEqual(productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL))), initial);
      assert.equal(await catalog(), beforeCatalog);
    };
    stage("modular-production-update-baseline-refusal");
    const refused = progress();
    await assert.rejects(appendModularProduction(database, migrations, async () => {}, refused,
      { entries: 203, fingerprint: "f".repeat(64) }), /legacy_history_changed/);
    assert.equal(refused.attemptedMigrations, 0);
    await unchanged();

    stage("modular-production-update-precommit-rollback");
    const rollback = progress();
    await assert.rejects(appendModularProduction(database, migrations, async (phase) => {
      if (phase === "before_commit") throw new Error("synthetic_modular_precommit");
    }, rollback, baseline), /synthetic_modular_precommit/);
    assert.equal(rollback.stagedMigrations, 1);
    assert.equal(rollback.commitAttempted, false);
    await unchanged();

    stage("modular-production-update-commit-retention-and-replay");
    await assert.rejects(appendModularProduction(database, migrations, async (phase) => {
      if (phase === "after_commit") throw new Error("synthetic_modular_postcommit");
    }, committed, baseline), /synthetic_modular_postcommit/);
    assert.equal(committed.commitConfirmed, true);
    const after = productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL)));
    assert.deepEqual(after.slice(0, 213), initial);
    assert.equal(after.length, 214);
    assert.equal(modularUpdateInventory(after, migrations, baseline).pending.length, 0);
    const replay = progress();
    await assert.rejects(appendModularProduction(database, migrations, async () => {}, replay, baseline), /modular_baseline/);
    assert.equal(replay.attemptedMigrations, 0);
  } finally {
    if (!committed.commitConfirmed) await database.unsafe(migrations[156]!.sql[0]!);
    await database.unsafe("DELETE FROM drizzle.__drizzle_migrations");
    for (const row of original) await database.unsafe(
      "INSERT INTO drizzle.__drizzle_migrations(id,hash,created_at) VALUES ($1,$2,$3)", [row.id, row.hash, row.created_at]);
  }
  assert.deepEqual(productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL))), original);
  assert.equal(await catalog(), originalCatalog);
  stage("modular-production-update-rehearsal-restored");
}
