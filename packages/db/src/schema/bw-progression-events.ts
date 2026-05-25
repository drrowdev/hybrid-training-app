/**
 * bw_progression_events — append-only audit of node advances.
 *
 * Written by the session-completion hook whenever
 * `evaluateProgression` (apps/web/src/lib/planner/bw-progression.ts)
 * returns `{ advance: true }` for a family. The pointer in
 * `bw_progress.current_node_id` moves on the same transaction; this
 * table preserves the timeline.
 *
 * RLS self-only — policies live in drizzle/0045_bw_progression_events.sql.
 */
import { sql } from "drizzle-orm";
import { index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { movementNodes, type MovementFamily } from "./movement-nodes";

export const bwProgressionEvents = pgTable(
  "bw_progression_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    family: text("family").notNull().$type<MovementFamily>(),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => movementNodes.id, { onDelete: "restrict" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => movementNodes.id, { onDelete: "restrict" }),
    /** Matches one of the `evaluateProgression` success reason strings. */
    reason: text("reason").notNull(),
    /**
     * Phase 7 — external load (kg) the user was carrying at the moment
     * the advance fired. Nullable; null = bodyweight-only advance.
     */
    loadKgAtAdvance: numeric("load_kg_at_advance", {
      precision: 5,
      scale: 2,
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userIdx: index("bw_progression_events_user_idx").on(
      t.userId,
      t.occurredAt,
    ),
  }),
);

export const bwProgressionEventInsert = createInsertSchema(bwProgressionEvents);
export const bwProgressionEventSelect = createSelectSchema(bwProgressionEvents);

export type BwProgressionEvent = typeof bwProgressionEvents.$inferSelect;
export type NewBwProgressionEvent = typeof bwProgressionEvents.$inferInsert;
