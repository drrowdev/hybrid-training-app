/**
 * region_state — per-user × per-region rolling load state (v2 §10).
 *
 * Materialised by `recomputeRegionState()` (apps/web/src/lib/engine/region-ledger.ts)
 * on session completion. Read by `regionFreshness()` and surfaced on /app.
 */
import { sql } from "drizzle-orm";
import {
  date,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { region } from "./limitations";

export const regionState = pgTable(
  "region_state",
  {
    userId: uuid("user_id").notNull(),
    region: region("region").notNull(),
    atl: numeric("atl", { precision: 10, scale: 4 }).default("0").notNull(),
    ctl: numeric("ctl", { precision: 10, scale: 4 }).default("0").notNull(),
    baselineTolerance: numeric("baseline_tolerance", { precision: 10, scale: 4 })
      .default("0")
      .notNull(),
    lastLoadDate: date("last_load_date"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.region] }),
  }),
);

export type RegionState = typeof regionState.$inferSelect;
export type NewRegionState = typeof regionState.$inferInsert;
