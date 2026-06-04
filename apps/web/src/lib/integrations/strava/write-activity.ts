/**
 * Per-activity write — extracted from `syncStrava` so the bulk
 * sync, single-activity webhook path, and the on-demand history
 * importer (PR feat/strava-history-import) all share the same insert
 * dance without duplicating SQL.
 *
 * Returns a discriminated result so callers can bucket outcomes for
 * user-visible summaries:
 *   - `imported`   → both rows inserted; classification ran.
 *   - `duplicate`  → cardio_logs.strava_activity_id already exists.
 *   - `skipped`    → activity didn't pass `buildSyncRow` (unmappable
 *                    or zero duration).
 *
 * Side effects intentionally kept inside this helper:
 *   - inserts a `sessions` row + `cardio_logs` row
 *   - rolls back the orphan `sessions` row on cardio insert error
 *   - calls `classifyAndLinkExternalCardio` best-effort
 *
 * Side effects intentionally NOT here (caller's responsibility):
 *   - updating `strava_connections.last_synced_at`
 *   - recomputing the region ledger
 *   - planned-session auto-link via the ±90 min matcher (the import
 *     path needs the new session id and the resolved row for that)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StravaActivity } from "./client";
import { buildSyncRow } from "./sync-row";
import { classifyAndLinkExternalCardio } from "./link-external-cardio";
import type { ZoneBands } from "@/lib/stats/hr-zones";
import type { HrZonesSeconds } from "./zones-from-summary";

export type WriteActivityResult =
  | {
      status: "imported";
      sessionId: string;
      cardioLogId: string;
      modality: string;
      performedAt: string;
    }
  | { status: "duplicate" }
  | { status: "skipped"; reason: "unmappable" | "no_row" };

/**
 * Best-effort idempotent write of one Strava activity. Throws on hard
 * DB errors so the caller can decide whether to abort the whole batch
 * or fold the error into a per-activity summary.
 */
export async function writeStravaActivity(args: {
  supabase: SupabaseClient;
  userId: string;
  activity: StravaActivity;
  bands: ZoneBands | null;
  userTimezone: string;
  /**
   * Measured per-zone seconds from the activity's HR stream, when the
   * caller fetched it (ADR 0009). When omitted, `buildSyncRow` falls back
   * to the summary leak-model approximation.
   */
  streamZones?: HrZonesSeconds | null;
}): Promise<WriteActivityResult> {
  const { supabase, userId, activity, bands, userTimezone, streamZones } = args;

  const row = buildSyncRow(activity, userId, { bands, hrZones: streamZones ?? null });
  if (!row) return { status: "skipped", reason: "unmappable" };

  const { data: inserted, error: insertErr } = await supabase
    .from("sessions")
    .insert(row.session)
    .select("id")
    .maybeSingle();
  if (insertErr) {
    if (insertErr.code === "23505" || /duplicate key/i.test(insertErr.message)) {
      return { status: "duplicate" };
    }
    throw new Error(insertErr.message);
  }
  if (!inserted) return { status: "skipped", reason: "no_row" };

  const { data: cardioInserted, error: cardioErr } = await supabase
    .from("cardio_logs")
    .insert({
      session_id: inserted.id,
      modality: row.cardio.modality,
      duration_sec: row.cardio.duration_sec,
      distance_km: row.cardio.distance_km,
      avg_pace_sec_per_km: row.cardio.avg_pace_sec_per_km,
      avg_hr_bpm: row.cardio.avg_hr_bpm,
      max_hr_bpm: row.cardio.max_hr_bpm,
      rpe: row.cardio.rpe,
      strava_activity_id: row.cardio.strava_activity_id,
      external_source: row.cardio.external_source,
      notes: row.cardio.notes,
      hr_zones: row.cardio.hr_zones,
    })
    .select("id")
    .maybeSingle();
  if (cardioErr) {
    // Roll back the orphan session row so re-sync can retry.
    await supabase.from("sessions").delete().eq("id", inserted.id);
    throw new Error(cardioErr.message);
  }

  if (cardioInserted?.id) {
    try {
      await classifyAndLinkExternalCardio({
        supabase,
        userId,
        sessionId: inserted.id,
        cardioLog: {
          id: cardioInserted.id,
          avg_hr_bpm: row.cardio.avg_hr_bpm,
          max_hr_bpm: row.cardio.max_hr_bpm,
          duration_sec: row.cardio.duration_sec,
        },
        performedAt: row.session.performed_at,
        userTimezone,
      });
    } catch (e) {
      console.error("classifyAndLinkExternalCardio failed:", e);
    }
  }

  return {
    status: "imported",
    sessionId: inserted.id,
    cardioLogId: cardioInserted?.id ?? "",
    modality: row.cardio.modality,
    performedAt: row.session.performed_at,
  };
}
