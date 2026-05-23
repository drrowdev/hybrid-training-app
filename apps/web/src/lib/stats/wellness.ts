/**
 * Wellness dashboard helpers — Phase 3.
 *
 * Backs `/app/stats/wellness`. Two I/O wrappers read user-scoped data
 * (`public.wellness` rows for daily check-ins, `public.sessions` for
 * pre-session fatigue/soreness + post-session sRPE). Both queries
 * respect the existing RLS policies (`wellness_self`,
 * `sessions_*_self`) — they filter `eq("user_id", userId)` defensively
 * even though the policy enforces it server-side.
 *
 * The two pure aggregators (`calcPredictionCorrelation`, `linearTrend`)
 * are exported separately so unit tests can pin the math against
 * fixture arrays without touching Supabase.
 *
 * DC-* references:
 *   - DC-P1: pre-session check-in (`sessions.fatigue`, `sessions.soreness`).
 *   - DC-A2: post-session sRPE (`sessions.session_rpe`).
 *
 * Sleep is persisted exclusively to `wellness.sleep_hours` — the
 * pre-session sleep chip writes through `buildWellnessUpsertCols`
 * (see `lib/wellness/check-in.ts`), so there is no duplicate path
 * to de-dupe here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd, todayYmd } from "@/lib/dates";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type WellnessRow = {
  date: string;
  bodyweight_kg: number | null;
  sleep_hours: number | null;
  motivation: number | null;
};

export type SessionWellnessRow = {
  /** ISO timestamp from sessions.performed_at. */
  performed_at: string;
  fatigue: number | null;
  soreness: number | null;
  session_rpe: number | null;
};

export type PredictionPair = {
  /** Combined pre-session score = fatigue + soreness (range 2..10). */
  pre: number;
  /** Post-session sRPE (0..10). */
  rpe: number;
};

export type PredictionStrength =
  | "weak"
  | "moderate"
  | "strong"
  | "very strong";

// ──────────────────────────────────────────────────────────────────────
// I/O wrappers
// ──────────────────────────────────────────────────────────────────────

/**
 * Return one row per date for the wellness check-in series within the
 * range. `windowDays = null` ⇒ all-time. Ordered oldest → newest.
 *
 * Includes only the user's own rows (RLS enforces this; the `eq` is
 * defence-in-depth).
 */
export async function getWellnessTimeseries(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  windowDays: number | null,
): Promise<WellnessRow[]> {
  const today = todayYmd(tz);
  let query = supabase
    .from("wellness")
    .select("date, bodyweight_kg, sleep_hours, motivation")
    .eq("user_id", userId)
    .lte("date", today)
    .order("date", { ascending: true });
  if (windowDays != null) {
    const earliest = addDaysToYmd(today, -(windowDays - 1));
    query = query.gte("date", earliest);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  type Raw = {
    date: string;
    bodyweight_kg: number | string | null;
    sleep_hours: number | string | null;
    motivation: number | string | null;
  };
  return ((data ?? []) as Raw[]).map((r) => ({
    date: r.date,
    bodyweight_kg: r.bodyweight_kg == null ? null : Number(r.bodyweight_kg),
    sleep_hours: r.sleep_hours == null ? null : Number(r.sleep_hours),
    motivation: r.motivation == null ? null : Number(r.motivation),
  }));
}

/**
 * Return per-session wellness rows (pre-session fatigue/soreness +
 * post-session sRPE) for the range. Filters out soft-deleted sessions
 * (`deleted_at IS NULL`). Ordered oldest → newest by `performed_at`.
 */
export async function getSessionWellness(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  windowDays: number | null,
): Promise<SessionWellnessRow[]> {
  const today = todayYmd(tz);
  let query = supabase
    .from("sessions")
    .select("performed_at, fatigue, soreness, session_rpe")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("performed_at", { ascending: true });
  if (windowDays != null) {
    // performed_at is a timestamptz — bound it to the start of the
    // window in user-tz, but since timestamps don't have a tz-aware
    // YMD floor we use UTC midnight, which gives an at-worst 1-day
    // generous bound (the page renders the date in user-tz anyway).
    const earliest = addDaysToYmd(today, -(windowDays - 1));
    query = query.gte("performed_at", `${earliest}T00:00:00Z`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  type Raw = {
    performed_at: string;
    fatigue: number | string | null;
    soreness: number | string | null;
    session_rpe: number | string | null;
  };
  return ((data ?? []) as Raw[]).map((r) => ({
    performed_at: r.performed_at,
    fatigue: r.fatigue == null ? null : Number(r.fatigue),
    soreness: r.soreness == null ? null : Number(r.soreness),
    session_rpe: r.session_rpe == null ? null : Number(r.session_rpe),
  }));
}

// ──────────────────────────────────────────────────────────────────────
// Pure math
// ──────────────────────────────────────────────────────────────────────

/**
 * Build the input pairs for the prediction-accuracy correlation from
 * a list of session rows. A session contributes one pair iff it has
 * both pre-check-in fields (fatigue + soreness) and a post-session
 * sRPE recorded. Returns `null` for sessions missing any of the three.
 */
export function predictionPairsFromSessions(
  rows: ReadonlyArray<SessionWellnessRow>,
): PredictionPair[] {
  const out: PredictionPair[] = [];
  for (const r of rows) {
    if (r.fatigue == null || r.soreness == null || r.session_rpe == null) continue;
    out.push({ pre: r.fatigue + r.soreness, rpe: r.session_rpe });
  }
  return out;
}

/**
 * Pearson correlation coefficient between `pre` and `rpe` over the
 * supplied pairs. Returns `null` when n < 10 (per the Phase 3 spec:
 * the card refuses to render below that sample size) or when one of
 * the series has zero variance (correlation is undefined). Output is
 * clamped to `[-1, 1]` to absorb floating-point overshoot.
 */
export function calcPredictionCorrelation(
  pairs: ReadonlyArray<PredictionPair>,
): number | null {
  const n = pairs.length;
  if (n < 10) return null;
  let sumX = 0;
  let sumY = 0;
  for (const p of pairs) {
    sumX += p.pre;
    sumY += p.rpe;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (const p of pairs) {
    const dx = p.pre - meanX;
    const dy = p.rpe - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  const r = num / Math.sqrt(denX * denY);
  if (!Number.isFinite(r)) return null;
  return Math.max(-1, Math.min(1, r));
}

/**
 * Bucket a correlation `r` into the four strength bands from the
 * Phase 3 spec. Uses `|r|` so anti-correlation also gets labelled
 * (rare in practice, but a "very strong" -0.85 still tells the user
 * something — they're predicting the right magnitude but wrong sign).
 */
export function predictionStrength(r: number): PredictionStrength {
  const abs = Math.abs(r);
  if (abs < 0.3) return "weak";
  if (abs < 0.5) return "moderate";
  if (abs < 0.7) return "strong";
  return "very strong";
}

/**
 * Plain linear regression slope (units = value-units per index step).
 * Useful for "trend hints" — e.g. bodyweight slope per day. Returns
 * `null` when fewer than two values, since a slope is undefined.
 *
 * Coefficient is computed via the textbook closed-form
 *   slope = Σ(x_i − x̄)(y_i − ȳ) / Σ(x_i − x̄)²
 * with x_i = i (the array index). Callers that want per-day slope on
 * a date-indexed series should ensure the input is already daily-
 * sampled (or downsample first); this function doesn't know about
 * dates.
 */
export function linearTrend(values: ReadonlyArray<number>): number | null {
  const n = values.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2; // mean of 0..n-1
  let meanY = 0;
  for (const v of values) meanY += v;
  meanY /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    const dy = values[i] - meanY;
    num += dx * dy;
    den += dx * dx;
  }
  if (den === 0) return null;
  return num / den;
}

/**
 * Predicted values along the regression line for a series — same
 * length as `values`. Used to overlay the trend line on the
 * bodyweight chart. Returns `null` when the slope is undefined.
 */
export function linearTrendSeries(
  values: ReadonlyArray<number>,
): number[] | null {
  const slope = linearTrend(values);
  if (slope == null) return null;
  const n = values.length;
  const meanX = (n - 1) / 2;
  let meanY = 0;
  for (const v of values) meanY += v;
  meanY /= n;
  const intercept = meanY - slope * meanX;
  return Array.from({ length: n }, (_, i) => intercept + slope * i);
}

/**
 * Centred rolling mean over a numeric series; window = `w` items.
 * Entries with fewer than `w` neighbours collapse to `null` so the
 * overlay doesn't bend toward an undersampled tail. Used for the
 * 7-night sleep overlay (Phase 3 A2).
 */
export function rollingMean(
  values: ReadonlyArray<number>,
  w: number,
): Array<number | null> {
  const n = values.length;
  if (w <= 1) return values.slice() as number[];
  const out: Array<number | null> = new Array(n).fill(null);
  if (n < w) return out;
  let sum = 0;
  for (let i = 0; i < w; i++) sum += values[i];
  out[w - 1] = sum / w;
  for (let i = w; i < n; i++) {
    sum += values[i] - values[i - w];
    out[i] = sum / w;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Sleep color bucketing — A2 helper
// ──────────────────────────────────────────────────────────────────────

export type SleepBucket = "low" | "ok" | "good";

/**
 * Bucket a single night's sleep_hours into A2's color band:
 *   - <6h  → "low"  (red, danger)
 *   - 6–7h → "ok"   (warning)
 *   - ≥7h  → "good" (success; >9h does not get penalised per spec)
 *
 * The boundaries follow the half-open convention `[lo, hi)` so 6.0h
 * falls into "ok" and 7.0h into "good".
 */
export function sleepBucket(hours: number): SleepBucket {
  if (hours < 6) return "low";
  if (hours < 7) return "ok";
  return "good";
}

export function sleepBucketColor(b: SleepBucket): string {
  switch (b) {
    case "low":
      return "var(--cp-danger)";
    case "ok":
      return "var(--cp-warning)";
    case "good":
      return "var(--cp-success)";
  }
}
