/**
 * @hta/db — Drizzle schema + typed client.
 *
 * Schema is split per table-family under src/schema/*.ts. Each table
 * carries a `user_id` column wherever it holds per-user data; RLS policies
 * live in drizzle/*.sql migrations and are validated by the multi-user e2e
 * test in apps/web (per plan §4.4 + the Phase 0 definition-of-done).
 */

export * from "./schema/profiles";
export * from "./schema/limitations";
export * from "./schema/movements";
export * from "./schema/sessions";
export * from "./schema/session-movements";
export * from "./schema/set-logs";
export * from "./schema/cardio-logs";
export * from "./schema/wellness";
export * from "./schema/region-state";
export * from "./schema/region-state-history";
export * from "./schema/muscle-state";
export * from "./schema/training-maxes";
export * from "./schema/movement-nodes";
export * from "./schema/bw-progress";
export * from "./schema/bw-progression-events";
export * from "./types";
export * from "./schema/tm-history";
export * from "./schema/tm-suggestions";
export * from "./schema/planner";
export * from "./client";
export * from "./schema/strava-connections";
export * from "./schema/priority-events";
export * from "./schema/engine-override-events";
export * from "./schema/bw-diagnostics-snapshots";
