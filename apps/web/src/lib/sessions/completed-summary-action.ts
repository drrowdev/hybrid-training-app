"use server";

/**
 * On-demand "what did I do" read for a COMPLETED planned session, shown in the
 * plan/Today drawer instead of the prescription once the workout is logged (or
 * an activity is linked to it).
 *
 * Fetched on open rather than shipped with the plan: a plan holds many completed
 * sessions and a lifter opens one. The full per-set page is still a click away.
 */

import { createClient, getAuthUser } from "@/lib/supabase/server";
import type { WeightUnit } from "@/lib/stats/units";
import {
  summariseCardioLogs,
  cardioKindLabel,
  type CardioLogRow,
} from "./cardio-summary";
import { buildSessionRecap, type RecapMovement, type RecapSetRow } from "./session-recap";

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
  /** The lifts, in the order they were logged. Empty for a cardio-only session. */
  lifts: RecapMovement[];
  /** The lifter's weight unit, so the caller renders loads the way they read them. */
  units: WeightUnit;
};

/**
 * `null` means the read failed or the session isn't the caller's — NOT that the
 * session was empty. An empty session comes back with `lifts: []`, so the caller
 * can tell "nothing logged" apart from "couldn't load it".
 */
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

  // Ownership is settled above, so the rest can go out together.
  const [cardioRes, setsRes, profileRes] = await Promise.all([
    supabase
      .from("cardio_logs")
      .select(
        "duration_sec, distance_km, avg_hr_bpm, max_hr_bpm, avg_pace_sec_per_km, hr_zones, modality, inferred_kind",
      )
      .eq("session_id", sessionId)
      .order("block_index", { ascending: true }),
    supabase
      .from("set_logs")
      .select(
        "movement_id, set_index, weight_kg, reps, duration_sec, distance_m, set_kind, skipped, skip_reason, movement:movements(display_name)",
      )
      .eq("session_id", sessionId)
      .order("set_index", { ascending: true }),
    supabase.from("profiles").select("units").eq("id", user.id).maybeSingle(),
  ]);

  // A failed read is not an empty session. Falling through with `[]` here is
  // exactly the bug this view exists to fix — telling a lifter they logged
  // nothing — so it reports as unavailable instead.
  if (cardioRes.error || setsRes.error) return null;

  // Every block, not just the first: a planned cardio day can carry a warm-up
  // plus intervals, and reading one block reports a fraction of the session as
  // if it were the whole thing.
  const cardio = summariseCardioLogs((cardioRes.data ?? []) as unknown as CardioLogRow[]);

  const durationMin =
    (session.duration_min as number | null) ??
    (cardio && cardio.durationSec > 0 ? Math.round(cardio.durationSec / 60) : null);

  type JoinedSetRow = Omit<RecapSetRow, "movement_name"> & {
    movement?: { display_name: string | null } | { display_name: string | null }[] | null;
  };
  const lifts = buildSessionRecap(
    ((setsRes.data ?? []) as unknown as JoinedSetRow[]).map((r) => {
      const m = Array.isArray(r.movement) ? r.movement[0] : r.movement;
      return { ...r, movement_name: m?.display_name ?? null };
    }),
  );

  return {
    sessionId,
    performedAtIso: (session.performed_at as string | null) ?? null,
    durationMin,
    distanceKm: cardio?.distanceKm ?? null,
    avgHrBpm: cardio?.avgHrBpm ?? null,
    maxHrBpm: cardio?.maxHrBpm ?? null,
    modalityLabel: cardioKindLabel(cardio?.inferredKind ?? null),
    rpe: session.session_rpe != null ? Number(session.session_rpe) : null,
    isCardio: cardio != null,
    lifts,
    // Best-effort: a missing profile row correctly reads as metric.
    units: profileRes.data?.units === "imperial" ? "imperial" : "metric",
  };
}
