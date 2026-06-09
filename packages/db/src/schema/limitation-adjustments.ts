/**
 * limitation_adjustments — audit of movement swaps/drops the engine applied in
 * response to a limitation (ADR 0014 mid-block response, migration 0101).
 *
 * One row per (session, offending movement) — UNIQUE (session_id,
 * from_movement_id), so re-applying refreshes rather than duplicates. Attributed
 * to the causing limitation where determinable (nullable for ambiguous
 * multi-limitation cases). Powers the "N movements adjusted around this" count
 * on the Today active-limitation card and the injuries page.
 */
import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type LimitationAdjustmentKind = "swap" | "drop";

export const limitationAdjustments = pgTable(
  "limitation_adjustments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    /** Causing limitation; null when not cleanly attributable. */
    limitationId: uuid("limitation_id"),
    blockId: uuid("block_id"),
    sessionId: uuid("session_id").notNull(),
    kind: text("kind").$type<LimitationAdjustmentKind>().notNull(),
    fromMovementId: uuid("from_movement_id").notNull(),
    fromName: text("from_name").notNull(),
    /** Null for a drop. */
    toMovementId: uuid("to_movement_id"),
    toName: text("to_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    sessionFromKey: uniqueIndex("limitation_adjustments_session_from_key").on(
      t.sessionId,
      t.fromMovementId,
    ),
    userIdx: index("limitation_adjustments_user_idx").on(
      t.userId,
      t.createdAt.desc(),
    ),
    limitationIdx: index("limitation_adjustments_limitation_idx").on(
      t.limitationId,
    ),
  }),
);

export type LimitationAdjustment = typeof limitationAdjustments.$inferSelect;
export type NewLimitationAdjustment = typeof limitationAdjustments.$inferInsert;
