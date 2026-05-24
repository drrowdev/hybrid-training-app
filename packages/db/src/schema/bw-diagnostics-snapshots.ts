/**
 * bw_diagnostics_snapshots — append-only JSONB snapshots of
 * `runDiagnostics` output per user.
 *
 * Phase 6. Writer is `apps/web/src/lib/planner/bw-diagnostics-snapshot.ts`,
 * called at session completion + block creation. Reader is the
 * dashboard (latest snapshot) + the future drift-over-time chart
 * (all snapshots for a user).
 *
 * RLS self-only — policies live in
 * drizzle/0047_bw_diagnostics_snapshots.sql.
 */
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

// The canonical DiagnosticResult shape lives in the planner module
// (`apps/web/src/lib/planner/bw-diagnostics.ts`). We deliberately do
// NOT import it here to avoid a `packages/db → apps/web` cycle —
// the column is intentionally loosely typed as JSONB at the schema
// layer and callers narrow on read.
export type DiagnosticsSnapshotPayload = unknown;

export const bwDiagnosticsSnapshots = pgTable(
  "bw_diagnostics_snapshots",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    snapshot: jsonb("snapshot").notNull().$type<DiagnosticsSnapshotPayload>(),
    takenAt: timestamp("taken_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userTakenIdx: index("bw_diagnostics_snapshots_user_taken_idx").on(
      t.userId,
      t.takenAt,
    ),
  }),
);

export const bwDiagnosticsSnapshotInsert = createInsertSchema(
  bwDiagnosticsSnapshots,
);
export const bwDiagnosticsSnapshotSelect = createSelectSchema(
  bwDiagnosticsSnapshots,
);

export type BwDiagnosticsSnapshot = typeof bwDiagnosticsSnapshots.$inferSelect;
export type NewBwDiagnosticsSnapshot =
  typeof bwDiagnosticsSnapshots.$inferInsert;
