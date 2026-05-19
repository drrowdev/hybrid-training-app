/**
 * Region-ledger materialisation (v2 §10 + DC-C14).
 *
 * Walks all completed sessions for a user, builds a per-day per-region
 * load series, applies the EWMA recurrence to compute current ATL_r and
 * CTL_r, and upserts the result into `region_state`.
 *
 * Cost: O(days × regions) per recompute. Fine for personal-project tier.
 */
import { finalEwma } from "@hta/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

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

const PRIMARY_REGION_WEIGHT = 1.0;
const SECONDARY_REGION_WEIGHT = 0.5;

type SessionRow = {
  id: string;
  performed_at: string;
  duration_min: number | null;
  session_rpe: string | number | null;
};

type RegionRefs = {
  primary_region: Region;
  secondary_regions: unknown;
} | null;

type SetRow = { session_id: string; movement: RegionRefs };
type CardioRow = {
  session_id: string;
  duration_sec: number;
  rpe: string | number | null;
  movement: RegionRefs;
};

export async function recomputeRegionState(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ updated: number; firstDate: string | null; lastDate: string | null }> {
  const { data: sessions, error: se } = await supabase
    .from("sessions")
    .select("id, performed_at, duration_min, session_rpe")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .order("performed_at", { ascending: true });
  if (se) throw new Error(se.message);

  if (!sessions || sessions.length === 0) {
    await supabase.from("region_state").delete().eq("user_id", userId);
    return { updated: 0, firstDate: null, lastDate: null };
  }

  const sessionIds = sessions.map((s) => s.id);

  const { data: setsRaw, error: setError } = await supabase
    .from("set_logs")
    .select("session_id, movement:movements(primary_region, secondary_regions)")
    .in("session_id", sessionIds);
  if (setError) throw new Error(setError.message);

  const { data: cardioRaw, error: cardioError } = await supabase
    .from("cardio_logs")
    .select(
      "session_id, duration_sec, rpe, movement:movements(primary_region, secondary_regions)",
    )
    .in("session_id", sessionIds);
  if (cardioError) throw new Error(cardioError.message);

  const sets = (setsRaw ?? []).map((s) => ({
    session_id: s.session_id,
    movement: normaliseMovement(s.movement),
  })) as SetRow[];
  const cardio = (cardioRaw ?? []).map((c) => ({
    session_id: c.session_id,
    duration_sec: c.duration_sec,
    rpe: c.rpe,
    movement: normaliseMovement(c.movement),
  })) as CardioRow[];

  const dailyLoad: Record<Region, Map<string, number>> = Object.fromEntries(
    REGIONS.map((r) => [r, new Map<string, number>()]),
  ) as Record<Region, Map<string, number>>;

  const setsBySession = new Map<string, SetRow[]>();
  for (const s of sets) {
    const list = setsBySession.get(s.session_id) ?? [];
    list.push(s);
    setsBySession.set(s.session_id, list);
  }
  const cardioBySession = new Map<string, CardioRow[]>();
  for (const c of cardio) {
    const list = cardioBySession.get(c.session_id) ?? [];
    list.push(c);
    cardioBySession.set(c.session_id, list);
  }

  for (const sessionRow of sessions) {
    const session = sessionRow as SessionRow;
    const dateIso = session.performed_at.slice(0, 10);
    const totalLoad = computeSessionLoad(session);
    if (totalLoad <= 0) continue;

    const regionWeights = new Map<Region, number>();
    const sessionSets = setsBySession.get(session.id) ?? [];
    const sessionCardio = cardioBySession.get(session.id) ?? [];

    for (const s of sessionSets) addMovementWeights(regionWeights, s.movement);
    for (const c of sessionCardio) addMovementWeights(regionWeights, c.movement);

    if (regionWeights.size === 0) continue;
    const totalWeight = [...regionWeights.values()].reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) continue;

    for (const [region, weight] of regionWeights) {
      const coeff = weight / totalWeight;
      const load = totalLoad * coeff;
      const prev = dailyLoad[region].get(dateIso) ?? 0;
      dailyLoad[region].set(dateIso, prev + load);
    }
  }

  const firstDate = (sessions[0]!.performed_at as string).slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);

  const upserts = REGIONS.map((region) => {
    const series = dailyLoad[region];
    const atl = finalEwma(series, firstDate, todayIso, 7);
    const ctl = finalEwma(series, firstDate, todayIso, 28);
    const baselineTolerance = ctl * 1.0;
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
  // Supabase may return movement as an array when the relationship is
  // expressed as a foreign-key reference; unwrap to a single object.
  if (Array.isArray(m)) {
    const first = m[0];
    if (!first) return null;
    return first as RegionRefs;
  }
  return m as RegionRefs;
}

function computeSessionLoad(session: SessionRow): number {
  const dur = session.duration_min ?? null;
  const rpe = session.session_rpe == null ? null : Number(session.session_rpe);
  if (dur && rpe) return dur * rpe;
  if (dur && !rpe) return dur * 6;
  return 0;
}

function addMovementWeights(
  weights: Map<Region, number>,
  movement: RegionRefs,
): void {
  if (!movement) return;
  weights.set(
    movement.primary_region,
    (weights.get(movement.primary_region) ?? 0) + PRIMARY_REGION_WEIGHT,
  );
  const secondary = movement.secondary_regions;
  if (Array.isArray(secondary)) {
    for (const r of secondary as string[]) {
      if ((REGIONS as readonly string[]).includes(r)) {
        const region = r as Region;
        weights.set(region, (weights.get(region) ?? 0) + SECONDARY_REGION_WEIGHT);
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
