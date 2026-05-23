/**
 * engine_override_events — first-class audit log for DC-K4
 * "override-and-warn, never silent overrule".
 *
 * Append-only record of every time the user took a different action
 * than the engine recommended:
 *   - 'skip'       — `planned_sessions.skipped_at` is set
 *   - 'swap'       — a prescription item movement was swapped
 *   - 'manual_end' — `training_blocks.archived_at` is set (End block)
 *   - 'custom'     — future override surfaces (free-form, no canonical
 *                    source row yet)
 *
 * Source FKs use ON DELETE SET NULL — the event row survives a later
 * soft- or hard-delete of the planned_session / block. The audit log
 * is the surviving record. See migration 0028.
 */
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export type EngineOverrideEventType = "skip" | "swap" | "manual_end" | "custom";

/**
 * Engine state captured at the moment of the override. Shape is
 * intentionally loose (per schema discipline, plan §6.8) — every
 * recording path fills in what it knows.
 */
export type EngineOverrideContext = {
  archetype?: string;
  /** 0-indexed week within the block. */
  weekIndex?: number;
  /** 0-indexed day within the week (Mon=0..Sun=6). */
  dayIndex?: number;
  /**
   * ISO weekday derived from the day's calendar date (Mon=1..Sun=7).
   * Convenient for `summariseOverridesByWeekday` so it doesn't need
   * to back-walk planned_sessions to know which weekday a skip was on.
   */
  weekday?: number;
  weeksCompleted?: number;
  percentThrough?: number;
  /** Marked true for rows written by the 0028 backfill. */
  backfilled?: boolean;
  [key: string]: unknown;
};

export const engineOverrideEvents = pgTable(
  "engine_override_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    eventType: text("event_type").$type<EngineOverrideEventType>().notNull(),
    plannedSessionId: uuid("planned_session_id"),
    blockId: uuid("block_id"),
    originalMovementSlug: text("original_movement_slug"),
    newMovementSlug: text("new_movement_slug"),
    /** Optional user-entered free-form note (max 280 chars at the DB CHECK). */
    reason: text("reason"),
    context: jsonb("context").$type<EngineOverrideContext>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userTimeIdx: index("engine_override_events_user_time_idx").on(t.userId, t.occurredAt),
    userTypeIdx: index("engine_override_events_user_type_idx").on(
      t.userId,
      t.eventType,
      t.occurredAt,
    ),
    dedupUnique: unique("engine_override_events_dedup_unique").on(
      t.eventType,
      t.plannedSessionId,
      t.occurredAt,
    ),
  }),
);

export type EngineOverrideEvent = typeof engineOverrideEvents.$inferSelect;
export type NewEngineOverrideEvent = typeof engineOverrideEvents.$inferInsert;
