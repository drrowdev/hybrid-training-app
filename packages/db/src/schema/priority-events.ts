/**
 * priority_events — user-marked key dates that drive rule-based taper
 * suggestions (Phase 2 + new §6).
 */
import { sql } from "drizzle-orm";
import { date, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const eventPriority = pgEnum("event_priority", ["A", "B", "C"]);

export const priorityEvents = pgTable("priority_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  eventDate: date("event_date").notNull(),
  priority: eventPriority("priority").default("A").notNull(),
  modality: text("modality"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export type PriorityEvent = typeof priorityEvents.$inferSelect;
export type NewPriorityEvent = typeof priorityEvents.$inferInsert;
