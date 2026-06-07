/**
 * getCardioAnalysis — deep, read-only analysis of the user's cardio /
 * endurance training over a configurable lookback window.
 *
 * Pure composition of existing stats helpers (no new engine logic, no
 * new constants):
 *   - per-modality volume / avg-HR / session count from a single
 *     grouped read of `cardio_logs` (RLS via parent session ids,
 *     mirroring `getRecentSessions`) + `minutesByModalityFromCardioLogs`.
 *   - HR-zone minutes + polarized split from `getHrZones` /
 *     `polarisedSplit` (`@/lib/stats/hr-zones`).
 *   - pace trend from `getEnduranceProgress` and pace PRs from
 *     `getPacePrs`.
 *   - planned-vs-actual cardio adherence from `getRunPlanAdherence`.
 *   - strength-interference scalar from `cardioBlocksFromLogs` +
 *     `computeConcurrentScalarFromBlocks`.
 *
 * Every sub-object is nullable: a failing or empty helper degrades via
 * `safe(...)` to null/empty and is flagged in `data_gaps` rather than
 * throwing. The handler never reaches for a service-role client — every
 * query is scoped to `ctx.userId`.
 */
import { z } from "zod";
import type { Tool, ToolContext } from "./types";
import { clamp } from "./types";

import type { HrZoneState } from "@/lib/stats/hr-zones";
import type { PacePrState } from "@/lib/stats/pace-prs";
import type { EnduranceProgress } from "@/lib/stats/endurance-progress";
import type { AdherenceData } from "@/lib/stats/run-plan-adherence";

const modalitySchema = z.object({
  modality: z.string(),
  minutes: z.number(),
  sessions: z.number().int(),
  avg_hr_bpm: z.number().nullable(),
});

const hrZonesSchema = z
  .object({
    z1_min: z.number(),
    z2_min: z.number(),
    z3_min: z.number(),
    z4_min: z.number(),
    z5_min: z.number(),
  })
  .nullable();

const polarizedSchema = z
  .object({
    easy_pct: z.number(),
    threshold_pct: z.number(),
    hard_pct: z.number(),
  })
  .nullable();

const paceTrendSchema = z
  .object({
    direction: z.string(),
    mean_pace_sec_per_km: z.number().nullable(),
  })
  .nullable();

const pacePrSchema = z.object({
  distance: z.string(),
  time_sec: z.number().nullable(),
  improved: z.boolean().nullable(),
});

const adherenceSchema = z
  .object({
    weeks_window: z.number().int(),
    recent_pct: z.number().nullable(),
  })
  .nullable();

const interferenceSchema = z
  .object({
    scalar: z.number(),
    note: z.string(),
  })
  .nullable();

const outputSchema = z.object({
  window_days: z.number().int(),
  modality_breakdown: z.array(modalitySchema),
  hr_zones: hrZonesSchema,
  polarized_split: polarizedSchema,
  pace_trend: paceTrendSchema,
  pace_prs: z.array(pacePrSchema),
  run_plan_adherence: adherenceSchema,
  strength_interference: interferenceSchema,
  data_gaps: z.array(z.string()),
});

const inputSchema = z
  .object({
    daysBack: z
      .number()
      .int()
      .min(7)
      .max(365)
      .optional()
      .describe("How many days back to analyze (7-365, default 90)."),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const DEFAULT_DAYS = 90;
const MAX_PRS = 5;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

type CardioRow = {
  session_id: string;
  modality: string | null;
  duration_sec: number | null;
  avg_hr_bpm: number | null;
  hr_zones?: unknown;
  rpe?: number | null;
};

/**
 * Grouped read of the user's cardio_logs in the window. RLS is enforced
 * by first resolving the user's owned, non-deleted session ids (the
 * `sessions` query filters by `user_id`), then restricting the cardio
 * read to those ids — exactly the pattern `getRecentSessions` uses. The
 * in-code `ids.has(...)` filter guarantees a cardio log on another
 * user's session can never surface even if the row read is broad.
 */
async function readCardioRows(
  ctx: ToolContext,
  daysBack: number,
): Promise<CardioRow[]> {
  const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString();

  const { data: sessionRows } = await ctx.supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .gte("performed_at", cutoff);

  const ids = new Set(
    ((sessionRows ?? []) as Array<{ id: string }>).map((s) => s.id),
  );
  if (ids.size === 0) return [];

  const { data: cardioRows } = await ctx.supabase
    .from("cardio_logs")
    .select("session_id, modality, duration_sec, avg_hr_bpm, hr_zones, rpe")
    .in("session_id", Array.from(ids));

  return ((cardioRows ?? []) as CardioRow[]).filter((r) =>
    ids.has(r.session_id),
  );
}

/**
 * Per-modality volume + session count + average HR. Minutes come from
 * the shared `minutesByModalityFromCardioLogs` helper; session count
 * and avg-HR are a small extra pass over the same rows using the same
 * modality key derivation.
 */
function buildModalityBreakdown(
  rows: CardioRow[],
  minutesByModality: Record<string, number>,
): Output["modality_breakdown"] {
  const agg = new Map<
    string,
    { sessions: Set<string>; hrSum: number; hrCount: number }
  >();
  for (const r of rows) {
    const minutes = (r.duration_sec ?? 0) / 60;
    if (minutes <= 0) continue;
    const key = (r.modality ?? "").trim().toLowerCase() || "other";
    const cur = agg.get(key) ?? { sessions: new Set<string>(), hrSum: 0, hrCount: 0 };
    cur.sessions.add(r.session_id);
    const hr = r.avg_hr_bpm == null ? null : Number(r.avg_hr_bpm);
    if (hr != null && Number.isFinite(hr) && hr > 0) {
      cur.hrSum += hr;
      cur.hrCount += 1;
    }
    agg.set(key, cur);
  }

  return Object.entries(minutesByModality)
    .map(([modality, minutes]) => {
      const a = agg.get(modality);
      return {
        modality,
        minutes: Math.round(minutes),
        sessions: a ? a.sessions.size : 0,
        avg_hr_bpm: a && a.hrCount > 0 ? Math.round(a.hrSum / a.hrCount) : null,
      };
    })
    .sort((x, y) => y.minutes - x.minutes);
}

export const getCardioAnalysis: Tool<Input, Output> = {
  name: "getCardioAnalysis",
  description:
    "Deep analysis of the user's cardio/endurance training over the last N days — per-modality volume and average HR, HR-zone distribution and polarized (easy/threshold/hard) split, pace trend and PRs, run-plan adherence, and how cardio is interfering with strength. Use for any endurance/cardio question (running, zones, polarization, pace, recovery load from cardio).",
  inputSchema,
  outputSchema,
  async handler(input, ctx) {
    const daysBack = clamp(input.daysBack ?? DEFAULT_DAYS, 7, 365);
    const weeksWindow = clamp(Math.ceil(daysBack / 7), 1, 52);

    // Lazy-load helpers to keep the catalogue tree-shakeable.
    const [hrMod, pacePrMod, enduranceMod, adherenceMod, volumeMod, scalarMod] =
      await Promise.all([
        import("@/lib/stats/hr-zones"),
        import("@/lib/stats/pace-prs"),
        import("@/lib/stats/endurance-progress"),
        import("@/lib/stats/run-plan-adherence"),
        import("@/lib/stats/muscle-volume"),
        import("@/lib/engine/concurrent-scalar"),
      ]);

    const [cardioRows, hrState, pacePrState, endurance, adherence] =
      await Promise.all([
        safe(() => readCardioRows(ctx, daysBack), [] as CardioRow[]),
        safe<HrZoneState>(
          () => hrMod.getHrZones(ctx.supabase, ctx.userId, ctx.tz, daysBack),
          { kind: "no-strava" },
        ),
        safe<PacePrState>(
          () => pacePrMod.getPacePrs(ctx.supabase, ctx.userId, ctx.tz),
          { kind: "no-strava" },
        ),
        safe<EnduranceProgress | null>(
          () =>
            enduranceMod.getEnduranceProgress(
              ctx.supabase,
              ctx.userId,
              ctx.tz,
              daysBack,
            ),
          null,
        ),
        safe<AdherenceData | null>(
          () =>
            adherenceMod.getRunPlanAdherence(
              ctx.supabase,
              ctx.userId,
              ctx.tz,
              weeksWindow,
            ),
          null,
        ),
      ]);

    const minutesByModality = volumeMod.minutesByModalityFromCardioLogs(cardioRows);
    const modality_breakdown = buildModalityBreakdown(cardioRows, minutesByModality);

    // HR zones + polarized split.
    let hr_zones: Output["hr_zones"] = null;
    let polarized_split: Output["polarized_split"] = null;
    if (hrState.kind === "ok") {
      hr_zones = {
        z1_min: Math.round(hrState.totals.Z1 / 60),
        z2_min: Math.round(hrState.totals.Z2 / 60),
        z3_min: Math.round(hrState.totals.Z3 / 60),
        z4_min: Math.round(hrState.totals.Z4 / 60),
        z5_min: Math.round(hrState.totals.Z5 / 60),
      };
      const split = hrMod.polarisedSplit(hrState.totals);
      polarized_split = {
        easy_pct: round3(split.easyPct),
        threshold_pct: round3(split.thresholdPct),
        hard_pct: round3(split.hardPct),
      };
    }

    // Pace trend (running-specific; null when no run data).
    let pace_trend: Output["pace_trend"] = null;
    if (endurance && endurance.direction !== "no-run-data") {
      pace_trend = {
        direction: endurance.direction,
        mean_pace_sec_per_km: endurance.easyPaceSecPerKm,
      };
    }

    // Pace PRs (cap the array).
    const pace_prs: Output["pace_prs"] =
      pacePrState.kind === "ok"
        ? pacePrState.rows.slice(0, MAX_PRS).map((r) => ({
            distance: r.label,
            time_sec: r.current?.timeSec ?? null,
            improved: r.deltaSec == null ? null : r.deltaSec > 0,
          }))
        : [];

    // Run-plan adherence — most recent week's session ratio.
    let run_plan_adherence: Output["run_plan_adherence"] = null;
    if (adherence) {
      const weeks = adherence.weeks ?? [];
      let recent_pct: number | null = null;
      for (let i = weeks.length - 1; i >= 0; i--) {
        const pct = weeks[i]?.sessionsPct;
        if (pct != null) {
          recent_pct = round3(pct);
          break;
        }
      }
      run_plan_adherence = { weeks_window: weeksWindow, recent_pct };
    }

    // Strength interference scalar from per-block cardio (1.0 = none).
    let strength_interference: Output["strength_interference"] = null;
    const blocks = volumeMod.cardioBlocksFromLogs(cardioRows);
    if (blocks.length > 0) {
      const scalar = scalarMod.computeConcurrentScalarFromBlocks(blocks);
      const note =
        scalar >= 0.99
          ? "No measurable cardio interference on strength volume."
          : `Cardio load compresses strength volume ceilings to ~${Math.round(
              scalar * 100,
            )}% of baseline.`;
      strength_interference = { scalar: round3(scalar), note };
    }

    // Honest gaps so the model can explain what's missing.
    const data_gaps: string[] = [];
    if (cardioRows.length === 0) data_gaps.push("no cardio logged in window");
    if (hrState.kind === "no-strava") data_gaps.push("no Strava connected");
    else if (hrState.kind === "no-zones") data_gaps.push("no HR-zone config");
    else if (hrState.kind === "no-hr-data") data_gaps.push("no cardio with HR data");
    if (pacePrState.kind === "no-runs") data_gaps.push("no runs with pace data");
    if (!pace_trend && endurance && endurance.direction === "no-run-data") {
      data_gaps.push("no easy-run pace trend");
    }
    if (!adherence || !adherence.hasPlan) {
      data_gaps.push("no run plan to compare against");
    }
    if (!strength_interference) {
      data_gaps.push("no cardio to assess strength interference");
    }

    return {
      window_days: daysBack,
      modality_breakdown,
      hr_zones,
      polarized_split,
      pace_trend,
      pace_prs,
      run_plan_adherence,
      strength_interference,
      data_gaps: Array.from(new Set(data_gaps)),
    };
  },
};
