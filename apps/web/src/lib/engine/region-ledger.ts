/**
 * Region-ledger materialisation (v2 §10 + DC-C14).
 *
 * Walks all completed sessions for a user, builds a per-day per-region
 * load series from PER-SET data, applies the EWMA recurrence to compute
 * current ATL_r and CTL_r, and upserts the result into `region_state`.
 *
 * Load formula (verified per docs/design — see lib/engine/set-load.ts):
 *   set_load_kg = sets × reps × weight × rpe_multiplier
 *   region_load = set_load_kg × {1.0 primary | 0.5 secondary}
 *
 * Cardio falls back to duration × rpe-derived load until an
 * integration provides per-modality interference math.
 *
 * Cost: O(sets) per recompute. Fine for personal-project tier.
 */
import { finalEwma } from "@hta/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayYmd, ymdInTimezone } from "@/lib/dates";
import { deriveDailyRegionLoad } from "./region-daily-load";

const REGIONS = [
  "foot_ankle_calf",
  "knee",
  "hamstring_posterior",
  "adductor_groin",
  "lumbar_trunk",
  "shoulder_scapular",
  "elbow_forearm",
] as const;
export type Region = (typeof REGIONS)[number];

type SetRow = {
  session_id: string;
  performed_at: string;
  weight_kg: number | string | null;
  reps: number | null;
  rpe: number | string | null;
  set_kind: string | null;
  skipped: boolean | null;
  movement: unknown;
};

type CardioRow = {
  session_id: string;
  performed_at: string;
  duration_sec: number;
  rpe: number | string | null;
  modality: string | null;
  hr_zones: unknown;
  swim_result?: unknown;
  movement: unknown;
};

export async function recomputeRegionState(
  supabase: SupabaseClient,
  userId: string,
  userTz: string,
): Promise<{ updated: number; firstDate: string | null; lastDate: string | null }> {
  // Pull completed-session ids in date order so we have the session_id ->
  // performed_at lookup for the per-day bucketing.
  const { data: sessions, error: se } = await supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .order("performed_at", { ascending: true });
  if (se) throw new Error(se.message);

  if (!sessions || sessions.length === 0) {
    const { error: deleteError } = await supabase
      .from("region_state")
      .delete()
      .eq("user_id", userId);
    if (deleteError) throw new Error(deleteError.message);
    return { updated: 0, firstDate: null, lastDate: null };
  }

  const sessionIds = sessions.map((s) => s.id);
  const performedAtById = new Map(sessions.map((s) => [s.id, s.performed_at as string]));

  // Per-set strength data — the new primary load source. Skipped sets
  // (migration 0037) explicitly do NOT count as work, so the ledger
  // filters them out at the source.
  const { data: setsRaw, error: setError } = await supabase
    .from("set_logs")
    .select("session_id, weight_kg, reps, rpe, set_kind, skipped, movement:movements(primary_region, secondary_regions)")
    .in("session_id", sessionIds)
    .eq("skipped", false)
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0);
  if (setError) throw new Error(setError.message);

  // Cardio falls back to duration × rpe-derived load. Pulls `hr_zones` so
  // we can use a time-in-zone weighted intensity when HR zones have
  // populated it (PR #162 + audit I3).
  const { data: cardioRaw, error: cardioError } = await supabase
    .from("cardio_logs")
    .select("*, movement:movements(primary_region, secondary_regions)")
    .in("session_id", sessionIds);
  if (cardioError) throw new Error(cardioError.message);

  const sets: SetRow[] = (setsRaw ?? []).map((s) => ({
    session_id: s.session_id,
    performed_at: performedAtById.get(s.session_id) ?? "",
    weight_kg: s.weight_kg,
    reps: s.reps,
    rpe: s.rpe,
    set_kind: s.set_kind,
    skipped: s.skipped,
    movement: s.movement,
  }));
  const cardio: CardioRow[] = (cardioRaw ?? []).map((c) => ({
    session_id: c.session_id,
    performed_at: performedAtById.get(c.session_id) ?? "",
    duration_sec: c.duration_sec,
    rpe: c.rpe,
    modality: c.modality,
    hr_zones: c.hr_zones,
    swim_result: c.swim_result,
    movement: c.movement,
  }));

  const dailyLoad = deriveDailyRegionLoad({
    userTz,
    sets: sets.map((set) => ({
      performedAt: set.performed_at,
      weightKg: set.weight_kg,
      reps: set.reps,
      rpe: set.rpe,
      setKind: set.set_kind,
      skipped: set.skipped,
      movement: set.movement,
    })),
    cardio: cardio.map((row) => ({
      performedAt: row.performed_at,
      durationSec: row.duration_sec,
      rpe: row.rpe,
      modality: row.modality,
      hrZones: row.hr_zones,
      swimResult: row.swim_result,
      movement: row.movement,
    })),
  });

  const firstDate = ymdInTimezone(new Date(sessions[0]!.performed_at as string), userTz);
  const todayIso = todayYmd(userTz);

  const upserts = REGIONS.map((region) => {
    const series = dailyLoad.get(region)!;
    const atl = finalEwma(series, firstDate, todayIso, 7);
    const ctl = finalEwma(series, firstDate, todayIso, 28);
    // Baseline tolerance defaults to CTL (the user's own chronic norm).
    // Future calibration target per DC-C9.
    const baselineTolerance = ctl;
    return {
      user_id: userId,
      region,
      atl,
      ctl,
      baseline_tolerance: baselineTolerance,
      last_load_date: lastDateWithLoad(series),
      updated_at: new Date().toISOString(),
    };
  });

  const { error: upsertError } = await supabase
    .from("region_state")
    .upsert(upserts, { onConflict: "user_id,region" });
  if (upsertError) throw new Error(upsertError.message);

  return { updated: upserts.length, firstDate, lastDate: todayIso };
}

function lastDateWithLoad(series: Map<string, number>): string | null {
  let max: string | null = null;
  for (const [d, v] of series) {
    if (v > 0 && (!max || d > max)) max = d;
  }
  return max;
}
