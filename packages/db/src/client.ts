import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Build a Drizzle client bound to the given connection string.
 *
 * For Supabase-backed runtimes prefer the `service_role` key only in
 * server-side admin paths (account-delete, audit reads); user-scoped
 * code MUST use the anon-key path so RLS applies.
 */
export function makeClient(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: false,
  });
  return drizzle(sql);
}

export type DbClient = ReturnType<typeof makeClient>;
