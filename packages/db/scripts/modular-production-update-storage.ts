import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import type postgres from "postgres";
import { z } from "zod";
import { MODULAR_RELEASE_MIGRATIONS, modularMigrationInventory, type ModularMigration } from "./modular-production-preflight-guards";
import { PRODUCTION_SWIM_BASELINE, productionHistoryFingerprint, productionHistoryRows } from "./swim-production-reconciliation";
import { requireInspection } from "./swim-production-readonly-guards";
import type { ProductionUpdateGuard, ProductionUpdateProgress } from "./swim-production-update-storage";
import { modularCatalog, requireModularCatalogBaseline, verifyModularCatalog, verifyAddedModularSecurity } from "./modular-production-catalog";

export const MODULAR_LEDGER_SQL = "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 512";
export const MODULAR_PRODUCTION_BASELINE = {
  ...PRODUCTION_SWIM_BASELINE,
  fullFingerprint: "1174cd914fce682bc044342ed2d348dbc0c566defcfee47126e2a5d28165fb98",
} as const;
export type ModularProductionBaseline = { entries: number; fingerprint: string; fullFingerprint: string };

export type ModularUpdateMigration = ModularMigration & { sql: string[]; bps: boolean };
export function validateModularUpdateMigrations(rawJournal: unknown, migrations: readonly MigrationMeta[]): ModularUpdateMigration[] {
  const parsed = z.object({ version: z.literal("7"), dialect: z.literal("postgresql"), entries: z.array(z.object({
    idx: z.number().int(), tag: z.string(), when: z.number().int().positive(),
    version: z.literal("7"), breakpoints: z.boolean(),
  }).strict()).length(159) }).strict().safeParse(rawJournal);
  requireInspection(parsed.success, "migration_source");
  const journal = parsed.data;
  requireInspection(migrations.length === 159 && new Set(migrations.map(({ hash }) => hash)).size === 159 &&
    journal.entries.every((entry, index) => entry.idx === index && Number(entry.tag.slice(0, 4)) === index &&
      entry.when === migrations[index]!.folderMillis && entry.breakpoints === migrations[index]!.bps &&
      (index === 0 || entry.when > journal.entries[index - 1]!.when) &&
      migrations[index]!.sql.length > 0 && createHash("sha256")
        .update(migrations[index]!.sql.join("--> statement-breakpoint")).digest("hex") === migrations[index]!.hash) &&
    MODULAR_RELEASE_MIGRATIONS.every((expected, index) => {
      const entry = migrations[156 + index]!;
      return journal.entries[156 + index]!.tag === expected.tag && entry.hash === expected.hash &&
        entry.folderMillis === expected.folderMillis && !entry.bps && entry.sql.length === 1;
    }), "migration_source");
  return migrations.map((entry, index) => ({ ...entry, tag: journal.entries[index]!.tag }));
}

export function modularUpdateMigrations(): ModularUpdateMigration[] {
  return validateModularUpdateMigrations(
    JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")),
    readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) }),
  );
}

export function modularUpdateInventory(raw: unknown, migrations: readonly ModularUpdateMigration[],
  baseline: { entries: number; fingerprint: string } = PRODUCTION_SWIM_BASELINE) {
  validateModularUpdateMigrations({ version: "7", dialect: "postgresql", entries: migrations.map((entry, idx) => ({
    idx, version: "7", tag: entry.tag, when: entry.folderMillis, breakpoints: entry.bps,
  })) }, migrations);
  return modularMigrationInventory(raw, migrations.map(({ tag, hash, folderMillis }) => ({ tag, hash, folderMillis })), baseline);
}

export async function appendModularProduction(sql: postgres.Sql, migrations: readonly ModularUpdateMigration[],
  guard: ProductionUpdateGuard, progress: ProductionUpdateProgress,
  baseline: ModularProductionBaseline = MODULAR_PRODUCTION_BASELINE) {
  requireInspection(progress.attemptedMigrations === 0 && progress.stagedMigrations === 0 &&
    !progress.commitAttempted && !progress.commitConfirmed, "progress_state");
  const deadline = Date.now() + 120_000;
  const check = async (phase: Parameters<ProductionUpdateGuard>[0]) => {
    requireInspection(Date.now() < deadline, "deadline");
    await guard(phase);
    requireInspection(Date.now() < deadline, "deadline");
  };
  let retainedFingerprint = "";
  let committedCatalog: Awaited<ReturnType<typeof modularCatalog>> = [];
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='90s'; SET LOCAL row_security=on");
    await tx.unsafe("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    const before = productionHistoryRows(Array.from(await tx.unsafe(MODULAR_LEDGER_SQL)));
    const inventory = modularUpdateInventory(before, migrations, baseline);
    requireInspection(before.length === 213 && inventory.pending.length === 3 &&
      inventory.fingerprint === baseline.fullFingerprint, "modular_baseline");
    retainedFingerprint = productionHistoryFingerprint(before);
    const catalog = await modularCatalog(tx);
    requireModularCatalogBaseline(catalog);
    await check("before");
    for (const migration of migrations.slice(156)) {
      await check("migration");
      progress.attemptedMigrations++;
      await tx.unsafe(migration.sql[0]!);
      await tx.unsafe("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)", [migration.hash, migration.folderMillis]);
      progress.stagedMigrations++;
    }
    const after = productionHistoryRows(Array.from(await tx.unsafe(MODULAR_LEDGER_SQL)));
    requireInspection(after.length === 216 && modularUpdateInventory(after, migrations, baseline).pending.length === 0 &&
      productionHistoryFingerprint(after.slice(0, 213)) === retainedFingerprint, "modular_retention");
    await tx.unsafe("SET CONSTRAINTS ALL IMMEDIATE");
    await check("before_commit");
    committedCatalog = await modularCatalog(tx);
    verifyModularCatalog(catalog, committedCatalog);
    await verifyAddedModularSecurity(tx);
    requireInspection(Date.now() < deadline, "deadline");
    progress.commitAttempted = true;
  });
  progress.commitConfirmed = true;
  await check("after_commit");
  const after = productionHistoryRows(Array.from(await sql.unsafe(MODULAR_LEDGER_SQL)));
  requireInspection(after.length === 216 && modularUpdateInventory(after, migrations, baseline).pending.length === 0 &&
    productionHistoryFingerprint(after.slice(0, 213)) === retainedFingerprint, "modular_retention");
  requireInspection(JSON.stringify(await modularCatalog(sql)) === JSON.stringify(committedCatalog), "catalog_after_commit_changed");
  await verifyAddedModularSecurity(sql);
  return { entries: 216, retainedEntries: 213, appendedEntries: 3, fingerprint: productionHistoryFingerprint(after) };
}
