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
  /**
   * Phase 3 C1 — short haptic tick on set save when supported. Default
   * TRUE; the Web Vibration API silently no-ops on browsers that don't
   * expose it (Safari iOS).
   */
  hapticsEnabled: boolean("haptics_enabled").default(true).notNull(),
  /**
   * Phase 3 C2 — short tone at rest-timer = 0. Default TRUE; gated by
   * the first user gesture per browser autoplay policy.
   */
  timerSoundEnabled: boolean("timer_sound_enabled").default(true).notNull(),
  /**
   * Free-text training profile notes. Writable by both the user (from
   * the /app/profile page) and — once the AI surface lands — the
   * engine, which will append pattern observations the user can prune.
   * Default NULL; no length cap at DB level (server actions trim/limit).
   */
  aiNotes: text("ai_notes"),
  /**
   * Mass of the user's primary Olympic barbell, in kg. Drives the
   * plate-per-side breakdown rendered by the session logger. Default
   * 20.00 kg (standard men's bar).
   */
  barbellKg: numeric("barbell_kg", { precision: 5, scale: 2 })
    .default("20.00")
    .notNull(),
  /**
   * Mass of the user's trap/hex bar, in kg. Movements whose slug
   * contains `trap_bar` / `hex_bar` resolve to this value at the
   * render boundary. Default 25.00 kg.
   */
  trapBarKg: numeric("trap_bar_kg", { precision: 5, scale: 2 })
    .default("25.00")
    .notNull(),
  /**
   * Plate inventory: an array of `{ weight_kg, pair_count }` rows.
   * Always stored in kg — the UI converts at the render boundary
   * when `units = 'imperial'`. Default mirrors a sensible Olympic
   * plate set.
   */
  /**
   * Warmup-ladder configuration. NULL is treated as the default
   * `{ setCount: 3, percentLadder: [40, 50, 60], repLadder: [5, 3, 2] }`
   * at read time. `setCount = 0` disables auto-warmups entirely.
   *
   * Ladders are the practitioner-consensus ramp pattern: rehearse the
   * motor pattern at light loads, then ramp so connective tissue
   * acclimates before the first working set (Baar 2017 tendon-adaptation
   * literature on submaximal exposure prior to heavy loading).
   */
  warmupScheme: jsonb("warmup_scheme").$type<{
    setCount: number;
    percentLadder: number[];
    repLadder: number[];
  }>(),
  plateInventoryKg: jsonb("plate_inventory_kg")
    .$type<Array<{ weight_kg: number; pair_count: number }>>()
    .default(
      sql`'[
        {"weight_kg": 25,   "pair_count": 2},
        {"weight_kg": 20,   "pair_count": 2},
        {"weight_kg": 15,   "pair_count": 1},
        {"weight_kg": 10,   "pair_count": 2},
        {"weight_kg": 5,    "pair_count": 2},
        {"weight_kg": 2.5,  "pair_count": 2},
        {"weight_kg": 1.25, "pair_count": 2}
      ]'::jsonb`,
    )
    .notNull(),
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
