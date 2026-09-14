import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { z } from "zod";
import { untimedReviewMigrations } from "./untimed-swim-review-storage";
import { isReviewOwnerPredicate, verifyUpgradedReviewStorage } from "./upgrade-swim-review-storage";
import { requireInspection } from "./swim-production-readonly-guards";
import {
  productionHistoryRows, productionHistoryFingerprint, productionSchemaInventory,
  SCHEMA_TABLE_SQL, SCHEMA_FUNCTION_SQL, SCHEMA_SHARED_SQL, SWIM_SCHEMA_TABLES, SWIM_SCHEMA_FUNCTIONS,
  PRODUCTION_SWIM_BASELINE,
} from "./swim-production-reconciliation";
import { POST_UPDATE_CATALOG_SQL, productionCompletionCatalog } from "./swim-production-post-update";

export { PRODUCTION_SWIM_BASELINE } from "./swim-production-reconciliation";
export const PRODUCTION_SWIM_TAGS = [
  "0146_standalone_pool_swimming", "0147_swim_request_identity", "0148_shared_completion_identity",
  "0149_defer_custom_movement_references", "0150_swim_import_storage", "0151_swim_pool_changes",
  "0152_swim_private_courses", "0153_swim_import_matching", "0154_swim_untimed_courses",
] as const;
export const PRODUCTION_UPDATE_LEDGER_QUERY =
  "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 213";
export type ProductionSwimmingMigration = ReturnType<typeof untimedReviewMigrations>[number];
export type ProductionSwimmingBaseline = { entries: 203; fingerprint: string };
export type ProductionUpdateProgress = {
  attemptedMigrations: number; stagedMigrations: number; commitAttempted: boolean; commitConfirmed: boolean;
};
export type ProductionUpdateGuard = (phase: "before" | "migration" | "before_commit" | "after_commit") => Promise<void>;
export type CompletionAclProgress = { attempted: boolean; staged: boolean; verified: boolean };

export function productionCompletionAclState(raw: unknown): "canonical" | "equivalent" {
  const row = productionCompletionCatalog(raw);
  requireInspection(row.shared_present && row.writer_present && row.swim_objects && row.swim_routines &&
    row.shared_attributes?.every((value) => value === true) && row.shared_acl_options === true &&
    row.shared_privileges?.every((value) => value === true) &&
    row.other_default_grants === 0 && row.default_grant_options === 0 &&
    [0, 1].includes(row.shared_acl_counts[3]!) &&
    row.shared_acl_counts.every((value, index) => value === [1, 1, 1, row.shared_acl_counts[3], 1, 1, 0][index]),
  "completion_acl_state");
  return row.shared_acl_counts[3] === 1 ? "canonical" : "equivalent";
}

async function prepareCompletionAcl(tx: postgres.TransactionSql, progress: CompletionAclProgress) {
  const state = productionCompletionAclState(Array.from(await tx.unsafe(POST_UPDATE_CATALOG_SQL)));
  if (state === "canonical") return;
  const actor = await tx.unsafe("SELECT current_user='postgres' AS expected_actor");
  requireInspection(actor.length === 1 && actor[0]!.expected_actor === true, "completion_acl_actor");
  // PUBLIC already supplies this access. The unchanged 0148 revokes both entries in this transaction.
  progress.attempted = true;
  await tx.unsafe("GRANT EXECUTE ON FUNCTION public.complete_training_session_with_transition(uuid,text,uuid) TO anon");
  progress.staged = true;
  requireInspection(productionCompletionAclState(Array.from(await tx.unsafe(POST_UPDATE_CATALOG_SQL))) === "canonical",
    "completion_acl_state");
  progress.verified = true;
}

export function productionSwimmingMigrations() {
  const migrations = untimedReviewMigrations();
  const journal = z.object({ entries: z.array(z.object({
    tag: z.string(), breakpoints: z.boolean(),
  })).length(155) }).parse(JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")));
  requireInspection(PRODUCTION_SWIM_TAGS.every((tag, index) =>
    journal.entries[146 + index]!.tag === tag && !journal.entries[146 + index]!.breakpoints), "migration_source");
  validateProductionMigrationSource(migrations);
  return migrations;
}

export function validateProductionMigrationSource(migrations: readonly ProductionSwimmingMigration[]) {
  requireInspection(migrations.length === 155 && new Set(migrations.map((entry) => entry.hash)).size === 155 &&
    migrations.every((entry, index) => /^[a-f0-9]{64}$/.test(entry.hash) &&
      Number.isSafeInteger(entry.folderMillis) && entry.folderMillis > 0 &&
      (index === 0 || entry.folderMillis > migrations[index - 1]!.folderMillis)) &&
    migrations.slice(146).every((entry) => entry.sql.length === 1 && entry.bps === false &&
      createHash("sha256").update(entry.sql[0]!).digest("hex") === entry.hash), "migration_source");
}

export function validateProductionSwimBaseline(raw: unknown, migrations: readonly ProductionSwimmingMigration[],
  baseline: ProductionSwimmingBaseline = PRODUCTION_SWIM_BASELINE) {
  validateProductionMigrationSource(migrations);
  const entries = productionHistoryRows(raw);
  requireInspection(baseline.entries === 203 && /^[a-f0-9]{64}$/.test(baseline.fingerprint) &&
    entries.length === baseline.entries && productionHistoryFingerprint(entries) === baseline.fingerprint, "baseline_fingerprint");
  requireInspection(entries.every((entry, index) => Number.isSafeInteger(entry.id) &&
    (index === 0 || entry.id > entries[index - 1]!.id)), "baseline_ids");
  const hashes = new Set(entries.map((entry) => entry.hash));
  requireInspection(migrations.slice(0, 146).every((entry) => hashes.has(entry.hash)) &&
    migrations.slice(146).every((entry) => !hashes.has(entry.hash)), "baseline_membership");
  const stamps = entries.map((entry) => {
    requireInspection(typeof entry.created_at === "string" && /^\d{1,16}$/.test(entry.created_at) ||
      typeof entry.created_at === "number" && Number.isSafeInteger(entry.created_at) && entry.created_at >= 0, "baseline_timestamp");
    return BigInt(entry.created_at);
  });
  const latest = stamps.reduce((max, value) => value > max ? value : max, 0n);
  requireInspection(migrations.slice(0, 146).every((entry) => BigInt(entry.folderMillis) <= latest) &&
    migrations.slice(146).every((entry) => BigInt(entry.folderMillis) > latest), "baseline_timestamp");
  return entries;
}

export function validateProductionSwimAppend(raw: unknown, migrations: readonly ProductionSwimmingMigration[],
  baseline: ProductionSwimmingBaseline = PRODUCTION_SWIM_BASELINE) {
  const entries = productionHistoryRows(raw);
  requireInspection(entries.length === baseline.entries + 9, "append_count");
  const before = validateProductionSwimBaseline(entries.slice(0, baseline.entries), migrations, baseline);
  requireInspection(entries.slice(baseline.entries).every((entry, index) =>
    entry.hash === migrations[146 + index]!.hash &&
    String(entry.created_at) === String(migrations[146 + index]!.folderMillis) &&
    entry.id > (index === 0 ? before[before.length - 1]!.id : entries[baseline.entries + index - 1]!.id)), "append_mismatch");
  return { entries: 212, retainedEntries: 203, appendedEntries: 9 };
}

export async function verifyProductionSwimBefore(tx: postgres.TransactionSql) {
  const schema = productionSchemaInventory(
    Array.from(await tx.unsafe(SCHEMA_TABLE_SQL, [[...SWIM_SCHEMA_TABLES]])),
    Array.from(await tx.unsafe(SCHEMA_FUNCTION_SQL, [[...SWIM_SCHEMA_FUNCTIONS]])),
    Array.from(await tx.unsafe(SCHEMA_SHARED_SQL)));
  const unexpected = await tx.unsafe(`SELECT
    EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'swim_writer') AS writer,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND (left(c.relname,5)='swim_' OR c.relname='sessions_user_id_id_key')) AS objects,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND left(p.proname,5)='swim_') AS routines`);
  requireInspection(unexpected.length === 1 && ["writer", "objects", "routines"].every((key) => unexpected[0]![key] === false) &&
    schema.tables.every((entry) => !entry.present) && schema.functions.every((entry) => entry.definitions === 0) &&
    !schema.shared.swim_result && schema.shared.completion_body === "before" &&
    schema.shared.movement_keys?.length === 2 && new Set(schema.shared.movement_keys.map((entry) => entry.name)).size === 2 &&
    schema.shared.movement_keys.every((entry) => entry.validated && !entry.deferrable && !entry.deferred && entry.deleteAction === "r"),
  "schema_preconditions");
}

export async function verifyProductionSwimAfter(tx: postgres.TransactionSql) {
  await verifyUpgradedReviewStorage(tx);
  const policies = await tx.unsafe(`SELECT c.relname, c.relrowsecurity,
    pg_catalog.pg_get_expr(p.polqual,p.polrelid) AS predicate,
    pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid) AS check_predicate
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_policy p ON p.polrelid=c.oid
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [[...SWIM_SCHEMA_TABLES]]);
  requireInspection(policies.length === 5 && new Set(policies.map((entry) => entry.relname)).size === 5 &&
    policies.every((entry) => entry.relrowsecurity === true && isReviewOwnerPredicate(entry.predicate) &&
      isReviewOwnerPredicate(entry.check_predicate)), "owner_policies");
  const roles = await tx.unsafe("SELECT rolinherit FROM pg_catalog.pg_roles WHERE rolname='swim_writer'");
  requireInspection(roles.length === 1 && roles[0]!.rolinherit === false, "writer_role");
  await tx.unsafe("SET LOCAL ROLE authenticated");
  const ready = await tx.unsafe("SELECT public.swim_untimed_course_ready() AS ready");
  requireInspection(ready.length === 1 && ready[0]!.ready === true, "capabilities");
  await tx.unsafe("RESET ROLE");
}

export async function appendProductionSwimming(sql: postgres.Sql, migrations: readonly ProductionSwimmingMigration[],
  guard: ProductionUpdateGuard, progress: ProductionUpdateProgress,
  baseline: ProductionSwimmingBaseline = PRODUCTION_SWIM_BASELINE,
  completionAcl: CompletionAclProgress = { attempted: false, staged: false, verified: false }) {
  validateProductionMigrationSource(migrations);
  requireInspection(progress.attemptedMigrations === 0 && progress.stagedMigrations === 0 &&
    !progress.commitAttempted && !progress.commitConfirmed &&
    !completionAcl.attempted && !completionAcl.staged && !completionAcl.verified, "progress_state");
  const deadline = Date.now() + 120_000;
  const check = async (phase: Parameters<ProductionUpdateGuard>[0]) => {
    requireInspection(Date.now() < deadline, "deadline"); await guard(phase);
    requireInspection(Date.now() < deadline, "deadline");
  };
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='90s'; SET LOCAL row_security=on");
    await tx.unsafe("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    validateProductionSwimBaseline(Array.from(await tx.unsafe(PRODUCTION_UPDATE_LEDGER_QUERY)), migrations, baseline);
    await verifyProductionSwimBefore(tx);
    await check("before");
    for (const [index, migration] of migrations.slice(146).entries()) {
      await check("migration");
      progress.attemptedMigrations += 1;
      if (index === 2) await prepareCompletionAcl(tx, completionAcl);
      await tx.unsafe(migration.sql[0]!);
      await tx.unsafe("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)", [migration.hash, migration.folderMillis]);
      progress.stagedMigrations += 1;
    }
    validateProductionSwimAppend(Array.from(await tx.unsafe(PRODUCTION_UPDATE_LEDGER_QUERY)), migrations, baseline);
    await verifyProductionSwimAfter(tx);
    await tx.unsafe("SET CONSTRAINTS ALL IMMEDIATE");
    await check("before_commit");
    progress.commitAttempted = true;
  });
  progress.commitConfirmed = true;
  await check("after_commit");
  const result = validateProductionSwimAppend(Array.from(await sql.unsafe(PRODUCTION_UPDATE_LEDGER_QUERY)), migrations, baseline);
  requireInspection(Date.now() < deadline, "deadline");
  return result;
}
