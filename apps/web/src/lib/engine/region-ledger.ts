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
 * Cardio falls back to duration × rpe-derived load until a Strava
 * integration provides per-modality interference math.
 *
 * Cost: O(sets) per recompute. Fine for personal-project tier.
 */
import { finalEwma } from "@hta/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSetLoad, PRIMARY_REGION_WEIGHT, SECONDARY_REGION_WEIGHT } from "./set-load";

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

type RegionRefs = {
  primary_region: Region;
  secondary_regions: unknown;
} | null;

type SetRow = {
  session_id: string;
  performed_at: string;
  weight_kg: number | string | null;
  reps: number | null;
  rpe: number | string | null;
  set_kind: string | null;
  movement: RegionRefs;
};

type CardioRow = {
  session_id: string;
  performed_at: string;
  duration_sec: number;
  rpe: number | string | null;
  movement: RegionRefs;
};

export async function recomputeRegionState(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ updated: number; firstDate: string | null; lastDate: string | null }> {
  // Pull completed-session ids in date order so we have the session_id ->
  // performed_at lookup for the per-day bucketing.
  const { data: sessions, error: se } = await supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .order("performed_at", { ascending: true });
  if (se) throw new Error(se.message);

  if (!sessions || sessions.length === 0) {
    await supabase.from("region_state").delete().eq("user_id", userId);
    return { updated: 0, firstDate: null, lastDate: null };
  }

  const sessionIds = sessions.map((s) => s.id);
  const performedAtById = new Map(sessions.map((s) => [s.id, s.performed_at as string]));

  // Per-set strength data — the new primary load source.
  const { data: setsRaw, error: setError } = await supabase
    .from("set_logs")
    .select("session_id, weight_kg, reps, rpe, set_kind, movement:movements(primary_region, secondary_regions)")
    .in("session_id", sessionIds)
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0);
  if (setError) throw new Error(setError.message);

  // Cardio falls back to duration × rpe-derived load.
  const { data: cardioRaw, error: cardioError } = await supabase
    .from("cardio_logs")
    .select("session_id, duration_sec, rpe, movement:movements(primary_region, secondary_regions)")
    .in("session_id", sessionIds);
  if (cardioError) throw new Error(cardioError.message);

  const sets: SetRow[] = (setsRaw ?? []).map((s) => ({
    session_id: s.session_id,
    performed_at: performedAtById.get(s.session_id) ?? "",
    weight_kg: s.weight_kg,
    reps: s.reps,
    rpe: s.rpe,
    set_kind: s.set_kind,
    movement: normaliseMovement(s.movement),
  }));
  const cardio: CardioRow[] = (cardioRaw ?? []).map((c) => ({
    session_id: c.session_id,
    performed_at: performedAtById.get(c.session_id) ?? "",
    duration_sec: c.duration_sec,
    rpe: c.rpe,
    movement: normaliseMovement(c.movement),
  }));

  const dailyLoad: Record<Region, Map<string, number>> = Object.fromEntries(
    REGIONS.map((r) => [r, new Map<string, number>()]),
  ) as Record<Region, Map<string, number>>;

  // Strength: per-set tonnage × rpe × muscle weight, credited to each region.
  for (const s of sets) {
    if (!s.movement) continue;
    // Skip warmup sets — they don't accumulate meaningful load.
    if (s.set_kind === "warmup") continue;
    const setLoad = computeSetLoad({
      sets: 1,
      reps: Number(s.reps),
      weightKg: Number(s.weight_kg),
      rpe: s.rpe == null ? null : Number(s.rpe),
    });
    if (setLoad <= 0) continue;
    const dateIso = s.performed_at.slice(0, 10);
    creditRegions(s.movement, setLoad, dailyLoad, dateIso);
  }

  // Cardio: duration_min × rpe_factor. Falls back to a conservative
  // RPE-6 equivalent when no RPE is logged (matches the strength default).
  for (const c of cardio) {
    if (!c.movement) continue;
    const durMin = c.duration_sec / 60;
    if (durMin <= 0) continue;
    const rpeFactor = c.rpe == null ? 0.5 : Math.min(1.0, Number(c.rpe) / 10);
    const cardioLoad = durMin * rpeFactor * 8;
    // The ×8 scalar puts cardio on roughly the same kg-load magnitude as
    // strength tonnage so the EWMA ratios stay comparable across modalities.
    const dateIso = c.performed_at.slice(0, 10);
    creditRegions(c.movement, cardioLoad, dailyLoad, dateIso);
  }

  const firstDate = (sessions[0]!.performed_at as string).slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);

  const upserts = REGIONS.map((region) => {
    const series = dailyLoad[region];
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

function normaliseMovement(m: unknown): RegionRefs {
  if (!m) return null;
  if (Array.isArray(m)) {
    const first = m[0];
    if (!first) return null;
    return first as RegionRefs;
  }
  return m as RegionRefs;
}

function creditRegions(
  movement: RegionRefs,
  load: number,
  dailyLoad: Record<Region, Map<string, number>>,
  dateIso: string,
): void {
  if (!movement) return;
  // Primary region: full weight.
  const primary = movement.primary_region;
  if ((REGIONS as readonly string[]).includes(primary)) {
    const prev = dailyLoad[primary].get(dateIso) ?? 0;
    dailyLoad[primary].set(dateIso, prev + load * PRIMARY_REGION_WEIGHT);
  }
  // Secondary regions: half weight each.
  const secondary = movement.secondary_regions;
  if (Array.isArray(secondary)) {
    for (const r of secondary as string[]) {
      if ((REGIONS as readonly string[]).includes(r)) {
        const region = r as Region;
        const prev = dailyLoad[region].get(dateIso) ?? 0;
        dailyLoad[region].set(dateIso, prev + load * SECONDARY_REGION_WEIGHT);
      }
    }
  }
}

function lastDateWithLoad(series: Map<string, number>): string | null {
  let max: string | null = null;
  for (const [d, v] of series) {
    if (v > 0 && (!max || d > max)) max = d;
  }
  return max;
}
