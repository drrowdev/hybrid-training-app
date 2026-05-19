/**
 * @hta/db — Drizzle schema + typed client.
 *
 * Schema is split per table-family under src/schema/*.ts. Each table
 * carries a `user_id` column wherever it holds per-user data; RLS policies
 * live in drizzle/*.sql migrations and are validated by the multi-user e2e
 * test in apps/web (per plan §4.4 + the Phase 0 definition-of-done).
 */

export * from "./schema/profiles.js";
export * from "./schema/limitations.js";
export * from "./schema/movements.js";
export * from "./client.js";
