/**
 * Strava → planned-cardio matcher (Phase 2 C1).
 *
 * Looks up the user's most recent Strava-imported cardio_logs row whose
 * parent session was performed within ±90 min of the target time, with
 * the modality compatible with the prescription cardio kind. Used by the
 * "Strava autofill" banner on a cardio session log surface.
 *
 * Why ±90 min? Realistic gap between finishing a Strava-tracked workout
 * (auto-uploaded by the watch/app within seconds) and opening the app
 * to log it. Wide enough to absorb device-clock drift; narrow enough to
 * avoid matching last week's ride to today's planned session.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrescriptionItemKind } from "@hta/db";

export type StravaMatchCandidate = {
  cardioLogId: string;
  stravaActivityId: string;
  modality: string;
  durationSec: number;
  distanceKm: number | null;
  avgHrBpm: number | null;
  rpe: number | null;
  /** Parent session ``performed_at``. */
  performedAt: string;
};

/** ±90-minute window in milliseconds. */
export const STRAVA_MATCH_WINDOW_MS = 90 * 60 * 1000;

/**
 * Cardio prescription kind → acceptable Strava modalities. cardio_*
 * kinds don't tell us run vs bike — they describe the energy system —
 * so we accept any common cardio modality and let the user reject the
 * banner if the match is wrong (dismiss is one tap).
 *
 * When the caller passes a non-cardio kind we still return matches (the
 * banner appears on the session log regardless of kind, since the user
 * might have done cardio in a strength session too).
 */
const CARDIO_MODALITIES = new Set([
  "run",
  "bike",
  "swim",
  "walk",
  "row",
  "ski",
  "other_cardio",
]);

export type FindStravaMatchOptions = {
  /** ISO timestamp of the session the user is logging into. */
  sessionPerformedAt: string;
  /** Acceptable modalities (defaults to all cardio). */
  modalityFilter?: Set<string>;
  /** Override the ±90 min window for tests. */
  windowMs?: number;
};

/**
 * Pure window/modality filter — kept separate from the DB call so the
 * window logic is unit-testable without a Supabase double.
 *
 * Returns the closest in-window candidate by absolute time delta, or
 * null when nothing matches. Ties broken by most-recent.
 */
export function pickBestMatch(
  candidates: StravaMatchCandidate[],
  opts: FindStravaMatchOptions,
): StravaMatchCandidate | null {
  const window = opts.windowMs ?? STRAVA_MATCH_WINDOW_MS;
  const targetMs = Date.parse(opts.sessionPerformedAt);
  if (!Number.isFinite(targetMs)) return null;
  const modalities = opts.modalityFilter ?? CARDIO_MODALITIES;
  let best: { c: StravaMatchCandidate; delta: number } | null = null;
  for (const c of candidates) {
    if (!modalities.has(c.modality)) continue;
    const ms = Date.parse(c.performedAt);
    if (!Number.isFinite(ms)) continue;
    const delta = Math.abs(ms - targetMs);
    if (delta > window) continue;
    if (!best || delta < best.delta || (delta === best.delta && ms > Date.parse(best.c.performedAt))) {
      best = { c, delta };
    }
  }
  return best?.c ?? null;
}

/**
 * Server query — looks up the user's Strava-imported cardio_logs within
 * a generous window around the session's performed_at, then picks the
 * best match. Returns null when no candidate is in range.
 *
 * NOTE: we deliberately exclude the current session_id from candidates
 * so a previously-applied autofill doesn't show up as a "fresh" match.
 */
export async function findMatchingStravaActivity(
  supabase: SupabaseClient,
  userId: string,
  sessionPerformedAt: string,
  options: { excludeSessionId?: string; prescriptionKind?: PrescriptionItemKind } = {},
): Promise<StravaMatchCandidate | null> {
  if (!userId || !sessionPerformedAt) return null;
  const targetMs = Date.parse(sessionPerformedAt);
  if (!Number.isFinite(targetMs)) return null;

  // Pull a slightly wider window from the DB (2× the matching window) so
  // edge cases at the boundary are still considered.
  const windowMs = STRAVA_MATCH_WINDOW_MS * 2;
  const fromIso = new Date(targetMs - windowMs).toISOString();
  const toIso = new Date(targetMs + windowMs).toISOString();

  const { data, error } = await supabase
    .from("cardio_logs")
    .select(
      "id, strava_activity_id, modality, duration_sec, distance_km, avg_hr_bpm, rpe, sessions!inner(id, user_id, performed_at, deleted_at)",
    )
    .eq("external_source", "strava")
    .eq("sessions.user_id", userId)
    .is("sessions.deleted_at", null)
    .gte("sessions.performed_at", fromIso)
    .lte("sessions.performed_at", toIso)
    .order("performed_at", { ascending: false, referencedTable: "sessions" })
    .limit(20);

  if (error || !data) return null;

  type Row = {
    id: string;
    strava_activity_id: string | null;
    modality: string;
    duration_sec: number;
    distance_km: number | string | null;
    avg_hr_bpm: number | null;
    rpe: number | string | null;
    sessions:
      | { id: string; performed_at: string }
      | { id: string; performed_at: string }[]
      | null;
  };
  const candidates: StravaMatchCandidate[] = [];
  for (const r of data as Row[]) {
    const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
    if (!s) continue;
    if (options.excludeSessionId && s.id === options.excludeSessionId) continue;
    if (!r.strava_activity_id) continue;
    candidates.push({
      cardioLogId: r.id,
      stravaActivityId: r.strava_activity_id,
      modality: r.modality,
      durationSec: r.duration_sec,
      distanceKm: r.distance_km == null ? null : Number(r.distance_km),
      avgHrBpm: r.avg_hr_bpm,
      rpe: r.rpe == null ? null : Number(r.rpe),
      performedAt: s.performed_at,
    });
  }
  return pickBestMatch(candidates, { sessionPerformedAt });
}
