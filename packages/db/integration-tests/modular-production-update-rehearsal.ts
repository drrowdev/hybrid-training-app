import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type postgres from "postgres";
import {
  appendModularProduction, modularUpdateMigrations, modularUpdateInventory, MODULAR_LEDGER_SQL, validateModularUpdateMigrations,
} from "../scripts/modular-production-update-storage";
import { productionHistoryFingerprint, productionHistoryRows } from "../scripts/swim-production-reconciliation";
import type { ProductionUpdateProgress } from "../scripts/swim-production-update-storage";
import { modularCatalog } from "../scripts/modular-production-catalog";

export const modularRehearsalMigrations = validateModularUpdateMigrations;
export const MODULAR_UPDATE_REHEARSAL_STAGES = [
  "modular-production-update-159-guard",
  "modular-production-update-213-baseline",
  "modular-production-update-legacy-fingerprint-refusal",
  "modular-production-update-full-fingerprint-refusal",
  "modular-production-update-partial-ledger-refusal",
  "modular-production-update-mid-batch-rollback",
  "modular-production-update-precommit-rollback",
  "modular-production-update-role-drift-rollback",
  "modular-production-update-213-to-216",
  "modular-production-update-replay-refusal",
  "modular-production-update-postcommit-reconciliation",
  "modular-production-update-fixture-restored",
] as const;

export async function rehearseModularProductionUpdate(database: postgres.Sql, stage: (name: string) => void) {
  const stages: string[] = [];
  const mark = (index: number) => { const name = MODULAR_UPDATE_REHEARSAL_STAGES[index]!; stage(name); };
  const pass = (index: number) => { stages.push(MODULAR_UPDATE_REHEARSAL_STAGES[index]!); };
  mark(0);
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
  assert.deepEqual(database.options.port, [5432]);
  assert.equal(process.platform, "linux");
  assert.equal((await database`SELECT current_database() AS name`)[0]!.name, "swim_pool_test");
  const migrations = modularRehearsalMigrations(
    JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")),
    readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) }),
  );
  assert.deepEqual(migrations, modularUpdateMigrations());
  pass(0);
  const original = productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL)));
  const authAndRoles = async () => (await modularCatalog(database)).filter((row) => row.key === "global" || row.key.includes(":auth."));
  const originalAuthAndRoles = await authAndRoles();
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
  const down = async (index: number) => {
    const connection = await database.reserve();
    try { await connection.unsafe(readFileSync(new URL(`../rollbacks/${migrations[index]!.tag}.down.sql`, import.meta.url), "utf8")); }
    catch (error) { await connection.unsafe("ROLLBACK"); throw error; }
    finally { connection.release(); }
  };
  await down(156);
  const beforeCatalog = await catalog();
  assert.notEqual(beforeCatalog, originalCatalog);
  const progress = (): ProductionUpdateProgress => ({
    attemptedMigrations: 0, stagedMigrations: 0, commitAttempted: false, commitConfirmed: false,
  });
  let installed = false;
  try {
    mark(1);
    // Only this loopback disposable fixture replaces its ledger; its sequence is never reset.
    await database.unsafe("DELETE FROM drizzle.__drizzle_migrations");
    for (let index = 0; index < 203; index += 1) {
      const migration = migrations[index % 146]!;
      const hash = index < 146 ? migration.hash : createHash("sha256").update(`synthetic-modular-history-${index}`).digest("hex");
      await database`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES (${hash},${migration.folderMillis})`;
    }
    const baseline = { entries: 203, fingerprint: productionHistoryFingerprint(Array.from(await database.unsafe(MODULAR_LEDGER_SQL))),
      fullFingerprint: "" };
    for (const migration of migrations.slice(146, 156)) {
      await database`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES (${migration.hash},${migration.folderMillis})`;
    }
    const initial = productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL)));
    assert.equal(initial.length, 213);
    baseline.fullFingerprint = productionHistoryFingerprint(initial);
    assert.equal(modularUpdateInventory(initial, migrations, baseline).pending.length, 3);
    pass(1);
    const unchanged = async () => {
      assert.deepEqual(productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL))), initial);
      assert.equal(await catalog(), beforeCatalog);
    };
    mark(2);
    const refused = progress();
    await assert.rejects(appendModularProduction(database, migrations, async () => {}, refused,
      { ...baseline, fingerprint: "f".repeat(64) }), /legacy_history_changed/);
    assert.equal(refused.attemptedMigrations, 0);
    await unchanged();
    pass(2);

    mark(3);
    const fullRefused = progress();
    await assert.rejects(appendModularProduction(database, migrations, async () => {}, fullRefused,
      { ...baseline, fullFingerprint: "f".repeat(64) }), /modular_baseline/);
    assert.equal(fullRefused.attemptedMigrations, 0);
    await unchanged();
    pass(3);

    mark(4);
    const next = migrations[156]!;
    const inserted = await database`INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
      VALUES (${next.hash},${next.folderMillis}) RETURNING id`;
    try {
      const partial = progress();
      await assert.rejects(appendModularProduction(database, migrations, async () => {}, partial, baseline), /modular_baseline/);
      assert.equal(partial.attemptedMigrations, 0);
    } finally { await database`DELETE FROM drizzle.__drizzle_migrations WHERE id=${inserted[0]!.id}`; }
    await unchanged();
    pass(4);

    mark(5);
    const midBatch = progress();
    let attempts = 0;
    await assert.rejects(appendModularProduction(database, migrations, async (phase) => {
      if (phase === "migration" && ++attempts === 2) throw new Error("synthetic_modular_mid_batch");
    }, midBatch, baseline), /synthetic_modular_mid_batch/);
    assert.equal(midBatch.stagedMigrations, 1);
    assert.equal(midBatch.commitAttempted, false);
    await unchanged();
    pass(5);

    mark(6);
    const rollback = progress();
    await assert.rejects(appendModularProduction(database, migrations, async (phase) => {
      if (phase === "before_commit") throw new Error("synthetic_modular_precommit");
    }, rollback, baseline), /synthetic_modular_precommit/);
    assert.equal(rollback.stagedMigrations, 3);
    assert.equal(rollback.commitAttempted, false);
    await unchanged();
    pass(6);

    mark(7);
    const [role] = await database`SELECT rolinherit FROM pg_roles WHERE rolname='authenticated'`;
    assert.equal(typeof role?.rolinherit, "boolean");
    const drift = progress();
    try {
      await assert.rejects(appendModularProduction(database, migrations, async (phase) => {
        if (phase === "before_commit") await database.unsafe(role!.rolinherit
          ? "ALTER ROLE authenticated NOINHERIT" : "ALTER ROLE authenticated INHERIT");
      }, drift, baseline), /catalog_existing_changed/);
      assert.equal(drift.stagedMigrations, 3);
      assert.equal(drift.commitAttempted, false);
    } finally {
      await database.unsafe(role!.rolinherit ? "ALTER ROLE authenticated INHERIT" : "ALTER ROLE authenticated NOINHERIT");
    }
    assert.equal((await database`SELECT rolinherit FROM pg_roles WHERE rolname='authenticated'`)[0]!.rolinherit, role!.rolinherit);
    await unchanged();
    pass(7);

    mark(8);
    const committed = progress();
    try {
      const result = await appendModularProduction(database, migrations, async () => {}, committed, baseline);
      assert.deepEqual({ entries: result.entries, retainedEntries: result.retainedEntries, appendedEntries: result.appendedEntries },
        { entries: 216, retainedEntries: 213, appendedEntries: 3 });
    } finally { installed = committed.commitConfirmed; }
    assert.equal(installed, true);
    const after = productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL)));
    assert.deepEqual(after.slice(0, 213), initial);
    assert.equal(after.length, 216);
    assert.equal(modularUpdateInventory(after, migrations, baseline).pending.length, 0);
    pass(8);
    mark(9);
    const replay = progress();
    await assert.rejects(appendModularProduction(database, migrations, async () => {}, replay, baseline), /modular_baseline/);
    assert.equal(replay.attemptedMigrations, 0);
    pass(9);

    mark(10);
    await down(158); await down(157); await down(156); installed = false;
    await database`DELETE FROM drizzle.__drizzle_migrations WHERE id>${initial.at(-1)!.id}`;
    await unchanged();
    const ambiguous = progress();
    try {
      await assert.rejects(appendModularProduction(database, migrations, async (phase) => {
        if (phase === "after_commit") throw new Error("synthetic_modular_postcommit");
      }, ambiguous, baseline), /synthetic_modular_postcommit/);
    } finally { installed = ambiguous.commitConfirmed; }
    assert.equal(ambiguous.commitConfirmed, true);
    assert.equal(ambiguous.stagedMigrations, 3);
    const retained = productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL)));
    assert.deepEqual(retained.slice(0, 213), initial);
    assert.equal(modularUpdateInventory(retained, migrations, baseline).pending.length, 0);
    pass(10);
  } finally {
    if (installed) { await down(158); await down(157); }
    else await database.unsafe(migrations[156]!.sql[0]!);
    await database.unsafe("DELETE FROM drizzle.__drizzle_migrations");
    for (const row of original) await database.unsafe(
      "INSERT INTO drizzle.__drizzle_migrations(id,hash,created_at) VALUES ($1,$2,$3)", [row.id, row.hash, row.created_at]);
  }
  mark(11);
  assert.deepEqual(productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL))), original);
  assert.equal(await catalog(), originalCatalog);
  assert.deepEqual(await authAndRoles(), originalAuthAndRoles);
  pass(11);
  return stages;
}
