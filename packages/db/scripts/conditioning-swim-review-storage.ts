import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type postgres from "postgres";
import { z } from "zod";
import { historicalSwimMigrations } from "../integration-tests/historical-swim-migrations";
import { verifyMigrationDependencyParity } from "./migrate-with-evidence";
import { isReviewOwnerPredicate, ReviewStorageRefusal, verifyUpgradedReviewStorage } from "./upgrade-swim-review-storage";

type Migration = ReturnType<typeof readMigrationFiles>[number];
const ledgerQuery = "SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 159";
const ledgerSchema = z.array(z.object({
  id: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
}).strict()).max(159);
function demand(value: unknown, code: "migration_source" | "ledger_shape" | "ledger_mismatch" | "owner_policies" | "writer_role" | "capabilities"): asserts value {
  if (!value) throw new ReviewStorageRefusal(code);
}
export function conditioningReviewMigrations(): Migration[] {
  verifyMigrationDependencyParity();
  const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const journal = z.object({ entries: z.array(z.object({
    idx: z.number().int(), when: z.number().int(), tag: z.string(), breakpoints: z.boolean(),
  })) }).parse(JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")));
  const historical = historicalSwimMigrations();
  demand(migrations.length === 158 && journal.entries.length === 158 &&
    journal.entries.every((entry, index) => entry.idx === index && entry.when === migrations[index]!.folderMillis &&
      (index === 0 || entry.when > journal.entries[index - 1]!.when)) &&
    historical.length === 155 && historical.every((entry, index) => entry.hash === migrations[index]!.hash &&
      entry.folderMillis === migrations[index]!.folderMillis), "migration_source");
  const appended = ["0155_swim_import_outcomes", "0156_atomic_swim_conditioning", "0157_swim_conditioning_lifecycle"];
  demand(journal.entries.slice(155).every((entry, index) => entry.tag === appended[index] && !entry.breakpoints), "migration_source");
  return migrations;
}
export function validateConditioningLedger(value: unknown, migrations: readonly Migration[], count: number) {
  const parsed = ledgerSchema.safeParse(value);
  demand(parsed.success, "ledger_shape");
  demand(migrations.length === 158 && (count === 155 || count === 158) && parsed.data.length === count &&
    parsed.data.every((row, index) => row.hash === migrations[index]!.hash &&
      String(row.created_at) === String(migrations[index]!.folderMillis) &&
      (index === 0 || row.id > parsed.data[index - 1]!.id)), "ledger_mismatch");
}
export async function inspectConditioningLedger(sql: postgres.Sql, migrations: readonly Migration[], count: number) {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    validateConditioningLedger(Array.from(await tx.unsafe(ledgerQuery)), migrations, count);
  });
}
export async function verifyConditioningReviewStorage(tx: postgres.TransactionSql) {
  await verifyUpgradedReviewStorage(tx);
  const policies = await tx.unsafe(`SELECT c.relname,c.relrowsecurity,
    pg_get_expr(p.polqual,p.polrelid) AS predicate,pg_get_expr(p.polwithcheck,p.polrelid) AS check_predicate
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_policy p ON p.polrelid=c.oid
    WHERE n.nspname='public' AND c.relname IN ('swim_import_outcomes','swim_conditioning_bindings','swim_conditioning_saves')`);
  demand(policies.length === 3 && new Set(policies.map((row) => row.relname)).size === 3 &&
    policies.every((row) => row.relrowsecurity === true && isReviewOwnerPredicate(row.predicate) &&
      isReviewOwnerPredicate(row.check_predicate)), "owner_policies");
  const [writer] = await tx.unsafe("SELECT rolbypassrls,rolsuper,rolcanlogin,rolinherit FROM pg_roles WHERE rolname='conditioning_writer'");
  demand(writer && [writer.rolbypassrls, writer.rolsuper, writer.rolcanlogin, writer.rolinherit].every((value) => value === false), "writer_role");
  await tx.unsafe("SET LOCAL ROLE authenticated");
  const [ready] = await tx.unsafe(`SELECT public.swim_import_outcomes_ready() AS outcomes,
    public.swim_conditioning_ready() AS binding,public.swim_conditioning_benchmarks_ready() AS benchmarks,
    public.swim_conditioning_activity_ready() AS activity,public.swim_conditioning_lifecycle_ready() AS lifecycle,
    public.swim_conditioning_program_edit_ready() AS editing`);
  demand(ready && Object.values(ready).length === 6 && Object.values(ready).every((value) => value === true), "capabilities");
  await tx.unsafe("RESET ROLE");
}
export async function appendConditioningMigrations(sql: postgres.Sql, migrations: readonly Migration[], guard: () => Promise<void>) {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='60s'");
    await tx.unsafe("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    validateConditioningLedger(Array.from(await tx.unsafe(ledgerQuery)), migrations, 155);
    await verifyUpgradedReviewStorage(tx);
    for (const migration of migrations.slice(155)) {
      await guard();
      for (const statement of migration.sql) await tx.unsafe(statement);
      await tx.unsafe("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)", [migration.hash, migration.folderMillis]);
    }
    validateConditioningLedger(Array.from(await tx.unsafe(ledgerQuery)), migrations, 158);
    await verifyConditioningReviewStorage(tx);
    await guard();
  });
}
