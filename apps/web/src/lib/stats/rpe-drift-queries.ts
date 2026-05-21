/**
 * Session-RPE drift over the last 28 days.
 *
 * Rising sRPE at constant load is a leading deload indicator (v2 §5):
 * the same prescribed work feels harder when accumulated fatigue is
 * outpacing recovery. We surface the raw points + a least-squares slope
 * so the user (and the engine) can see whether the trend is up or flat.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type RpeDriftPoint = {
  date: string;
  rpe: number;
  sessionId: string;
};

export type RpeDrift = {
  points: RpeDriftPoint[];
  /** Slope in sRPE-units per day. Positive = rising. */
  slopePerDay: number;
  /** Plain-language verdict for the user. */
  verdict: "no-data" | "stable" | "rising" | "easing";
  verdictLabel: string;
  /** Mean sRPE across the window. */
  meanRpe: number | null;
};

const LOOKBACK_DAYS = 28;
const STABLE_THRESHOLD = 0.02; // ~0.6 sRPE shift over 28d = stable
const RISING_THRESHOLD = 0.04; // ~1.1 sRPE shift over 28d = rising

export async function getRpeDrift(
  supabase: SupabaseClient,
  userId: string,
): Promise<RpeDrift> {
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data } = await supabase
    .from("sessions")
    .select("id, performed_at, session_rpe")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .not("session_rpe", "is", null)
    .gte("performed_at", sinceIso)
    .order("performed_at", { ascending: true });

  if (!data || data.length === 0) {
    return {
      points: [],
      slopePerDay: 0,
      verdict: "no-data",
      verdictLabel: "Not enough sessions yet",
      meanRpe: null,
    };
  }

  const points: RpeDriftPoint[] = data
    .filter((s) => s.session_rpe != null)
    .map((s) => ({
      date: s.performed_at.slice(0, 10),
      rpe: Number(s.session_rpe),
      sessionId: s.id,
    }));

  const slopePerDay = leastSquaresSlope(points);
  const meanRpe = points.reduce((a, p) => a + p.rpe, 0) / points.length;

  let verdict: RpeDrift["verdict"];
  let verdictLabel: string;
  if (points.length < 4) {
    verdict = "no-data";
    verdictLabel = "Need a few more sessions";
  } else if (slopePerDay >= RISING_THRESHOLD) {
    verdict = "rising";
    verdictLabel = "Rising — accumulating fatigue, consider a lighter week";
  } else if (slopePerDay >= STABLE_THRESHOLD) {
    verdict = "rising";
    verdictLabel = "Edging up — watch the trend";
  } else if (slopePerDay <= -STABLE_THRESHOLD) {
    verdict = "easing";
    verdictLabel = "Easing — work is feeling lighter";
  } else {
    verdict = "stable";
    verdictLabel = "Stable — on the rails";
  }

  return { points, slopePerDay, verdict, verdictLabel, meanRpe };
}

/**
 * Pure least-squares slope helper. Time axis is days since the first
 * point so the resulting slope unit is sRPE-per-day.
 */
export function leastSquaresSlope(points: { date: string; rpe: number }[]): number {
  if (points.length < 2) return 0;
  const t0 = new Date(points[0]!.date + "T00:00:00").getTime();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    const days = (new Date(p.date + "T00:00:00").getTime() - t0) / 86_400_000;
    xs.push(days);
    ys.push(p.rpe);
  }
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}
