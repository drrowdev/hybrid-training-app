import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { minutesByModalityFromCardioLogs } from "@/lib/stats/muscle-volume";
import { computeConcurrentScalar } from "@/lib/engine/concurrent-scalar";
import {
  BASELINE_WINDOW_DAYS,
  MAINTENANCE_VOLUME_FLOOR_FRAC,
  type FloorContext,
} from "./maintenance-floor";

/**
 * Server glue for the ADR 0051 Phase 2 maintenance-floor advisory.
 *
 * Reads the user's rolling cardio + strength baseline (the SAME cardio-minutes
 * definition the engine already uses — `cardio_logs.duration_sec` via
 * `minutesByModalityFromCardioLogs`) and computes the interference scalar the
 * held cardio would impose AT the volume floor. Returns plain data for the
 * roadmap; null when the user has no session history to ground numbers in.
 *
 * Read-only + user-scoped (RLS): the caller passes a request-scoped client and
 * every query is filtered to `userId`. It READS the interference scalar; it
 * never modifies it (CP-2) and never enters the generator.
 */
export async function getMaintenanceFloorContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<FloorContext | null> {
  const sinceIso = new Date(Date.now() - BASELINE_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("performed_at", sinceIso);
  const sessionIds = (sessions ?? []).map((s) => s.id as string);
  if (sessionIds.length === 0) return null;

  const weeks = BASELINE_WINDOW_DAYS / 7;
  const [{ data: cardio }, { data: strengthSets }] = await Promise.all([
    supabase
      .from("cardio_logs")
      .select("session_id, duration_sec, modality")
      .in("session_id", sessionIds),
    supabase
      .from("set_logs")
      .select("session_id")
      .in("session_id", sessionIds)
      .eq("skipped", false)
      .neq("set_kind", "warmup"),
  ]);

  const cardioRows = (cardio ?? []) as Array<{
    session_id: string;
    duration_sec: number | null;
    modality: string | null;
  }>;

  // Weekly cardio volume (minutes) by modality, then the floor-scaled mix.
  const totalByModality = minutesByModalityFromCardioLogs(cardioRows);
  const totalMin = Object.values(totalByModality).reduce((s, m) => s + m, 0);
  const cardioBaselineMinPerWk = totalMin / weeks;

  // Interference the held cardio imposes if kept at the volume floor: scale the
  // user's weekly modality mix down to the maintenance fraction, preserving the
  // mix, then read the existing concurrent-scalar model.
  const floorByModality: Record<string, number> = {};
  for (const [mod, min] of Object.entries(totalByModality)) {
    floorByModality[mod] = (min / weeks) * MAINTENANCE_VOLUME_FLOOR_FRAC;
  }
  const cardioScalarAtFloor = computeConcurrentScalar(floorByModality);

  const cardioSessionsPerWk =
    new Set(cardioRows.map((c) => c.session_id).filter(Boolean)).size / weeks;
  const strengthSessionsPerWk =
    new Set((strengthSets ?? []).map((r) => r.session_id as string)).size / weeks;

  return {
    cardioBaselineMinPerWk,
    cardioSessionsPerWk,
    strengthSessionsPerWk,
    cardioScalarAtFloor,
  };
}
