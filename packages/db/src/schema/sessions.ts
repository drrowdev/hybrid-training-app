/**
 * sessions — top-level training event (DC-A2 session_load primitive).
 *
 * Carries the per-session 2-slider check-in (DC-P1: fatigue + soreness 1–5).
 * Wellness daily fields are backlogged per § U MVP scope.
 */
import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const sessions = pgTable("sessions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  title: text("title"),
  durationMin: integer("duration_min"),
  notes: text("notes"),
  /** DC-P1: 1=fresh, 5=cooked. */
  fatigue: smallint("fatigue"),
  /** DC-P1: 1=none, 5=severe. */
  soreness: smallint("soreness"),
  /** DC-A2: session RPE 0–10. */
  sessionRpe: numeric("session_rpe", { precision: 3, scale: 1 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** DC-A4: six-bucket coefficients (filled post-completion). */
  bucketCoeffs: jsonb("bucket_coeffs")
    .$type<Record<string, number>>()
    .default({})
    .notNull(),
  /** DC-A5: region coefficients (filled post-completion). */
  regionCoeffs: jsonb("region_coeffs")
    .$type<Record<string, number>>()
    .default({})
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const sessionInsert = createInsertSchema(sessions);
export const sessionSelect = createSelectSchema(sessions);
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
