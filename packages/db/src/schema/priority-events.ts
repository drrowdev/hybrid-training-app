/**
 * priority_events — user-marked key dates that drive the rule-based
 * taper (Phase 2 + new §6) and the self-serve /app/races page.
 *
 * 0017 set up the table with name + date + priority + modality + notes.
 * 0035 extended it with target_performance / result jsonb, a completed
 * flag, and an updated_at trigger so the history list orders
 * deterministically.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const eventPriority = pgEnum("event_priority", ["A", "B", "C"]);

/**
 * Loose modality-shaped target / result payload. Authored and read
 * only by the events UI — the engine never inspects these fields.
 *
 *   run:      { targetTime?: string; targetDistanceKm?: number; paceSecPerKm?: number }
 *   bike:     { targetTime?: string; targetDistanceKm?: number; avgPowerW?: number }
 *   swim:     { targetTime?: string; targetDistanceKm?: number }
 *   row|ski:  { targetTime?: string; targetDistanceKm?: number }
 *   strength: { targetTotal?: number; lifts?: Record<string, number> }
 *   padel:    { targetRank?: string }
 *   other:    { description?: string }
 */
export type EventPerformance = Record<string, unknown>;

export const priorityEvents = pgTable("priority_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  eventDate: date("event_date").notNull(),
  priority: eventPriority("priority").default("A").notNull(),
  modality: text("modality"),
  notes: text("notes"),
  targetPerformance: jsonb("target_performance").$type<EventPerformance | null>(),
  result: jsonb("result").$type<EventPerformance | null>(),
  completed: boolean("completed").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export type PriorityEvent = typeof priorityEvents.$inferSelect;
export type NewPriorityEvent = typeof priorityEvents.$inferInsert;
