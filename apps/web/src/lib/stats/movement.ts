/**
 * Per-movement stats helpers.
 *
 * Reads set_logs for a single movement, derives:
 *  - e1RM curve (Epley)
 *  - weekly volume buckets
 *  - RPE histogram
 *  - PR + last-performed metadata
 *
 * Anything fancier (1RM models with RPE adjustment, true PR by rep range)
 * lives in @hta/engine; this is the display layer.
 */
import { createClient } from "@/lib/supabase/server";
import { mondayOfYmd, ymdInTimezone } from "@/lib/dates";

export type MovementSet = {
  id: string;
  performed_at: string;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  set_kind: string;
};

export type MovementHeader = {
  id: string;
  slug: string;
  display_name: string;
  primary_region: string;
  is_compound: boolean;
};

/** Epley e1RM. Returns null for sets without weight+reps. */
export function epleyE1RM(weight: number, reps: number): number | null {
  if (!weight || !reps) return null;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

export async function getMovementBySlug(slug: string): Promise<MovementHeader | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("movements")
    .select("id, slug, display_name, primary_region, is_compound")
    .eq("slug", slug)
    .is("user_id", null)
    .maybeSingle();
  return data ?? null;
}

export async function getSetsForMovement(movementId: string): Promise<MovementSet[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("set_logs")
    .select(
      "id, weight_kg, reps, rpe, set_kind, session:sessions(performed_at, completed_at)",
    )
    .eq("movement_id", movementId)
    .order("created_at", { ascending: true });

  if (!data) return [];
  return data
    .filter((r) => {
      const ss = Array.isArray(r.session) ? r.session[0] : r.session;
      return !!ss?.completed_at && r.weight_kg != null && r.reps != null;
    })
    .map((r) => {
      const ss = Array.isArray(r.session) ? r.session[0] : r.session;
      return {
        id: r.id,
        performed_at: ss!.performed_at,
        weight_kg: Number(r.weight_kg),
        reps: r.reps!,
        rpe: r.rpe == null ? null : Number(r.rpe),
        set_kind: r.set_kind,
      };
    });
}

export type WeeklyVolumePoint = { weekStart: string; volume: number; sets: number };

/**
 * Bucket sets into weekly volume rows keyed by the Monday (YYYY-MM-DD)
 * of each set's week. `userTz` is the user's IANA timezone — we want
 * "the Monday of the week the user perceived the workout happening
 * in", which depends on local wall-clock time. Without a tz the bucket
 * key drifts at midnight.
 */
export function bucketWeeklyVolume(sets: MovementSet[], userTz: string): WeeklyVolumePoint[] {
  if (sets.length === 0) return [];
  const buckets = new Map<string, { volume: number; sets: number }>();
  for (const s of sets) {
    const localYmd = ymdInTimezone(new Date(s.performed_at), userTz);
    const key = mondayOfYmd(localYmd);
    const existing = buckets.get(key) ?? { volume: 0, sets: 0 };
    existing.volume += s.weight_kg * s.reps;
    existing.sets += 1;
    buckets.set(key, existing);
  }
  return Array.from(buckets.entries())
    .map(([weekStart, v]) => ({ weekStart, ...v }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function rpeHistogram(sets: MovementSet[]): { rpe: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const s of sets) {
    if (s.rpe == null) continue;
    const bucket = Math.round(s.rpe);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const result: { rpe: number; count: number }[] = [];
  for (let i = 1; i <= 10; i++) result.push({ rpe: i, count: counts.get(i) ?? 0 });
  return result;
}

export type E1rmPoint = { date: string; e1rm: number; weight: number; reps: number };

export function e1rmCurve(sets: MovementSet[]): E1rmPoint[] {
  return sets
    .map((s) => {
      const e1 = epleyE1RM(s.weight_kg, s.reps);
      if (e1 == null) return null;
      return {
        date: s.performed_at.slice(0, 10),
        e1rm: e1,
        weight: s.weight_kg,
        reps: s.reps,
      };
    })
    .filter((x): x is E1rmPoint => x != null);
}

/** Top-level summary tiles. */
export function summarise(sets: MovementSet[]) {
  if (sets.length === 0) {
    return {
      totalSets: 0,
      totalVolume: 0,
      bestE1rm: null as number | null,
      heaviestSingle: 0,
      lastPerformed: null as string | null,
    };
  }
  let bestE1rm = 0;
  let heaviestSingle = 0;
  let totalVolume = 0;
  for (const s of sets) {
    totalVolume += s.weight_kg * s.reps;
    const e1 = epleyE1RM(s.weight_kg, s.reps);
    if (e1 != null && e1 > bestE1rm) bestE1rm = e1;
    if (s.reps === 1 && s.weight_kg > heaviestSingle) heaviestSingle = s.weight_kg;
  }
  const last = sets[sets.length - 1]!;
  return {
    totalSets: sets.length,
    totalVolume: Math.round(totalVolume),
    bestE1rm: bestE1rm || null,
    heaviestSingle,
    lastPerformed: last.performed_at,
  };
}

/** Top movements by hard-set count for the current user. */
export type MovementListRow = {
  movementId: string;
  slug: string;
  displayName: string;
  setCount: number;
  lastPerformed: string;
};

export async function listMovementsRanked(): Promise<MovementListRow[]> {
  const supabase = await createClient();
  // We can't do a group-by from PostgREST easily; pull recent sets and aggregate in JS.
  const { data } = await supabase
    .from("set_logs")
    .select(
      "movement_id, session:sessions(performed_at, completed_at), movement:movements(slug, display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (!data) return [];

  const map = new Map<string, MovementListRow>();
  for (const r of data) {
    const ss = Array.isArray(r.session) ? r.session[0] : r.session;
    if (!ss?.completed_at) continue;
    const mv = Array.isArray(r.movement) ? r.movement[0] : r.movement;
    if (!mv) continue;
    const existing = map.get(r.movement_id);
    if (existing) {
      existing.setCount += 1;
      if (ss.performed_at > existing.lastPerformed) existing.lastPerformed = ss.performed_at;
    } else {
      map.set(r.movement_id, {
        movementId: r.movement_id,
        slug: mv.slug,
        displayName: mv.display_name,
        setCount: 1,
        lastPerformed: ss.performed_at,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.setCount - a.setCount);
}
