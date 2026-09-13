import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type postgres from "postgres";
import { z } from "zod";
import { verifyMigrationDependencyParity } from "./migrate-with-evidence";
import { ReviewStorageRefusal, verifyUpgradedReviewStorage } from "./upgrade-swim-review-storage";

type Migration = ReturnType<typeof readMigrationFiles>[number];
const ledger = z.array(z.object({
  id: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
}).strict()).max(156);
const ledgerQuery = "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 156";

export function untimedReviewMigrations(): Migration[] {
  verifyMigrationDependencyParity();
  const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const journal = z.object({ entries: z.array(z.object({
    idx: z.number().int(), when: z.number().int(), tag: z.string(), breakpoints: z.boolean(),
  })) }).parse(JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")));
  if (migrations.length !== 155 || journal.entries.length !== 155 ||
    journal.entries[154]!.tag !== "0154_swim_untimed_courses" || journal.entries[154]!.breakpoints ||
    journal.entries.some((entry, index) => entry.idx !== index || entry.when !== migrations[index]!.folderMillis ||
      (index > 0 && entry.when <= journal.entries[index - 1]!.when))) throw new ReviewStorageRefusal("migration_source");
  return migrations;
}

export function validateUntimedLedger(value: unknown, migrations: readonly Migration[], count: 154 | 155) {
  const rows = ledger.safeParse(value);
  if (!rows.success) throw new ReviewStorageRefusal("ledger_shape");
  if (migrations.length !== 155 || ![154, 155].includes(count) || rows.data.length !== count ||
    rows.data.some((row, index) => row.hash !== migrations[index]!.hash ||
      String(row.created_at) !== String(migrations[index]!.folderMillis) ||
      (index > 0 && row.id <= rows.data[index - 1]!.id))) throw new ReviewStorageRefusal("ledger_mismatch");
}

export async function inspectUntimedLedger(sql: postgres.Sql, migrations: readonly Migration[], count: 154 | 155) {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION READ ONLY");
    validateUntimedLedger(Array.from(await tx.unsafe(ledgerQuery)), migrations, count);
  });
}

export async function appendUntimedMigration(sql: postgres.Sql, migrations: readonly Migration[], guard: () => Promise<void>) {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='60s'");
    await tx.unsafe("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    validateUntimedLedger(Array.from(await tx.unsafe(ledgerQuery)), migrations, 154);
    await verifyUpgradedReviewStorage(tx);
    await guard();
    const migration = migrations[154]!;
    for (const statement of migration.sql) await tx.unsafe(statement);
    await tx.unsafe("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)", [migration.hash, migration.folderMillis]);
    validateUntimedLedger(Array.from(await tx.unsafe(ledgerQuery)), migrations, 155);
    await verifyUpgradedReviewStorage(tx);
    await tx.unsafe("SET LOCAL ROLE authenticated");
    const rows = await tx.unsafe("SELECT public.swim_untimed_course_ready() AS ready");
    if (rows.length !== 1 || rows[0]!.ready !== true) throw new ReviewStorageRefusal("capabilities");
    await tx.unsafe("RESET ROLE");
    await guard();
  });
}
