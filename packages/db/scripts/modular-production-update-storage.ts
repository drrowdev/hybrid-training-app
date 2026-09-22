import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type postgres from "postgres";
import { z } from "zod";
import { modularMigrationInventory, type ModularMigration } from "./modular-production-preflight-guards";
import { PRODUCTION_SWIM_BASELINE, productionHistoryFingerprint, productionHistoryRows } from "./swim-production-reconciliation";
import { requireInspection } from "./swim-production-readonly-guards";
import type { ProductionUpdateGuard, ProductionUpdateProgress } from "./swim-production-update-storage";

export const MODULAR_LEDGER_SQL = "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 512";
export const MODULAR_POLICY_SQL = `SELECT encode(sha256(convert_to(jsonb_build_array(
  (SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind='r'),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p),
  (SELECT jsonb_agg(jsonb_build_array(oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) ORDER BY oid) FROM pg_roles),
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member) FROM pg_auth_members m),
  (SELECT jsonb_agg(jsonb_build_array(k.oid,pg_get_constraintdef(k.oid)) ORDER BY k.oid)
   FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname IN ('public','auth') AND k.contype='f')
)::text,'UTF8')),'hex') AS fingerprint`;

export type ModularUpdateMigration = ModularMigration & { sql: string[]; bps: boolean };
export function modularUpdateMigrations(): ModularUpdateMigration[] {
  const journal = z.object({ entries: z.array(z.object({ idx: z.number().int(), tag: z.string() })).length(157) })
    .parse(JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")));
  const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  requireInspection(migrations.length === 157 && journal.entries.every((entry, index) => entry.idx === index), "migration_source");
  return migrations.map((entry, index) => ({ ...entry, tag: journal.entries[index]!.tag }));
}

export function modularUpdateInventory(raw: unknown, migrations: readonly ModularUpdateMigration[],
  baseline: { entries: number; fingerprint: string } = PRODUCTION_SWIM_BASELINE) {
  requireInspection(migrations.length === 157 && migrations[156]!.tag === "0156_modular_training_schedule" &&
    migrations[156]!.bps === false && migrations[156]!.sql.length === 1 &&
    createHash("sha256").update(migrations[156]!.sql[0]!).digest("hex") === migrations[156]!.hash, "migration_source");
  return modularMigrationInventory(raw, migrations.map(({ tag, hash, folderMillis }) => ({ tag, hash, folderMillis })), baseline);
}

export async function modularPolicyFingerprint(sql: postgres.Sql | postgres.TransactionSql) {
  const rows = await sql.unsafe(MODULAR_POLICY_SQL);
  requireInspection(rows.length === 1 && /^[a-f0-9]{64}$/.test(rows[0]!.fingerprint), "policy_catalog");
  return String(rows[0]!.fingerprint);
}

export async function appendModularProduction(sql: postgres.Sql, migrations: readonly ModularUpdateMigration[],
  guard: ProductionUpdateGuard, progress: ProductionUpdateProgress,
  baseline: { entries: number; fingerprint: string } = PRODUCTION_SWIM_BASELINE) {
  requireInspection(progress.attemptedMigrations === 0 && progress.stagedMigrations === 0 &&
    !progress.commitAttempted && !progress.commitConfirmed, "progress_state");
  const deadline = Date.now() + 120_000;
  const check = async (phase: Parameters<ProductionUpdateGuard>[0]) => {
    requireInspection(Date.now() < deadline, "deadline");
    await guard(phase);
    requireInspection(Date.now() < deadline, "deadline");
  };
  let retainedFingerprint = "";
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='90s'; SET LOCAL row_security=on");
    await tx.unsafe("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    const before = productionHistoryRows(Array.from(await tx.unsafe(MODULAR_LEDGER_SQL)));
    const inventory = modularUpdateInventory(before, migrations, baseline);
    requireInspection(before.length === 213 && inventory.pending.length === 1 &&
      inventory.pending[0]!.tag === "0156_modular_training_schedule", "modular_baseline");
    retainedFingerprint = productionHistoryFingerprint(before);
    const policies = await modularPolicyFingerprint(tx);
    await check("before");
    await check("migration");
    progress.attemptedMigrations = 1;
    const migration = migrations[156]!;
    await tx.unsafe(migration.sql[0]!);
    await tx.unsafe("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)", [migration.hash, migration.folderMillis]);
    progress.stagedMigrations = 1;
    const after = productionHistoryRows(Array.from(await tx.unsafe(MODULAR_LEDGER_SQL)));
    requireInspection(after.length === 214 && modularUpdateInventory(after, migrations, baseline).pending.length === 0 &&
      productionHistoryFingerprint(after.slice(0, 213)) === retainedFingerprint, "modular_retention");
    requireInspection(await modularPolicyFingerprint(tx) === policies, "policy_changed");
    await tx.unsafe("SET CONSTRAINTS ALL IMMEDIATE");
    await check("before_commit");
    progress.commitAttempted = true;
  });
  progress.commitConfirmed = true;
  await check("after_commit");
  const after = productionHistoryRows(Array.from(await sql.unsafe(MODULAR_LEDGER_SQL)));
  requireInspection(after.length === 214 && modularUpdateInventory(after, migrations, baseline).pending.length === 0 &&
    productionHistoryFingerprint(after.slice(0, 213)) === retainedFingerprint, "modular_retention");
  return { entries: 214, retainedEntries: 213, appendedEntries: 1, fingerprint: productionHistoryFingerprint(after) };
}
