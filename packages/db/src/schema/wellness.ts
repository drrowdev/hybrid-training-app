/**
 * wellness — bodyweight per day (MVP).
 *
 * Per § U MVP scope: only bodyweight + free-text notes live here in v1.
 * Daily wellness check-in fields (sleep, mood, energy) are backlogged
 * until wearables / daily self-report widgets return.
 *
 * Uniqueness on (user_id, date) prevents accidental duplicates.
 */
import { sql } from "drizzle-orm";
import {
  date,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const wellness = pgTable(
  "wellness",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    bodyweightKg: numeric("bodyweight_kg", { precision: 6, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userDate: uniqueIndex("wellness_user_date_unique_idx").on(t.userId, t.date),
  }),
);

export const wellnessInsert = createInsertSchema(wellness);
export const wellnessSelect = createSelectSchema(wellness);
export type Wellness = typeof wellness.$inferSelect;
export type NewWellness = typeof wellness.$inferInsert;
