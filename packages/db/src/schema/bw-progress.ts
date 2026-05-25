/**
 * bw_progress — per-user × per-family current bodyweight node + accumulators.
 *
 * The pointer into movement_nodes for the family the user is currently
 * working through, plus the tendon-timeline accumulator (principle 4
 * of the addendum: gate progression on accumulated TUT at the previous
 * level, not just rep performance) and an append-only log of clean
 * reps for audit/debug.
 *
 * RLS: self-only — policies live in drizzle/0042_bw_skill_tree.sql.
 */
import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { movementNodes, type MovementFamily } from "./movement-nodes";

/**
 * Shape of one entry in clean_rep_history. Loose on purpose — engine
 * reads weeks_at_node + accumulated_tut_seconds, not this column.
 */
export type CleanRepHistoryEntry = {
  /** ISO date (YYYY-MM-DD) the qualifying set was logged. */
  date: string;
  reps: number;
  tempoSec: number;
  /** Reps in reserve at the end of the set. */
  rir: number;
  /**
   * Phase 7 — actual external load carried on this set. Negative for
   * band assist. Omitted on bodyweight-only entries.
   */
  external_load_kg?: number;
  load_source?: "weighted_vest" | "dip_belt" | "ankle_weights" | "band_assist";
};

export const bwProgress = pgTable(
  "bw_progress",
  {
    userId: uuid("user_id").notNull(),
    family: text("family").notNull().$type<MovementFamily>(),
    currentNodeId: uuid("current_node_id")
      .notNull()
      .references(() => movementNodes.id, { onDelete: "restrict" }),
    /** Tendon-timeline accumulator at the current node. */
    accumulatedTutSeconds: integer("accumulated_tut_seconds")
      .notNull()
      .default(0),
    weeksAtNode: smallint("weeks_at_node").notNull().default(0),
    cleanRepHistory: jsonb("clean_rep_history")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<CleanRepHistoryEntry[]>(),
    /**
     * Phase 7 — load (kg) the user should target on the next loaded
     * BW prescription for this family. Written by the
     * `suggestLoadOrVariant` "Apply suggestion" surface on the
     * bodyweight-progression settings page. Nullable; null = no
     * pending target, planner falls back to its own heuristic.
     */
    targetExternalLoadKg: numeric("target_external_load_kg", {
      precision: 5,
      scale: 2,
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.family] }),
  }),
);

export const bwProgressInsert = createInsertSchema(bwProgress);
export const bwProgressSelect = createSelectSchema(bwProgress);

export type BwProgress = typeof bwProgress.$inferSelect;
export type NewBwProgress = typeof bwProgress.$inferInsert;
