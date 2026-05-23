/**
 * muscle_state_history — daily per-muscle freshness snapshots (0031).
 *
 * Sibling table to region_state_history (0029). The 7-region model
 * stays intact; this adds a 16-muscle resolution for the visual grid
 * on /app/freshness and /app/stats/wellness.
 *
 * Written by /api/cron/region-state-snapshot at 03:00 UTC alongside
 * the existing region snapshots. Read by `getMuscleFreshness`.
 */
import { sql } from "drizzle-orm";
import {
  date,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const muscleStateHistory = pgTable(
  "muscle_state_history",
  {
    userId: uuid("user_id").notNull(),
    muscle: text("muscle").notNull(),
    snapshotDate: date("snapshot_date").notNull(),
    freshnessScore: numeric("freshness_score", { precision: 5, scale: 4 }).notNull(),
    daysSinceLoaded: smallint("days_since_loaded"),
    lastLoadDate: date("last_load_date"),
    context: jsonb("context"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.muscle, t.snapshotDate] }),
  }),
);

export type MuscleStateHistory = typeof muscleStateHistory.$inferSelect;
export type NewMuscleStateHistory = typeof muscleStateHistory.$inferInsert;
