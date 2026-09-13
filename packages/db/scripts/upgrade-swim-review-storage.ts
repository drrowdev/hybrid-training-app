import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { z } from "zod";
import { validateDatabaseUrl } from "./prepare-swim-review";
import { verifyMigrationDependencyParity } from "./migrate-with-evidence";

export const REVIEW_BASE_COUNT = 150;
export const REVIEW_UPGRADED_COUNT = 154;
const appendedTags = [
  "0150_swim_import_storage", "0151_swim_pool_changes",
  "0152_swim_private_courses", "0153_swim_import_matching",
] as const;
type Migration = ReturnType<typeof readMigrationFiles>[number];
export type ReviewStorageCode = "migration_source" | "ledger_shape" | "ledger_mismatch" | "owner_policies" | "writer_role" | "capabilities";
export class ReviewStorageRefusal extends Error {
  constructor(readonly code: ReviewStorageCode) { super(code); }
}
const ledgerSchema = z.array(z.object({
  id: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
}).strict()).max(REVIEW_UPGRADED_COUNT + 1);

function requireThat(value: unknown, code: ReviewStorageCode = "migration_source"): asserts value {
  if (!value) throw new ReviewStorageRefusal(code);
}

export function reviewMigrations(): Migration[] {
  verifyMigrationDependencyParity();
  const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
  const journal = z.object({ entries: z.array(z.object({
    idx: z.number().int(), when: z.number().int(), tag: z.string(), breakpoints: z.boolean(),
  })) }).parse(JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")));
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  requireThat(journal.entries.length === REVIEW_UPGRADED_COUNT && migrations.length === REVIEW_UPGRADED_COUNT);
  journal.entries.forEach((entry, index) => {
    requireThat(entry.idx === index && entry.when === migrations[index]!.folderMillis &&
      (index === 0 || entry.when > journal.entries[index - 1]!.when));
    if (index >= REVIEW_BASE_COUNT) {
      requireThat(entry.tag === appendedTags[index - REVIEW_BASE_COUNT] && entry.breakpoints === false);
    }
  });
  return migrations;
}

export function validateReviewLedger(value: unknown, migrations: readonly Migration[], count: number) {
  const parsed = ledgerSchema.safeParse(value);
  requireThat(parsed.success, "ledger_shape");
  const rows = parsed.data;
  requireThat(migrations.length === REVIEW_UPGRADED_COUNT &&
    (count === REVIEW_BASE_COUNT || count === REVIEW_UPGRADED_COUNT) && rows.length === count, "ledger_mismatch");
  rows.forEach((row, index) => requireThat(
    row.hash === migrations[index]!.hash &&
    String(row.created_at) === String(migrations[index]!.folderMillis) &&
    (index === 0 || row.id > rows[index - 1]!.id), "ledger_mismatch",
  ));
}

export function connectReviewDatabase(raw: string | undefined) {
  const sql = postgres(validateDatabaseUrl(raw), {
    max: 1, prepare: false, ssl: "require", connect_timeout: 10, onnotice: () => {},
    connection: {
      statement_timeout: 60_000, lock_timeout: 5_000, idle_in_transaction_session_timeout: 60_000,
      client_min_messages: "error", row_security: "on", application_name: "swim-review-upgrade",
    },
  });
  // Match the canonical migration driver's literal serialization.
  const passthrough = (value: string) => value;
  for (const type of [1184, 1082, 1083, 1114]) {
    sql.options.parsers[type] = passthrough;
    sql.options.serializers[type] = passthrough;
  }
  sql.options.serializers[114] = passthrough;
  sql.options.serializers[3802] = passthrough;
  return sql;
}

export async function inspectReviewLedger(sql: postgres.Sql, migrations: readonly Migration[], count: number) {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    validateReviewLedger(Array.from(await tx.unsafe(
      "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 155",
    )), migrations, count);
  });
}

export async function verifyUpgradedReviewStorage(tx: postgres.TransactionSql) {
  const policies = await tx.unsafe(`SELECT c.relname, c.relrowsecurity,
    pg_get_expr(p.polqual,p.polrelid) AS predicate, pg_get_expr(p.polwithcheck,p.polrelid) AS check_predicate
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_policy p ON p.polrelid=c.oid
    WHERE n.nspname='public' AND c.relname IN ('swim_connections','swim_imports','swim_import_matches')
    ORDER BY c.relname`);
  requireThat(policies.length === 3 && new Set(policies.map((row) => row.relname)).size === 3 &&
    policies.every((row) => row.relrowsecurity === true && row.predicate === "(auth.uid() = user_id)" &&
      (row.check_predicate === null || row.check_predicate === "(auth.uid() = user_id)")), "owner_policies");
  const roles = await tx.unsafe("SELECT rolbypassrls, rolsuper, rolcanlogin FROM pg_roles WHERE rolname='swim_writer'");
  requireThat(roles.length === 1 && roles[0]!.rolbypassrls === false &&
    roles[0]!.rolsuper === false && roles[0]!.rolcanlogin === false, "writer_role");
  await tx.unsafe("SET LOCAL ROLE authenticated");
  const ready = await tx.unsafe(`SELECT public.swim_storage_ready() AS base,
    public.swim_pool_editing_ready() AS pool, public.swim_private_course_ready() AS course,
    public.swim_import_storage_ready() AS imports, public.swim_import_matching_ready() AS matching`);
  requireThat(ready.length === 1 && ["base", "pool", "course", "imports", "matching"].every((key) => ready[0]![key] === true), "capabilities");
  await tx.unsafe("RESET ROLE");
}

export async function appendReviewMigrations(
  sql: postgres.Sql, migrations: readonly Migration[], guard: () => Promise<void>,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='60s'");
    await tx.unsafe("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    validateReviewLedger(Array.from(await tx.unsafe(
      "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 155",
    )), migrations, REVIEW_BASE_COUNT);
    for (const migration of migrations.slice(REVIEW_BASE_COUNT)) {
      await guard();
      for (const statement of migration.sql) await tx.unsafe(statement);
      await tx.unsafe("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)", [migration.hash, migration.folderMillis]);
    }
    validateReviewLedger(Array.from(await tx.unsafe(
      "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 155",
    )), migrations, REVIEW_UPGRADED_COUNT);
    await verifyUpgradedReviewStorage(tx);
    await guard();
  });
}
