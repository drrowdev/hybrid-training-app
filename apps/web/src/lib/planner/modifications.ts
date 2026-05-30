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
 * Caller is `assemblePrescriptionItems` in lib/planner/actions.ts —
 * it fetches once per session-generation request and forwards the
 * result into `buildPrescription` so existing call sites that don't
 * pass modifications keep their current behaviour bit-for-bit.
 */

import { createClient } from "@/lib/supabase/server";
import type {
  RecoveryPayload,
  TaperPayload,
  TaperPayloadDay,
} from "@hta/db";
import { scaleForDateInWindow } from "./recovery";
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

/**
 * Read all currently-applied modifications for `userId` and reduce
 * them to a single effective scaling for `targetDate`.
 *
 * Recovery wins over taper when both rows happen to span the same
 * day — the user just raced, so the body's current physiological
 * state is "recovering", not "tapering for next event".
 */
export async function getActiveModifications(
  userId: string,
  targetDate: Date,
): Promise<ActiveModifications> {
  const dateStr = ymd(targetDate);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prescription_modifications")
    .select("kind,start_date,end_date,ramp_end_date,payload")
    .eq("user_id", userId)
    .eq("status", "applied")
    .lte("start_date", dateStr)
    .gte("end_date", dateStr);
  if (error || !data || data.length === 0) return NO_ACTIVE_MODIFICATIONS;

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
      startDate: recovery.start_date as string,
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
