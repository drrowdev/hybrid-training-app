/**
 * Endurance progress — honest, running-specific pace trend.
 *
 * Pace at constant effort is the textbook endurance-progress signal: at
 * the same heart-rate / RPE band, faster pace = better aerobic fitness
 * (Daniels' VDOT, Coggan's IF). We restrict the slope to **easy runs**
 * so we're comparing like-for-like effort — mixing in a tempo session
 * would dominate the slope with intensity-driven variance rather than
 * fitness change.
 *
 * Easy-run filter (HEURISTIC / CP-1)
 * ──────────────────────────────────
 * A cardio_logs row counts as an easy run when ALL of these hold:
 *   - modality is "run"
 *   - it has a non-null `avg_pace_sec_per_km`
 *   - EITHER `inferred_kind === "cardio_z2"` (the easy/Z2 class produced
 *     by `lib/integrations/strava/classify-cardio.ts` on Strava import,
 *     which is the system's canonical "easy" label)
 *   - OR `avg_hr_bpm` is present AND falls inside the user's Z1∪Z2
 *     bands per `lib/stats/hr-zones.ts` (we fetch the same band config
 *     `getHrZones` uses, so the two cards stay coherent).
 * Rows without a Z2 tag AND without HR can't be honestly classified —
 * they're dropped from the slope (and counted in `droppedRuns` so the
 * card can footnote it).
 *
 * Pace is bucketed by ISO week (Monday-anchored) → mean pace per week
 * → least-squares slope. Slope unit is sec/km per week. **Improving =
 * pace DECREASING (faster)**, so `slope < -ε` is direction "up".
 *
 * No-run gating
 * ─────────────
 * If the user has zero runs in the window (e.g. a cyclist / rower), we
 * return `direction: "no-run-data"` and DO NOT fabricate a trend from
 * non-run cardio — power and pace aren't comparable, and forcing a
 * verdict here would silently mislead. The zone distribution
 * (`getHrZones`) still ships so the user sees their intensity split.
 *
 * Read-only / no engine inputs (mirrors `readiness.ts`): this surface
 * never feeds `buildPrescription` or `getCeilingExplain`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getHrZones,
  type HrZoneState,
  type ZoneBands,
  readZoneConfig,
  zoneForBpm,
} from "./hr-zones";
import { mondayOfYmd } from "@/lib/dates";

/**
 * Slope magnitude below which the pace trend counts as "flat". Tuned
 * for display only — see strength-progress's epsilon note. 1 sec/km/week
 * over a 12-week window = 12 sec/km total, well above week-to-week noise
 * but small enough that real fitness moves still register.
 *
 * HEURISTIC / CP-1.
 */
export const ENDURANCE_PACE_SLOPE_EPSILON_SEC_PER_KM_PER_WEEK = 1.0;

/** Minimum easy-run weeks before the slope is fit at all. */
export const ENDURANCE_MIN_WEEKS = 3;

export type EnduranceDirection =
  | "up"
  | "flat"
  | "down"
  | "no-run-data"
  | "building";

export type EnduranceProgress = {
  direction: EnduranceDirection;
  /** Mean pace across the easy-run sample, sec/km. null when no samples. */
  easyPaceSecPerKm: number | null;
  /** Pace slope sec/km per week. Negative = improving. null when insufficient data. */
  slopeSecPerKmPerWeek: number | null;
  /** Easy-run rows that fed the slope. */
  sampleRuns: number;
  /** Run rows excluded because we couldn't classify their effort. */
  droppedRuns: number;
  /** Total run rows in window (for the card's "X of Y runs were easy" note). */
  totalRuns: number;
  /** Pass-through of the time-in-zone distribution. */
  timeInZone: HrZoneState;
  /** Chronological per-week mean easy-run pace (sec/km) for the drawer sparkline. Display only. */
  weeklyPace: number[];
  detail: string;
  windowDays: number;
};

export type EasyRunSample = {
  /** Performed_at as ISO; only the date is used for bucketing. */
  performedAt: string;
  /** Pace in sec/km. */
  avgPaceSecPerKm: number;
};

/**
 * Pure pace-slope classifier. Buckets easy-run samples by ISO week,
 * means within each week, fits a least-squares slope, and classifies
 * direction against the epsilon. Exposed so unit tests can drive the
 * faster / slower / flat / insufficient matrix deterministically.
 */
export function classifyPaceSlope(samples: readonly EasyRunSample[]): {
  direction: EnduranceDirection;
  easyPaceSecPerKm: number | null;
  slopeSecPerKmPerWeek: number | null;
  /** Chronological per-week mean pace (sec/km) — display-only sparkline series. */
  weeklyPace: number[];
} {
  if (samples.length === 0) {
    return { direction: "no-run-data", easyPaceSecPerKm: null, slopeSecPerKmPerWeek: null, weeklyPace: [] };
  }
  const meanPace =
    samples.reduce((acc, s) => acc + s.avgPaceSecPerKm, 0) / samples.length;

  const byWeek = new Map<string, { sum: number; count: number }>();
  for (const s of samples) {
    const ymd = s.performedAt.slice(0, 10);
    const monday = mondayOfYmd(ymd);
    const bucket = byWeek.get(monday) ?? { sum: 0, count: 0 };
    bucket.sum += s.avgPaceSecPerKm;
    bucket.count += 1;
    byWeek.set(monday, bucket);
  }

  // Chronological per-week mean pace (rounded to whole sec/km), reused for the
  // slope fit below and exposed for the endurance drawer's pace sparkline.
  const weeklyPace = Array.from(byWeek.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, v]) => Math.round(v.sum / v.count));

  if (byWeek.size < ENDURANCE_MIN_WEEKS) {
    return {
      direction: "building",
      easyPaceSecPerKm: Math.round(meanPace),
      slopeSecPerKmPerWeek: null,
      weeklyPace,
    };
  }

  // Sort weeks chronologically and least-squares against week index (so
  // slope unit is "per week" directly — no day → week conversion needed).
  const weeks = Array.from(byWeek.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, v]) => v.sum / v.count);
  const n = weeks.length;
  const xs = weeks.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = weeks.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (weeks[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  if (den === 0) {
    return {
      direction: "flat",
      easyPaceSecPerKm: Math.round(meanPace),
      slopeSecPerKmPerWeek: 0,
      weeklyPace,
    };
  }
  const slopePerWeek = num / den;

  let direction: EnduranceDirection;
  if (Math.abs(slopePerWeek) < ENDURANCE_PACE_SLOPE_EPSILON_SEC_PER_KM_PER_WEEK) {
    direction = "flat";
  } else if (slopePerWeek < 0) {
    // Pace dropping = faster = improving.
    direction = "up";
  } else {
    direction = "down";
  }

  return {
    direction,
    easyPaceSecPerKm: Math.round(meanPace),
    slopeSecPerKmPerWeek: Math.round(slopePerWeek * 10) / 10,
    weeklyPace,
  };
}

/** Human detail string mirroring the readiness / strength patterns. */
function detailFor(
  direction: EnduranceDirection,
  sampleRuns: number,
  totalRuns: number,
  slope: number | null,
): string {
  if (direction === "no-run-data") {
    return totalRuns === 0
      ? "No runs logged in this window yet — the pace trend is running-specific."
      : `Logged ${totalRuns} run${totalRuns === 1 ? "" : "s"} but none could be classed as easy (no effort tag or heart-rate), so there's no pace trend yet.`;
  }
  if (direction === "building") {
    return `Only ${sampleRuns} easy run${sampleRuns === 1 ? "" : "s"} so far.`;
  }
  if (slope == null) return "Easy pace is holding steady.";
  const absRound = Math.round(Math.abs(slope));
  if (direction === "up") return `Getting faster at the same effort — about ${absRound} sec/km quicker each week, across ${sampleRuns} runs.`;
  if (direction === "down") return `Slowing at the same effort — about ${absRound} sec/km slower each week, across ${sampleRuns} runs.`;
  return `Easy pace is holding steady across ${sampleRuns} runs.`;
}

type CardioRow = {
  modality: string | null;
  avg_pace_sec_per_km: number | null;
  avg_hr_bpm: number | null;
  inferred_kind: string | null;
  session:
    | { performed_at: string; user_id?: string; deleted_at?: string | null }
    | Array<{ performed_at: string; user_id?: string; deleted_at?: string | null }>
    | null;
};

/**
 * Read-side wrapper. Three parallel reads (cardio_logs joined to
 * sessions, the user's HR-zone config off `profiles.intake`, and the
 * existing `getHrZones` card data) then pure pace-slope classification.
 *
 * Read path only — user-scoped Supabase client, `.eq("user_id", userId)`
 * via the !inner session join, no service-role.
 */
export async function getEnduranceProgress(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  windowDays: number,
): Promise<EnduranceProgress> {
  const sinceIso = new Date(
    Date.now() - windowDays * 86_400_000,
  ).toISOString();

  const [{ data: rows }, { data: profile }, timeInZone] = await Promise.all([
    supabase
      .from("cardio_logs")
      .select(
        "modality, avg_pace_sec_per_km, avg_hr_bpm, inferred_kind, session:sessions!inner(performed_at, user_id, deleted_at)",
      )
      .eq("session.user_id", userId)
      .is("session.deleted_at", null)
      .gte("session.performed_at", sinceIso),
    supabase.from("profiles").select("intake").eq("id", userId).maybeSingle(),
    getHrZones(supabase, userId, tz, 30),
  ]);

  const bands: ZoneBands | null = readZoneConfig(
    (profile?.intake as Record<string, unknown> | null) ?? null,
  );

  const samples: EasyRunSample[] = [];
  let totalRuns = 0;
  let droppedRuns = 0;
  for (const r of (rows ?? []) as CardioRow[]) {
    if (r.modality !== "run") continue;
    totalRuns += 1;
    const s = Array.isArray(r.session) ? r.session[0] : r.session;
    if (!s?.performed_at) {
      droppedRuns += 1;
      continue;
    }
    if (r.avg_pace_sec_per_km == null || !Number.isFinite(Number(r.avg_pace_sec_per_km))) {
      droppedRuns += 1;
      continue;
    }
    const pace = Number(r.avg_pace_sec_per_km);
    if (pace <= 0) {
      droppedRuns += 1;
      continue;
    }
    const isZ2Tag = r.inferred_kind === "cardio_z2";
    let isEasyByHr = false;
    if (!isZ2Tag && bands && r.avg_hr_bpm != null) {
      const bpm = Number(r.avg_hr_bpm);
      if (Number.isFinite(bpm) && bpm > 0) {
        const z = zoneForBpm(bpm, bands);
        isEasyByHr = z === "Z1" || z === "Z2";
      }
    }
    if (!isZ2Tag && !isEasyByHr) {
      droppedRuns += 1;
      continue;
    }
    samples.push({ performedAt: s.performed_at, avgPaceSecPerKm: pace });
  }

  const classification = classifyPaceSlope(samples);

  return {
    direction: classification.direction,
    easyPaceSecPerKm: classification.easyPaceSecPerKm,
    slopeSecPerKmPerWeek: classification.slopeSecPerKmPerWeek,
    sampleRuns: samples.length,
    droppedRuns,
    totalRuns,
    timeInZone,
    weeklyPace: classification.weeklyPace,
    detail: detailFor(
      classification.direction,
      samples.length,
      totalRuns,
      classification.slopeSecPerKmPerWeek,
    ),
    windowDays,
  };
}
