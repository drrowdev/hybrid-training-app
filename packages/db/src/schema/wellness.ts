/**
 * wellness — daily check-in row (bodyweight + motivation + notes).
 *
 * Phase 3 (migration 0027) extended this table with `sleep_hours` and
 * `motivation` so a single (user_id, date) row carries the full daily
 * check-in surface — what the Phase 3 spec called `daily_check_ins`.
 * Server actions: `recordDailyCheckIn` (apps/web/src/lib/wellness)
 * and the legacy `logBodyweight` (apps/web/src/lib/settings) both
 * upsert onto the same conflict target.
 *
 * Uniqueness on (user_id, date) prevents accidental duplicates.
 *
 * `sleep_hours` is reserved for a future health-app integration
 * (Apple Health / Google Fit) — no manual entry. The column is kept
 * so the integration can back-fill it; the UI never reads or writes
 * it from manual paths.
 */
import { sql } from "drizzle-orm";
import {
  date,
  numeric,
  pgTable,
  smallint,
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
    // Reserved for health-integration auto-fill — no manual entry.
    sleepHours: numeric("sleep_hours", { precision: 3, scale: 1 }),
    /** Self-reported motivation, 1=low → 5=high. Phase 3 A1. */
    motivation: smallint("motivation"),
    /** Day-level fatigue, 1=fresh → 9=wrecked. Today-redesign HowRecoveredCard. */
    fatigue: smallint("fatigue"),
    /** Day-level soreness, 1=none → 9=severe. Today-redesign HowRecoveredCard. */
    soreness: smallint("soreness"),
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
