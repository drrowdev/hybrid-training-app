"use server";

/**
 * On-demand "how did this go" summary for a COMPLETED planned session, shown in
 * the plan/Today drawer instead of the prescription once the workout is logged
 * (or an activity is linked to it). Compact by design — the full breakdown
 * (HR-zone bar, per-set detail) lives on the session page; the drawer links there.
 */

import { createClient, getAuthUser } from "@/lib/supabase/server";

export type CompletedSessionSummary = {
  sessionId: string;
  performedAtIso: string | null;
  durationMin: number | null;
  distanceKm: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  /** Human label for the inferred cardio kind, when available. */
  modalityLabel: string | null;
  rpe: number | null;
  /** True when the session carried a cardio log (vs a pure strength session). */
  isCardio: boolean;
};

const KIND_LABEL: Record<string, string> = {
  cardio_z2: "Easy Z2",
  cardio_threshold: "Threshold",
  cardio_vo2: "VO2 intervals",
  cardio_alactic: "Sprint / alactic",
  cardio_mixed: "Mixed intensity",
};

export async function getCompletedSessionSummary(
  sessionId: string,
): Promise<CompletedSessionSummary | null> {
  if (!sessionId) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;

  const { data: session } = await supabase
    .from("sessions")
    .select("id, performed_at, duration_min, session_rpe")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!session) return null;

  const { data: log } = await supabase
    .from("cardio_logs")
    .select("duration_sec, distance_km, avg_hr_bpm, max_hr_bpm, inferred_kind")
    .eq("session_id", sessionId)
    .order("block_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  const durationMin =
    (session.duration_min as number | null) ??
    (log?.duration_sec != null ? Math.round((log.duration_sec as number) / 60) : null);

  return {
    sessionId,
    performedAtIso: (session.performed_at as string | null) ?? null,
    durationMin,
    distanceKm: log?.distance_km != null ? Number(log.distance_km) : null,
    avgHrBpm: (log?.avg_hr_bpm as number | null) ?? null,
    maxHrBpm: (log?.max_hr_bpm as number | null) ?? null,
    modalityLabel: log?.inferred_kind ? KIND_LABEL[log.inferred_kind as string] ?? null : null,
    rpe: session.session_rpe != null ? Number(session.session_rpe) : null,
    isCardio: log != null,
  };
}
