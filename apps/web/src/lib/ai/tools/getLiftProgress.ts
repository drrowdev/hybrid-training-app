/**
 * getLiftProgress — deep, read-only strength-progression analysis for a
 * single named lift.
 *
 * Pure composition of existing `@/lib/stats/movement` helpers (no new
 * engine logic, no new constants): a small movement resolver + the
 * working-set rollups (top set / RPE / volume), the linear-regression
 * slope, RPE-creep detection, the current training max, and a tiny
 * `tm_history` read for the TM change log.
 *
 * The tool returns DATA only — the model synthesises coaching advice
 * from it (and should combine it with `getKnowledge`). Every external
 * call is wrapped in `safe(...)` so a failing/empty helper degrades to
 * null/empty + a `data_gaps` entry rather than throwing. The handler
 * never reaches for a service-role client — every query is scoped to
 * `ctx.userId`.
 */
import { z } from "zod";
import type { Tool, ToolContext } from "./types";
import { clamp } from "./types";

const movementSchema = z
  .object({
    id: z.string(),
    slug: z.string().nullable(),
    displayName: z.string(),
  })
  .nullable();

const currentSchema = z.object({
  e1rm: z.number().nullable(),
  tm_kg: z.number().nullable(),
});

const trendPointSchema = z.object({
  date: z.string(),
  e1rm: z.number(),
});

const e1rmTrendSchema = z.object({
  slope_per_week: z.number().nullable(),
  points: z.array(trendPointSchema),
});

const topSetSchema = z.object({
  date: z.string(),
  weight_kg: z.number(),
  reps: z.number().int(),
  rpe: z.number().nullable(),
  e1rm: z.number(),
  is_pr: z.boolean(),
});

const tmHistorySchema = z.object({
  changed_at: z.string(),
  old_tm_kg: z.number().nullable(),
  new_tm_kg: z.number(),
  reason: z.string(),
});

const rpeCreepSchema = z.object({
  flagged: z.boolean(),
  rpe_delta: z.number().nullable(),
  weight_delta_kg: z.number().nullable(),
});

const assessmentSchema = z.object({
  direction: z.enum(["up", "flat", "down", "stalled"]),
  signal: z.string(),
});

const outputSchema = z.object({
  found: z.boolean(),
  movement: movementSchema,
  current: currentSchema,
  e1rm_trend: e1rmTrendSchema,
  best_ever_e1rm: z.number().nullable(),
  recent_top_sets: z.array(topSetSchema),
  tm_history: z.array(tmHistorySchema),
  rpe_creep: rpeCreepSchema,
  assessment: assessmentSchema,
  data_gaps: z.array(z.string()),
});

const inputSchema = z
  .object({
    movement: z
      .string()
      .min(1)
      .describe(
        "Lift name, e.g. 'bench press' or 'squat' — matched to your movements.",
      ),
    weeksBack: z
      .number()
      .int()
      .min(1)
      .max(104)
      .optional()
      .describe("Lookback window in weeks (default 26)."),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const DEFAULT_WEEKS = 26;
const MAX_TREND_POINTS = 12;
const MAX_TOP_SETS = 8;
const MAX_TM_HISTORY = 6;

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

export type ResolvedMovement = { id: string; slug: string | null; displayName: string };

type MovementRow = {
  id: string;
  slug: string | null;
  display_name: string | null;
  user_id: string | null;
};

/**
 * Resolve a free-text lift name to one of the movements the user can
 * see (global seeds where `user_id IS NULL`, plus their own owned
 * movements). We fetch the two visibility sets separately and merge by
 * id — equivalent to `user_id IS NULL OR user_id = <userId>` without
 * relying on `.or()` interpolation. Ranking: exact display_name match >
 * exact slug match > startsWith > substring; ties break to the shorter
 * display name.
 */
async function resolveMovement(
  ctx: ToolContext,
  query: string,
): Promise<ResolvedMovement | null> {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const select = "id, slug, display_name, user_id";
  const [ownedRes, globalRes] = await Promise.all([
    safe(
      async () =>
        (
          await ctx.supabase
            .from("movements")
            .select(select)
            .eq("user_id", ctx.userId)
        ).data as MovementRow[] | null,
      null as MovementRow[] | null,
    ),
    safe(
      async () =>
        (
          await ctx.supabase
            .from("movements")
            .select(select)
            .is("user_id", null)
        ).data as MovementRow[] | null,
      null as MovementRow[] | null,
    ),
  ]);

  const byId = new Map<string, MovementRow>();
  for (const r of [...(ownedRes ?? []), ...(globalRes ?? [])]) {
    if (r && typeof r.id === "string") byId.set(r.id, r);
  }
  const candidates = Array.from(byId.values());
  if (candidates.length === 0) return null;

  function rank(r: MovementRow): number {
    const name = (r.display_name ?? "").trim().toLowerCase();
    const slug = (r.slug ?? "").trim().toLowerCase();
    if (name === needle) return 5;
    if (slug === needle) return 4;
    if (name.startsWith(needle) || slug.startsWith(needle)) return 3;
    if (name.includes(needle) || slug.includes(needle)) return 2;
    return 0;
  }

  let best: MovementRow | null = null;
  let bestRank = 0;
  for (const r of candidates) {
    const score = rank(r);
    if (score === 0) continue;
    const name = (r.display_name ?? "").trim();
    if (
      score > bestRank ||
      (score === bestRank &&
        best != null &&
        name.length < (best.display_name ?? "").trim().length)
    ) {
      best = r;
      bestRank = score;
    }
  }

  if (!best) return null;
  return {
    id: best.id,
    slug: best.slug ?? null,
    displayName: (best.display_name ?? "").trim() || best.id,
  };
}

type TmHistoryRow = {
  changed_at: string;
  old_tm_kg: number | string | null;
  new_tm_kg: number | string | null;
  reason: string | null;
};

/** Most-recent-first training-max change log for `(user, movement)`. */
async function readTmHistory(
  ctx: ToolContext,
  movementId: string,
): Promise<Output["tm_history"]> {
  const { data } = await ctx.supabase
    .from("tm_history")
    .select("changed_at, old_tm_kg, new_tm_kg, reason")
    .eq("user_id", ctx.userId)
    .eq("movement_id", movementId)
    .order("changed_at", { ascending: false });

  const rows = (data ?? []) as TmHistoryRow[];
  return rows.slice(0, MAX_TM_HISTORY).map((r) => {
    const oldTm = r.old_tm_kg == null ? null : Number(r.old_tm_kg);
    const newTm = Number(r.new_tm_kg);
    return {
      changed_at: r.changed_at,
      old_tm_kg: oldTm != null && Number.isFinite(oldTm) ? round1(oldTm) : null,
      new_tm_kg: Number.isFinite(newTm) ? round1(newTm) : 0,
      reason: r.reason ?? "",
    };
  });
}

function emptyOutput(query: string): Output {
  return {
    found: false,
    movement: null,
    current: { e1rm: null, tm_kg: null },
    e1rm_trend: { slope_per_week: null, points: [] },
    best_ever_e1rm: null,
    recent_top_sets: [],
    tm_history: [],
    rpe_creep: { flagged: false, rpe_delta: null, weight_delta_kg: null },
    assessment: { direction: "flat", signal: "no data for this lift" },
    data_gaps: [`movement not found: ${query.trim()}`],
  };
}

export const getLiftProgress: Tool<Input, Output> = {
  name: "getLiftProgress",
  description:
    "Deep per-lift strength progression for a named lift — resolves the movement, then returns current estimated 1RM (e1RM) and training max, the e1RM trend over time, recent top sets (weight × reps @ RPE), training-max change history, an RPE-creep / stall signal, and a plain progress assessment. Use for questions like 'how has my bench developed?' or 'has my squat stalled?'. The model should combine this with getKnowledge to advise how to improve.",
  inputSchema,
  outputSchema,
  async handler(input, ctx) {
    const weeksBack = clamp(input.weeksBack ?? DEFAULT_WEEKS, 1, 104);

    const resolved = await safe<ResolvedMovement | null>(
      () => resolveMovement(ctx, input.movement),
      null,
    );
    if (!resolved) return emptyOutput(input.movement);

    const mv = await import("@/lib/stats/movement");

    const allSets = await safe(
      () => mv.getWorkingSetsForMovement(ctx.supabase, ctx.userId, resolved.id),
      [] as Awaited<ReturnType<typeof mv.getWorkingSetsForMovement>>,
    );

    const cutoff = Date.now() - weeksBack * 7 * 86_400_000;
    const sets = allSets.filter((r) => +new Date(r.performedAt) >= cutoff);

    const topSeries = mv.rollupTopSetsPerSession(sets);
    const rpeSeries = mv.rollupRpePerSession(sets);
    const slopePerDay = mv.linearRegressionSlopePerDay(
      topSeries.map((p) => ({ performedAt: p.performedAt, e1rm: p.e1rm })),
    );
    const slopePerWeek = slopePerDay == null ? null : round1(slopePerDay * 7);

    const creep = mv.detectRpeCreep(rpeSeries);

    const [tmKg, tmHistory] = await Promise.all([
      safe(() => mv.getCurrentTm(ctx.supabase, ctx.userId, resolved.id), null),
      safe(() => readTmHistory(ctx, resolved.id), [] as Output["tm_history"]),
    ]);

    const currentE1rm = mv.getCurrentE1rmFromSeries(topSeries);
    const bestEver = mv.getBestEverE1rmFromSeries(topSeries);

    // e1RM trend points, oldest→newest, capped to the most recent N.
    const trendPoints = topSeries
      .slice(-MAX_TREND_POINTS)
      .map((p) => ({ date: p.performedAt.slice(0, 10), e1rm: round1(p.e1rm) }));

    // Most recent top sets, newest-first then capped.
    const recentTopSets = topSeries
      .slice(-MAX_TOP_SETS)
      .reverse()
      .map((p) => ({
        date: p.performedAt.slice(0, 10),
        weight_kg: round1(p.weight),
        reps: p.reps,
        rpe: p.rpe == null ? null : round1(p.rpe),
        e1rm: round1(p.e1rm),
        is_pr: p.isPR,
      }));

    const rpe_creep: Output["rpe_creep"] = {
      flagged: creep.flagged,
      rpe_delta: creep.rpeDelta == null ? null : round1(creep.rpeDelta),
      weight_delta_kg:
        creep.weightDelta == null ? null : round1(creep.weightDelta),
    };

    // Direction from the per-week slope; flat upgrades to "stalled" when
    // RPE creep is flagged (rising effort, flat/falling output).
    let direction: Output["assessment"]["direction"];
    if (slopePerWeek == null) direction = "flat";
    else if (slopePerWeek >= 0.25) direction = "up";
    else if (slopePerWeek <= -0.25) direction = "down";
    else direction = "flat";
    if (direction === "flat" && rpe_creep.flagged) direction = "stalled";

    const sessionCount = topSeries.length;
    const slopeText =
      slopePerWeek == null
        ? "trend unavailable"
        : `e1RM ${slopePerWeek >= 0 ? "+" : ""}${slopePerWeek.toFixed(
            1,
          )} kg/wk over ${sessionCount} session${sessionCount === 1 ? "" : "s"}`;
    const rpeText = rpe_creep.flagged
      ? `RPE creeping (+${(rpe_creep.rpe_delta ?? 0).toFixed(1)})`
      : "RPE steady";
    const signal = `${slopeText}; ${rpeText}`;

    const data_gaps: string[] = [];
    if (sets.length === 0) {
      data_gaps.push("no logged sets for this lift in window");
    }
    if (tmKg == null) data_gaps.push("no training max set");
    if (sessionCount > 0 && sessionCount < 3) {
      data_gaps.push("fewer than 3 data points — trend unreliable");
    }
    if (tmHistory.length === 0) data_gaps.push("no training-max change history");

    return {
      found: true,
      movement: {
        id: resolved.id,
        slug: resolved.slug,
        displayName: resolved.displayName,
      },
      current: {
        e1rm: currentE1rm == null ? null : round1(currentE1rm),
        tm_kg: tmKg == null ? null : round1(tmKg),
      },
      e1rm_trend: { slope_per_week: slopePerWeek, points: trendPoints },
      best_ever_e1rm: bestEver == null ? null : round1(bestEver.e1rm),
      recent_top_sets: recentTopSets,
      tm_history: tmHistory,
      rpe_creep,
      assessment: { direction, signal },
      data_gaps: Array.from(new Set(data_gaps)),
    };
  },
};
