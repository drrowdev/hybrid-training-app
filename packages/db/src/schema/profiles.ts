/**
 * profiles — app-level user data, 1:1 with auth.users.
 *
 * Per plan §4.3: don't extend the auth table; create a sibling row.
 * RLS policy: `USING (id = auth.uid())`.
 */
import { sql } from "drizzle-orm";
import {
  date,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  numeric,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/** DC-F11 + DC-Q2: declared body-composition phase. */
export const bodyCompPhase = pgEnum("body_comp_phase", [
  "gain",
  "maintain",
  "lean_out",
]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  timezone: text("timezone").default("UTC").notNull(),
  units: text("units").default("metric").notNull(),
  bodyweightKg: numeric("bodyweight_kg", { precision: 6, scale: 2 }),
  bodyCompPhase: bodyCompPhase("body_comp_phase").default("maintain").notNull(),
  phaseStartedAt: date("phase_started_at"),
  phaseTargetWeeks: smallint("phase_target_weeks"),
  /** Default % of 1RM used as the training max when no per-movement override is set. */
  tmPercentDefault: numeric("tm_percent_default", { precision: 4, scale: 1 })
    .default("90.0")
    .notNull(),
  /** How many days/week the user can realistically train. Drives archetype fit. */
  trainingDaysPerWeek: smallint("training_days_per_week").default(4).notNull(),
  intake: jsonb("intake").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const profileInsert = createInsertSchema(profiles);
export const profileSelect = createSelectSchema(profiles);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type BodyCompPhase = (typeof bodyCompPhase.enumValues)[number];
