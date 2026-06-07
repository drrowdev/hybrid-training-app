/**
 * getBodyweightTrend — read-only bodyweight-trajectory analysis over a
 * configurable lookback window, interpreted against the user's declared
 * body-composition phase.
 *
 * Reads `wellness.bodyweight_kg` rows in the window (RLS via `user_id`),
 * plus the `profiles` body-comp phase columns, and returns: the latest
 * weight, the net delta across the window, a least-squares slope in both
 * kg/week and %-bodyweight/week, a capped oldest-first series, the
 * declared phase (gain / maintain / lean_out) with weeks elapsed vs
 * target, and a plain direction + phase-alignment assessment.
 *
 * The tool returns DATA only — it does NOT judge whether the rate is
 * "healthy" (that's coaching the model layers on via getKnowledge). It
 * only reports the numbers, the direction, and whether the direction
 * matches the declared phase. Failing/empty reads degrade to
 * null/empty + a `data_gaps` entry rather than throwing. Every query is
 * scoped to `ctx.userId`; no service-role client.
 */
import { z } from "zod";
import type { Tool } from "./types";
import { clamp } from "./types";
import { addDaysToYmd, todayYmd } from "@/lib/dates";

const pointSchema = z.object({
  date: z.string(),
  kg: z.number(),
});

const phaseSchema = z.object({
  declared: z.enum(["gain", "maintain", "lean_out"]).nullable(),
  weeks_elapsed: z.number().nullable(),
  target_weeks: z.number().int().nullable(),
});

const assessmentSchema = z.object({
  direction: z.enum(["gaining", "losing", "stable"]),
  aligned_with_phase: z.boolean().nullable(),
  signal: z.string(),
});

const outputSchema = z.object({
  window_days: z.number().int(),
  latest: pointSchema.nullable(),
  delta_kg: z.number().nullable(),
  slope_kg_per_week: z.number().nullable(),
  slope_pct_bw_per_week: z.number().nullable(),
  num_entries: z.number().int(),
  series: z.array(pointSchema),
  phase: phaseSchema,
  assessment: assessmentSchema,
  data_gaps: z.array(z.string()),
});

const inputSchema = z
  .object({
    daysBack: z
      .number()
      .int()
      .min(14)
      .max(365)
      .optional()
      .describe("How many days back to analyze (14-365, default 90)."),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const DEFAULT_DAYS = 90;
const MAX_SERIES_POINTS = 24;
/**
 * Noise floor for the direction verdict. A slope flatter than this (in
 * %-bodyweight per week) reads as "stable" rather than gaining/losing —
 * day-to-day scale noise (water, food, etc.) easily swamps a true trend
 * smaller than this. Presentation-only; not an engine constant.
 */
const STABLE_BAND_PCT_PER_WEEK = 0.1;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type WellnessRow = { date: string; bodyweight_kg: number | string | null };

type ProfileRow = {
  body_comp_phase: string | null;
  phase_started_at: string | null;
  phase_target_weeks: number | null;
};

/** Least-squares slope in kg/day over (date, kg). Null if < 2 points or
 * all dates collapse to one x. */
function slopeKgPerDay(points: Output["series"]): number | null {
  if (points.length < 2) return null;
  const t0 = +new Date(points[0]!.date + "T00:00:00Z");
  const xs = points.map(
    (p) => (+new Date(p.date + "T00:00:00Z") - t0) / 86_400_000,
  );
  const ys = points.map((p) => p.kg);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

function phaseAlignment(
  declared: "gain" | "maintain" | "lean_out" | null,
  direction: "gaining" | "losing" | "stable",
): boolean | null {
  if (declared == null) return null;
  if (declared === "gain") return direction === "gaining";
  if (declared === "lean_out") return direction === "losing";
  return direction === "stable"; // maintain
}

export const getBodyweightTrend: Tool<Input, Output> = {
  name: "getBodyweightTrend",
  description:
    "Bodyweight trajectory over the last N days — latest weight, net change, trend slope (kg/week and %-bodyweight/week), the logged series, and the user's declared body-composition phase (gain / maintain / lean_out) with how the trend aligns to it. Use for questions like 'how's my weight trending', 'am I losing weight', or 'is my cut on track'. Combine with getKnowledge to advise whether the rate is appropriate.",
  inputSchema,
  outputSchema,
  async handler(input, ctx) {
    const daysBack = clamp(input.daysBack ?? DEFAULT_DAYS, 14, 365);
    const today = todayYmd(ctx.tz);
    const earliest = addDaysToYmd(today, -daysBack);

    const [wellnessRes, profileRes] = await Promise.all([
      safe(
        async () =>
          (
            await ctx.supabase
              .from("wellness")
              .select("date, bodyweight_kg")
              .eq("user_id", ctx.userId)
              .gte("date", earliest)
              .lte("date", today)
              .not("bodyweight_kg", "is", null)
              .order("date", { ascending: true })
          ).data as WellnessRow[] | null,
        null as WellnessRow[] | null,
      ),
      safe(
        async () =>
          (
            await ctx.supabase
              .from("profiles")
              .select("body_comp_phase, phase_started_at, phase_target_weeks")
              .eq("id", ctx.userId)
              .maybeSingle()
          ).data as ProfileRow | null,
        null as ProfileRow | null,
      ),
    ]);

    const allPoints: Output["series"] = (wellnessRes ?? [])
      .map((r) => ({ date: String(r.date), kg: Number(r.bodyweight_kg) }))
      .filter((p) => Number.isFinite(p.kg) && p.kg > 0);

    const numEntries = allPoints.length;
    const latest = numEntries > 0 ? allPoints[numEntries - 1]! : null;
    const earliestPoint = numEntries > 0 ? allPoints[0]! : null;

    const deltaKg =
      latest && earliestPoint && numEntries >= 2
        ? round1(latest.kg - earliestPoint.kg)
        : null;

    const perDay = slopeKgPerDay(allPoints);
    const slopeKgPerWeek = perDay == null ? null : round2(perDay * 7);
    const slopePctPerWeek =
      slopeKgPerWeek == null || latest == null || latest.kg <= 0
        ? null
        : round2((slopeKgPerWeek / latest.kg) * 100);

    // Direction from the %-bodyweight slope with a noise deadband. When
    // we can't compute a slope at all we fall back to "stable" and flag
    // the gap.
    let direction: Output["assessment"]["direction"] = "stable";
    if (slopePctPerWeek != null) {
      if (slopePctPerWeek > STABLE_BAND_PCT_PER_WEEK) direction = "gaining";
      else if (slopePctPerWeek < -STABLE_BAND_PCT_PER_WEEK) direction = "losing";
    }

    // Declared phase + weeks elapsed.
    const rawPhase = profileRes?.body_comp_phase ?? null;
    const declared: Output["phase"]["declared"] =
      rawPhase === "gain" || rawPhase === "maintain" || rawPhase === "lean_out"
        ? rawPhase
        : null;
    let weeksElapsed: number | null = null;
    if (profileRes?.phase_started_at) {
      const startMs = +new Date(profileRes.phase_started_at + "T00:00:00Z");
      const todayMs = +new Date(today + "T00:00:00Z");
      if (Number.isFinite(startMs) && todayMs >= startMs) {
        weeksElapsed = round1((todayMs - startMs) / (7 * 86_400_000));
      }
    }
    const targetWeeks =
      profileRes?.phase_target_weeks != null &&
      Number.isFinite(Number(profileRes.phase_target_weeks))
        ? Number(profileRes.phase_target_weeks)
        : null;

    const aligned = phaseAlignment(declared, direction);

    // Factual one-line signal — numbers only, no rate judgment.
    const rateText =
      slopeKgPerWeek == null
        ? "trend unavailable"
        : `${slopeKgPerWeek >= 0 ? "+" : ""}${slopeKgPerWeek.toFixed(
            2,
          )} kg/wk${
            slopePctPerWeek == null
              ? ""
              : ` (${slopePctPerWeek >= 0 ? "+" : ""}${slopePctPerWeek.toFixed(
                  2,
                )}%/wk)`
          } over ${numEntries} entr${numEntries === 1 ? "y" : "ies"}`;
    const phaseText =
      declared == null
        ? "no phase declared"
        : aligned === null
          ? `phase ${declared}`
          : aligned
            ? `aligned with ${declared} phase`
            : `NOT aligned with ${declared} phase`;
    const signal = `${direction}: ${rateText}; ${phaseText}`;

    // Cap the returned series to the most recent N (oldest-first).
    const series =
      allPoints.length > MAX_SERIES_POINTS
        ? allPoints.slice(-MAX_SERIES_POINTS)
        : allPoints;

    const data_gaps: string[] = [];
    if (numEntries === 0) data_gaps.push("no bodyweight logged in window");
    else if (numEntries < 3) {
      data_gaps.push("fewer than 3 weigh-ins — trend unreliable");
    }
    if (declared == null) data_gaps.push("no body-composition phase declared");

    return {
      window_days: daysBack,
      latest,
      delta_kg: deltaKg,
      slope_kg_per_week: slopeKgPerWeek,
      slope_pct_bw_per_week: slopePctPerWeek,
      num_entries: numEntries,
      series,
      phase: {
        declared,
        weeks_elapsed: weeksElapsed,
        target_weeks: targetWeeks,
      },
      assessment: { direction, aligned_with_phase: aligned, signal },
      data_gaps: Array.from(new Set(data_gaps)),
    };
  },
};
