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
