/**
 * Engine-side reader for `prescription_modifications`. Returns the
 * effective scaling for a given (user, date) tuple, accounting for:
 *   - the day-by-day taper snapshot stored at Apply time
 *   - the recovery window snapshot + linear ramp in the second half
 *   - "recovery wins" tie-breaker when both happen to overlap
 *
 * The DB stores only `status='applied'` rows that are currently
 * non-reverted; the active-window index keeps the lookup cheap.
 *
 * Consumed read-time at the three seams that turn a stored
 * prescription into what the user sees / logs — mirroring the
 * `applyAutoregVolumeScale` pattern (ADR 0013):
 *   - `getPlannedDays` / `getPlannedSessionById` (plan + session
 *     renderers) in lib/planner/queries.ts
 *   - `fillSessionFromPlan` (materialises set_logs) in
 *     lib/sessions/actions.ts
 * Each seam resolves the modification for the session's calendar date
 * and runs `applyModificationsToPrescription`. Absent an applied row
 * the transform is a byte-identical no-op, so users who never accept a
 * taper/recovery see unchanged prescriptions (the regression invariant).
 */

import { createClient } from "@/lib/supabase/server";
import type {
  Prescription,
  RecoveryPayload,
  TaperPayload,
  TaperPayloadDay,
} from "@hta/db";
import { scaleForDateInWindow } from "./recovery";
import { applyModificationsToItems } from "./archetypes";
import {
  NO_ACTIVE_MODIFICATIONS,
  type ActiveModifications,
} from "./modifications-types";

export {
  NO_ACTIVE_MODIFICATIONS,
  type ActiveModifications,
} from "./modifications-types";

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A single currently-applied modification row, as read from the DB. */
export type ActiveModificationRow = {
  kind: string;
  start_date: string;
  end_date: string;
  ramp_end_date: string | null;
  payload: unknown;
};

/**
 * Read every currently-applied (non-reverted, non-declined)
 * modification row for `userId`, regardless of date. The caller
 * resolves the effective scaling per target date in memory via
 * `resolveModificationsForDate` — this lets a multi-day reader
 * (`getPlannedDays`) fetch once instead of one query per day.
 */
export async function getActiveModificationRows(
  userId: string,
): Promise<ActiveModificationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prescription_modifications")
    .select("kind,start_date,end_date,ramp_end_date,payload")
    .eq("user_id", userId)
    .eq("status", "applied");
  if (error || !data) return [];
  return data as ActiveModificationRow[];
}

/**
 * Reduce a set of applied modification rows to a single effective
 * scaling for `targetDate`. Pure — no DB access.
 *
 * Recovery wins over taper when both rows happen to span the same
 * day — the user just raced, so the body's current physiological
 * state is "recovering", not "tapering for next event".
 */
export function resolveModificationsForDate(
  rows: ActiveModificationRow[],
  targetDate: Date | string,
): ActiveModifications {
  const dateStr = typeof targetDate === "string" ? targetDate : ymd(targetDate);
  const data = rows.filter(
    (r) => r.start_date <= dateStr && r.end_date >= dateStr,
  );
  if (data.length === 0) return NO_ACTIVE_MODIFICATIONS;

  // Recovery wins.
  const recovery = data.find((r) => r.kind === "recovery");
  if (recovery) {
    const payload = recovery.payload as RecoveryPayload;
    const win = payload.sourceWindow;
    const scales = scaleForDateInWindow({
      window: {
        days: win.days,
        strengthLoadScale: win.strengthLoadScale,
        cardioLoadScale: win.cardioLoadScale,
        rampDays: win.rampDays,
        ...(win.confidence ? { confidence: win.confidence } : {}),
      },
      startDate: recovery.start_date,
      targetDate: dateStr,
    });
    if (scales) {
      return {
        volumeScale: 1,
        intensityAction: null,
        strengthLoadScale: scales.strengthLoadScale,
        cardioLoadScale: scales.cardioLoadScale,
        source: "recovery",
      };
    }
  }

  const taper = data.find((r) => r.kind === "taper");
  if (taper) {
    const payload = taper.payload as TaperPayload;
    const dayRow: TaperPayloadDay | undefined = payload.window.find(
      (w) => w.date === dateStr,
    );
    if (dayRow) {
      const intensity =
        dayRow.intensityAction === "minimal"
          ? "minimal"
          : dayRow.intensityAction === "hold"
            ? "hold"
            : null;
      return {
        volumeScale: dayRow.volumeScale,
        intensityAction: intensity,
        strengthLoadScale: dayRow.volumeScale,
        cardioLoadScale: dayRow.volumeScale,
        source: "taper",
      };
    }
  }

  return NO_ACTIVE_MODIFICATIONS;
}

/**
 * Read all currently-applied modifications for `userId` and reduce
 * them to a single effective scaling for `targetDate`. Convenience
 * wrapper around `getActiveModificationRows` + `resolveModificationsForDate`
 * for single-date callers.
 */
export async function getActiveModifications(
  userId: string,
  targetDate: Date,
): Promise<ActiveModifications> {
  const rows = await getActiveModificationRows(userId);
  return resolveModificationsForDate(rows, targetDate);
}

/**
 * Apply an effective modification to a materialised prescription,
 * returning a scaled copy. No-op (returns the input unchanged, same
 * reference) when there is no active modification — preserving the
 * byte-identical regression invariant for users who never accept a
 * taper/recovery.
 */
export function applyModificationsToPrescription(
  prescription: Prescription,
  mods: ActiveModifications,
): Prescription {
  if (mods.source === null) return prescription;
  const items = applyModificationsToItems(prescription.items ?? [], mods);
  return { ...prescription, items };
}
