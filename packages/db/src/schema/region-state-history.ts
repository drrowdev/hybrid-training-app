/**
 * region_state_history — daily per-region freshness snapshots (0029).
 *
 * Captured by the /api/cron/region-state-snapshot Vercel cron at 03:00
 * UTC and read by `getRegionFreshnessDetail` to render the 14-day strip
 * on /app/stats/engine. See drizzle/0029_region_state_history.sql for
 * the design notes.
 */
import { sql } from "drizzle-orm";
import {
  date,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const regionStateHistory = pgTable(
  "region_state_history",
  {
    userId: uuid("user_id").notNull(),
    region: text("region").notNull(),
    snapshotDate: date("snapshot_date").notNull(),
    freshnessScore: numeric("freshness_score", { precision: 5, scale: 4 }).notNull(),
    context: jsonb("context"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.region, t.snapshotDate] }),
  }),
);

export type RegionStateHistory = typeof regionStateHistory.$inferSelect;
export type NewRegionStateHistory = typeof regionStateHistory.$inferInsert;
