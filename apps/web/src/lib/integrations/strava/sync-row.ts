/**
 * Strava activity → insert-row builder. Pure function so it's testable
 * without hitting the network. The sync action calls this then upserts.
 *
 * Idempotency strategy:
 *   - sessions.strava_activity_id unique per user → ON CONFLICT DO NOTHING.
 *   - Re-syncing returns existing session ids without creating duplicates.
 *
 * RPE derivation priority (Strava → our 0–10 scale):
 *   1. perceived_exertion (athlete-set, already 0–10) — use as-is.
 *   2. suffer_score (Strava's relative-effort number) — scaled to ~0–10
 *      using a soft cap at 200 (≈10). Conservative but rough.
 *   3. null → ledger uses the 0.5 cardio default.
 */
import { mapStravaActivity, type CardioRegionMap } from "./mapping";
import type { StravaActivity } from "./client";

export type StravaSyncRow = {
  session: {
    user_id: string;
    title: string;
    performed_at: string;
    duration_min: number;
    session_rpe: number | null;
    slot: "single";
    completed_at: string;
    strava_activity_id: number;
  };
  cardio: {
    modality: string;
    duration_sec: number;
    distance_km: number | null;
    avg_hr_bpm: number | null;
    max_hr_bpm: number | null;
    rpe: number | null;
    strava_activity_id: string;
    external_source: "strava";
    notes: string | null;
  };
  mapping: CardioRegionMap;
};

function deriveRpe(activity: StravaActivity): number | null {
  if (activity.perceived_exertion != null) {
    // Clamp into [0, 10] just in case.
    return Math.max(0, Math.min(10, activity.perceived_exertion));
  }
  if (activity.suffer_score != null && activity.suffer_score > 0) {
    // Soft scale: 200 ≈ "couldn't have gone harder" → 10.
    return Math.max(0, Math.min(10, activity.suffer_score / 20));
  }
  return null;
}

/**
 * Builds the rows we'd insert for one Strava activity, or null if the
 * activity should be skipped (unsupported sport type or zero duration).
 */
export function buildSyncRow(
  activity: StravaActivity,
  userId: string,
): StravaSyncRow | null {
  const mapping = mapStravaActivity(activity.sport_type, activity.type);
  if (!mapping) return null;
  const duration = activity.moving_time > 0 ? activity.moving_time : activity.elapsed_time;
  if (!duration || duration <= 0) return null;
  const performedAt = activity.start_date;
  const rpe = deriveRpe(activity);
  const titleBase = activity.name?.trim() || `${mapping.modality} session`;
  return {
    session: {
      user_id: userId,
      title: `${titleBase} (Strava)`,
      performed_at: performedAt,
      duration_min: Math.round(duration / 60),
      session_rpe: rpe,
      slot: "single",
      completed_at: performedAt,
      strava_activity_id: activity.id,
    },
    cardio: {
      modality: mapping.modality,
      duration_sec: duration,
      distance_km: activity.distance > 0 ? Number((activity.distance / 1000).toFixed(3)) : null,
      avg_hr_bpm: activity.average_heartrate != null ? Math.round(activity.average_heartrate) : null,
      max_hr_bpm: activity.max_heartrate != null ? Math.round(activity.max_heartrate) : null,
      rpe,
      strava_activity_id: String(activity.id),
      external_source: "strava",
      notes: activity.description?.trim() || null,
    },
    mapping,
  };
}

export { deriveRpe };
