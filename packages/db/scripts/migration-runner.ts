import { type MigrationConfig, type MigrationMeta } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import { PostgresJsSession } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";

export function migrationFileBoundaries(migrations: readonly MigrationMeta[]): MigrationMeta[] {
  return migrations.map((migration) => ({
    ...migration,
    // Implicit pg_catalog lookup remains first; unqualified app DDL belongs in public.
    sql: ["SET LOCAL search_path = public", ...migration.sql, "SET LOCAL search_path = public"],
  }));
}

export async function migrateCanonical(
  client: Sql, migrations: readonly MigrationMeta[], config: MigrationConfig,
): Promise<void> {
  const dialect = new PgDialect();
  await dialect.migrate(migrationFileBoundaries(migrations), new PostgresJsSession(client, dialect, undefined), config);
}
