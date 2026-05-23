/**
 * Per-bucket load + freshness for the engine state page.
 *
 * Walks completed sessions (last ~28 days) for the user, sums per-set +
 * per-cardio bucket loads into a per-day series, then applies the
 * standard ATL_b (7d EWMA) / CTL_b (28d EWMA) recurrence — same as
 * region freshness (DC-A5 / DC-C14) so the user-facing pattern stays
 * consistent.
 */
import { finalEwma } from "@hta/domain";
import type { Bucket } from "@hta/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALL_BUCKETS,
  setBucketLoad,
  cardioBucketLoad,
  addBucketLoads,
  ZERO_BUCKET_LOAD,
  type BucketLoad,
} from "@/lib/engine/bucket-load";
import { todayYmd } from "@/lib/dates";

const LOOKBACK_DAYS = 35; // a hair more than CTL window for clean EWMA

export type BucketStatusBand = "fresh" | "ready" | "lingering" | "recovering" | "heavily-loaded";

export type BucketStateRow = {
  bucket: Bucket;
  label: string;
  description: string;
  freshness: number;
  band: BucketStatusBand;
  bandLabel: string;
  tone: "ok" | "caution" | "warn";
  atl: number;
  ctl: number;
};

/** User-facing labels + one-line descriptions per bucket. */
export const BUCKET_DISPLAY: Record<Bucket, { label: string; description: string }> = {
  neural: {
    label: "Nervous system",
    description: "Heavy lifts and max efforts — recovery is slow but adaptation big.",
  },
  mechanical: {
    label: "Muscle work",
    description: "Total tonnage — how much pure volume you've moved.",
  },
  metabolic: {
    label: "Conditioning",
    description: "Lactate / breathing — hard cardio and high-rep work.",
  },
  impact: {
    label: "Pounding",
    description: "Running, plyo, heavy eccentrics — joints and connective tissue.",
  },
  axial: {
    label: "Spinal load",
    description: "Squats, deadlifts, OHP, loaded carries — back can only take so much.",
  },
  tissue: {
    label: "Tendons",
    description: "Tendons remodel slowly — very-heavy lifts and running add up.",
  },
};

function classifyBand(freshness: number): {
  band: BucketStatusBand;
  bandLabel: string;
  tone: "ok" | "caution" | "warn";
} {
  if (freshness >= 0.85) return { band: "fresh", bandLabel: "Fresh", tone: "ok" };
  if (freshness >= 0.55) return { band: "ready", bandLabel: "Ready", tone: "ok" };
  if (freshness >= 0.3) return { band: "lingering", bandLabel: "Light load lingering", tone: "caution" };
  if (freshness >= 0.1) return { band: "recovering", bandLabel: "Recovering", tone: "warn" };
  return { band: "heavily-loaded", bandLabel: "Heavily loaded", tone: "warn" };
}

type RegionRefs = {
  axial_load: string | null;
  high_strain_tendon: boolean;
} | null;

function normaliseMovement(m: unknown): RegionRefs {
  if (!m) return null;
  if (Array.isArray(m)) {
    const first = m[0];
    if (!first) return null;
    return first as RegionRefs;
  }
  return m as RegionRefs;
}

export async function getBucketState(
  supabase: SupabaseClient,
  userId: string,
  userTz: string,
): Promise<BucketStateRow[]> {
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .gte("performed_at", sinceIso)
    .order("performed_at", { ascending: true });

  if (!sessions || sessions.length === 0) {
    return ALL_BUCKETS.map((bucket) => ({
      bucket,
      label: BUCKET_DISPLAY[bucket].label,
      description: BUCKET_DISPLAY[bucket].description,
      freshness: 1.0,
      ...classifyBand(1.0),
      atl: 0,
      ctl: 0,
    }));
  }

  const sessionIds = sessions.map((s) => s.id);
  const performedAtById = new Map(sessions.map((s) => [s.id, s.performed_at as string]));

  const [setsRes, cardioRes] = await Promise.all([
    supabase
      .from("set_logs")
      .select("session_id, reps, weight_kg, rpe, set_kind, movement:movements(axial_load, high_strain_tendon)")
      .in("session_id", sessionIds)
      .not("reps", "is", null)
      .gt("reps", 0),
    supabase
      .from("cardio_logs")
      .select("session_id, duration_sec, rpe, modality")
      .in("session_id", sessionIds),
  ]);

  // Per-day per-bucket load series.
  const series: Record<Bucket, Map<string, number>> = Object.fromEntries(
    ALL_BUCKETS.map((b) => [b, new Map<string, number>()]),
  ) as Record<Bucket, Map<string, number>>;

  for (const row of setsRes.data ?? []) {
    if (row.set_kind === "warmup") continue;
    const performedAt = performedAtById.get(row.session_id);
    if (!performedAt) continue;
    const date = performedAt.slice(0, 10);
    const movement = normaliseMovement(row.movement) ?? { axial_load: "low", high_strain_tendon: false };
    const load = setBucketLoad(
      {
        reps: Number(row.reps),
        weightKg: Number(row.weight_kg ?? 0),
        rpe: row.rpe == null ? null : Number(row.rpe),
      },
      { axialLoad: movement.axial_load, highStrainTendon: movement.high_strain_tendon },
    );
    accumulate(series, date, load);
  }

  for (const row of cardioRes.data ?? []) {
    const performedAt = performedAtById.get(row.session_id);
    if (!performedAt) continue;
    const date = performedAt.slice(0, 10);
    const load = cardioBucketLoad({
      durationSec: row.duration_sec,
      rpe: row.rpe == null ? null : Number(row.rpe),
      modality: row.modality,
    });
    accumulate(series, date, load);
  }

  const firstDate = (sessions[0]!.performed_at as string).slice(0, 10);
  const todayIso = todayYmd(userTz);

  return ALL_BUCKETS.map((bucket) => {
    const atl = finalEwma(series[bucket], firstDate, todayIso, 7);
    const ctl = finalEwma(series[bucket], firstDate, todayIso, 28);
    const baseline = Math.max(ctl, 1); // floor for cold-start
    const freshness = Math.max(0, Math.min(1, 1 - atl / baseline));
    return {
      bucket,
      label: BUCKET_DISPLAY[bucket].label,
      description: BUCKET_DISPLAY[bucket].description,
      freshness,
      ...classifyBand(freshness),
      atl,
      ctl,
    };
  });
}

function accumulate(
  series: Record<Bucket, Map<string, number>>,
  date: string,
  load: BucketLoad,
): void {
  for (const bucket of ALL_BUCKETS) {
    const prev = series[bucket].get(date) ?? 0;
    series[bucket].set(date, prev + load[bucket]);
  }
}

export { ZERO_BUCKET_LOAD };
