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
export * from "./schema/limitation-events";
export * from "./schema/limitation-adjustments";
export * from "./schema/movements";
export * from "./schema/movement-instructions";
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
export * from "./schema/bw-set-progress-contributions";
export * from "./schema/bw-progression-events";
export * from "./types";
export * from "./schema/tm-history";
export * from "./schema/tm-suggestions";
export * from "./schema/planner";
export * from "./schema/program-instances";
export * from "./schema/program-recommendations";
export * from "./schema/rehab-protocols";
export * from "./schema/training-seasons";
export * from "./client";
export * from "./schema/priority-events";
export * from "./schema/prescription-modifications";
export * from "./schema/engine-override-events";
export * from "./schema/bw-diagnostics-snapshots";
