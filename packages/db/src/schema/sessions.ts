/**
 * sessions — top-level training event (DC-A2 session_load primitive).
 *
 * Carries the per-session 2-slider check-in (DC-P1: fatigue + soreness 1–5).
 * Wellness daily fields are backlogged per § U MVP scope.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/**
 * DC-D1 / DC-D2 + docs/design/two-a-days.md: session-slot enum used by both
 * planned_sessions and sessions to enable AM + PM training on the same day.
 *
 * - `single`: legacy one-session-per-day shape; default for new freestyle rows.
 * - `am` / `pm`: paired entries on the same calendar day; planner enforces
 *   ≥6h gap (DC-D1) and AM-lift / PM-cardio default ordering (DC-D2).
 */
export const sessionSlot = pgEnum("session_slot", ["am", "pm", "single"]);

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
  /** Two-a-day slot. Default 'single' = legacy one-session-per-day shape. */
  slot: sessionSlot("slot").default("single").notNull(),
  /** Optional explicit planned start time. Defaults applied by the planner from profile AM/PM windows. */
  plannedAt: timestamp("planned_at", { withTimezone: true }),
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
  /** Optional Strava activity ID when this session was imported. Unique per user. */
  stravaActivityId: bigint("strava_activity_id", { mode: "number" }),
  /**
   * Native cardio Phase 0 — quick-cardio intent. Set by
   * `startQuickCardioSession` (Today "Quick workout" -> Run / Ride / Other)
   * so the session page opens the live GPS tracker instead of pre-logging a
   * `cardio_logs` row. NULL on every non-quick-cardio session. The real
   * cardio_logs row is written on finish by `logCardioSession`.
   */
  quickCardioModality: text("quick_cardio_modality"),
  quickCardioDurationSec: integer("quick_cardio_duration_sec"),
  /**
   * Off-plan prescription (migration 0087, ADR 0029). Carries the
   * `Prescription` ({ items: PrescriptionItem[] }) for a session that has no
   * linked `planned_sessions` row — currently the quick-generate strength flow.
   * The session page sources its prescription from the linked planned_session
   * first, then falls back to this column, so an off-plan generated session
   * renders the same grouped layout + progress counter as a planned one. NULL
   * on every planned / freestyle session.
   */
  prescription: jsonb("prescription"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  /**
   * Soft-delete marker (migration 0026). NULL = visible row, set to
   * NOW() when the user trashes the session. The 30-day cleanup cron
   * hard-deletes rows where `deleted_at < NOW() - INTERVAL '30 days'`.
   * Every user-facing query MUST filter `WHERE deleted_at IS NULL` —
   * the Trash page is the only place that selects the inverse.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const sessionInsert = createInsertSchema(sessions);
export const sessionSelect = createSelectSchema(sessions);
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type SessionSlot = (typeof sessionSlot.enumValues)[number];
