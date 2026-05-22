/**
 * profiles — app-level user data, 1:1 with auth.users.
 *
 * Per plan §4.3: don't extend the auth table; create a sibling row.
 * RLS policy: `USING (id = auth.uid())`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
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
  /** When the first-run onboarding wizard finished or was skipped. null = show wizard. */
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  /**
   * Self-reported training age, captured at onboarding. Drives DC-G5
   * (cold-start tier): `lt_1y` → consumer load tier on the first block.
   * Constrained at DB level to {lt_1y, 1_3y, gte_3y}; null = unknown.
   */
  trainingExperience: text("training_experience"),
  /**
   * User is open to occasional two-a-day sessions (AM lift + PM cardio).
   * Engine support is deferred; this only records the preference for now.
   * See research-new §interference: ≥6h gap between modalities respects AMPK/mTORC1.
   */
  allowsTwoADays: boolean("allows_two_a_days").default(false).notNull(),
  /** Default AM-session window (used when planned_at is unset). */
  amWindowStart: time("am_window_start").default("07:00").notNull(),
  amWindowEnd: time("am_window_end").default("09:00").notNull(),
  /** Default PM-session window. */
  pmWindowStart: time("pm_window_start").default("17:00").notNull(),
  pmWindowEnd: time("pm_window_end").default("19:00").notNull(),
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
