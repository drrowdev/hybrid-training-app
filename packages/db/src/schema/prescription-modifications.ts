/**
 * prescription_modifications — audit + state log for engine-level
 * scaling decisions taken by the user via the Today banners.
 *
 * The taper computation (lib/planner/taper.ts) and the recovery
 * computation (lib/planner/recovery.ts) are deterministic from the
 * upcoming / just-finished priority event. The banner shows the
 * recommendation; the user clicks Apply or Decline. Each click writes
 * a row here with status='applied' or status='declined'. Undo writes
 * status='reverted' on the most recent applied row for the same
 * (event, kind).
 *
 * The engine consults rows with status='applied' that span the day
 * being prescribed (start_date ≤ date ≤ end_date). The full window is
 * snapshotted in `payload` so an Undo reverses exactly what was
 * Applied — even if the user crosses a window threshold (14d → 7d →
 * 3d) between the Apply and the Undo.
 *
 * Migration: drizzle/0077_prescription_modifications.sql.
 */
import { sql } from "drizzle-orm";
import { date, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const prescriptionModifications = pgTable("prescription_modifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  eventId: uuid("event_id"),
  kind: text("kind").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  rampEndDate: date("ramp_end_date"),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
});

export type PrescriptionModification = typeof prescriptionModifications.$inferSelect;
export type NewPrescriptionModification = typeof prescriptionModifications.$inferInsert;

/**
 * Snapshot of one day inside an applied taper window.
 * `intensityAction` mirrors `taper.ts` TaperRecommendation.
 */
export type TaperPayloadDay = {
  date: string; // YYYY-MM-DD
  volumeScale: number;
  intensityAction: "hold" | "hold_then_taper" | "minimal";
};

/** payload shape when kind='taper'. */
export type TaperPayload = {
  eventId: string | null;
  eventName: string;
  eventDate: string;
  /** day-by-day window from today through event_day. */
  window: TaperPayloadDay[];
  /** Snapshot of the source recommendation that triggered this Apply. */
  triggeredAtDaysOut: number;
  triggeredPhase: "approach" | "deep" | "polish" | "event_day";
};

/** payload shape when kind='recovery'. */
export type RecoveryPayload = {
  eventId: string | null;
  eventName: string;
  eventDate: string;
  days: number;
  rampDays: number;
  strengthLoadScale: number;
  cardioLoadScale: number;
  /** Full computeRecoveryWindow output — preserves confidence flag. */
  sourceWindow: {
    days: number;
    strengthLoadScale: number;
    cardioLoadScale: number;
    rampDays: number;
    confidence?: "LOW";
  };
};
