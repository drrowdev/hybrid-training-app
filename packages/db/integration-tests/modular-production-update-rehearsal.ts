import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type postgres from "postgres";
import {
  appendModularProduction, modularUpdateMigrations, modularUpdateInventory, MODULAR_LEDGER_SQL, validateModularUpdateMigrations,
  MODULAR_UPDATE_SUBSTEPS, type ModularUpdateObserver,
} from "../scripts/modular-production-update-storage";
import { productionHistoryFingerprint, productionHistoryRows } from "../scripts/swim-production-reconciliation";
import type { ProductionUpdateProgress } from "../scripts/swim-production-update-storage";
import { modularCatalog } from "../scripts/modular-production-catalog";
import { createModularHistoricalGraph } from "./modular-production-legacy-graph";

export const modularRehearsalMigrations = validateModularUpdateMigrations;
export const MODULAR_UPDATE_REHEARSAL_STAGES = [
  "modular-production-update-159-guard",
  "modular-production-update-function-metadata",
  "modular-production-update-213-baseline",
  "modular-production-update-owned-reference-preflight",
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

export function projectModularUpdateSubstep(stage: string, value: unknown) {
  if (!MODULAR_UPDATE_REHEARSAL_STAGES.some((name) => name === stage)) return;
  return MODULAR_UPDATE_SUBSTEPS.find((name) => name === value);
}

export function modularUpdateStageReporter(stage: (name: string) => void, passed: (name: string) => void,
  substep: ModularUpdateObserver = () => {}) {
  let active: string | undefined;
  return {
    mark(index: number) {
      assert.equal(active, undefined);
      active = MODULAR_UPDATE_REHEARSAL_STAGES[index];
      assert.ok(active);
      stage(active);
    },
    pass(index: number) {
      assert.ok(active);
      assert.equal(active, MODULAR_UPDATE_REHEARSAL_STAGES[index]);
      passed(active);
      substep(undefined);
      active = undefined;
    },
  };
}

export async function rehearseModularProductionUpdate(database: postgres.Sql, stage: (name: string) => void,
  passed: (name: string) => void, substep: ModularUpdateObserver = () => {}) {
  const { mark, pass } = modularUpdateStageReporter(stage, passed, substep);
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
  mark(1);
  await database.begin(async (tx) => {
    const name = "public.modular_catalog_default_probe(integer)";
    assert.equal((await tx`SELECT to_regprocedure(${name}) AS existing`)[0]!.existing, null);
    await tx.unsafe(`CREATE FUNCTION public.modular_catalog_default_probe(p_count integer DEFAULT 42)
      RETURNS integer LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT p_count $$`);
    const metadata = async () => {
      const [raw] = await tx`SELECT proargdefaults::text AS defaults,pg_get_functiondef(oid) AS definition
        FROM pg_proc WHERE oid=${name}::regprocedure`;
      const row = (await modularCatalog(tx)).find((item) => item.key === "function:public.modular_catalog_default_probe");
      assert.ok(row?.security);
      assert.ok(typeof raw?.definition === "string" && typeof raw.defaults === "string");
      return { definition: raw.definition, defaults: raw.defaults, security: row.security };
    };
    const original = await metadata();
    await tx.unsafe(original.definition);
    const rebuilt = await metadata();
    assert.notEqual(rebuilt.defaults, original.defaults);
    assert.equal(rebuilt.security, original.security);
    assert.ok(original.definition.includes("DEFAULT 42"));
    await tx.unsafe(original.definition.replace("DEFAULT 42", "DEFAULT 43"));
    assert.notEqual((await metadata()).security, original.security);
    await tx.unsafe(original.definition);
    await tx.unsafe("ALTER FUNCTION public.modular_catalog_default_probe(integer) SECURITY DEFINER");
    assert.notEqual((await metadata()).security, original.security);
    await tx.unsafe(original.definition);
    await tx.unsafe("REVOKE EXECUTE ON FUNCTION public.modular_catalog_default_probe(integer) FROM anon");
    assert.notEqual((await metadata()).security, original.security);
    await tx.unsafe("DROP FUNCTION public.modular_catalog_default_probe(integer)");
  });
  pass(1);
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
  let fixture = createModularHistoricalGraph(database);
  try {
    mark(2);
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
    await fixture.prepare();
    pass(2);
    const unchanged = async () => {
      assert.deepEqual(productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL))), initial);
      assert.equal(await catalog(), beforeCatalog);
      await fixture.unchanged();
    };
    mark(3);
    await fixture.verifyReferencePreflight();
    pass(3);
    mark(4);
    const refused = progress();
    await assert.rejects(appendModularProduction(database, migrations, async () => {}, refused,
      { ...baseline, fingerprint: "f".repeat(64) }), /legacy_history_changed/);
    assert.equal(refused.attemptedMigrations, 0);
    await unchanged();
    pass(4);

    mark(5);
    const fullRefused = progress();
    await assert.rejects(appendModularProduction(database, migrations, async () => {}, fullRefused,
      { ...baseline, fullFingerprint: "f".repeat(64) }), /modular_baseline/);
    assert.equal(fullRefused.attemptedMigrations, 0);
    await unchanged();
    pass(5);

    mark(6);
    const next = migrations[156]!;
    const inserted = await database`INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
      VALUES (${next.hash},${next.folderMillis}) RETURNING id`;
    try {
      const partial = progress();
      await assert.rejects(appendModularProduction(database, migrations, async () => {}, partial, baseline), /modular_baseline/);
      assert.equal(partial.attemptedMigrations, 0);
    } finally { await database`DELETE FROM drizzle.__drizzle_migrations WHERE id=${inserted[0]!.id}`; }
    await unchanged();
    pass(6);

    mark(7);
    const midBatch = progress();
    let attempts = 0;
    await assert.rejects(appendModularProduction(database, migrations, async (phase) => {
      if (phase === "migration" && ++attempts === 2) throw new Error("synthetic_modular_mid_batch");
    }, midBatch, baseline), /synthetic_modular_mid_batch/);
    assert.equal(midBatch.stagedMigrations, 1);
    assert.equal(midBatch.commitAttempted, false);
    await unchanged();
    pass(7);

    mark(8);
    const rollback = progress();
    await assert.rejects(appendModularProduction(database, migrations, async (phase) => {
      if (phase === "before_commit") throw new Error("synthetic_modular_precommit");
    }, rollback, baseline), /synthetic_modular_precommit/);
    assert.equal(rollback.stagedMigrations, 3);
    assert.equal(rollback.commitAttempted, false);
    await unchanged();
    pass(8);

    mark(9);
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
    pass(9);

    mark(10);
    const committed = progress();
    try {
      const result = await appendModularProduction(database, migrations, async () => {}, committed, baseline, substep);
      substep("ledger_reconciliation");
      assert.deepEqual({ entries: result.entries, retainedEntries: result.retainedEntries, appendedEntries: result.appendedEntries },
        { entries: 216, retainedEntries: 213, appendedEntries: 3 });
    } finally { installed = committed.commitConfirmed; }
    assert.equal(installed, true);
    const after = productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL)));
    assert.deepEqual(after.slice(0, 213), initial);
    assert.equal(after.length, 216);
    assert.equal(modularUpdateInventory(after, migrations, baseline).pending.length, 0);
    await fixture.verifyUpgrade(substep);
    pass(10);
    mark(11);
    const replay = progress();
    await assert.rejects(appendModularProduction(database, migrations, async () => {}, replay, baseline), /modular_baseline/);
    assert.equal(replay.attemptedMigrations, 0);
    pass(11);

    mark(12);
    // The unchanged 0156 down guard refuses any authored history, even legacy.
    substep("cleanup");
    await fixture.cleanup();
    await down(158); await down(157); await down(156); installed = false;
    substep("ledger_reconciliation");
    await database`DELETE FROM drizzle.__drizzle_migrations WHERE id>${initial.at(-1)!.id}`;
    fixture = createModularHistoricalGraph(database);
    substep("graph_state");
    await fixture.prepare();
    substep("graph_hash");
    await unchanged();
    const ambiguous = progress();
    try {
      await assert.rejects(appendModularProduction(database, migrations, async (phase) => {
        if (phase === "after_commit") throw new Error("synthetic_modular_postcommit");
      }, ambiguous, baseline, substep), /synthetic_modular_postcommit/);
    } finally { installed = ambiguous.commitConfirmed; }
    substep("ledger_reconciliation");
    assert.equal(ambiguous.commitConfirmed, true);
    assert.equal(ambiguous.stagedMigrations, 3);
    const retained = productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL)));
    assert.deepEqual(retained.slice(0, 213), initial);
    assert.equal(modularUpdateInventory(retained, migrations, baseline).pending.length, 0);
    await fixture.verifyUpgrade(substep);
    pass(12);
  } finally {
    try {
      try {
        if (installed) { await down(158); await down(157); }
        else await database.unsafe(migrations[156]!.sql[0]!);
        await database.unsafe("DELETE FROM drizzle.__drizzle_migrations");
        for (const row of original) await database.unsafe(
          "INSERT INTO drizzle.__drizzle_migrations(id,hash,created_at) VALUES ($1,$2,$3)", [row.id, row.hash, row.created_at]);
      } finally { await fixture.cleanup(); }
    } catch (error) { substep("cleanup"); throw error; }
  }
  mark(13);
  substep("cleanup");
  assert.deepEqual(productionHistoryRows(Array.from(await database.unsafe(MODULAR_LEDGER_SQL))), original);
  assert.equal(await catalog(), originalCatalog);
  assert.deepEqual(await authAndRoles(), originalAuthAndRoles);
  pass(13);
}
