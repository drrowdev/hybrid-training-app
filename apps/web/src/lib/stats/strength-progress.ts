/**
 * Strength progress — honest, body-wide verdict on whether the user's
 * main lifts are trending up, down, or holding.
 *
 * Per main lift we walk e1RM points over the window and fit a simple
 * least-squares slope (reusing `linearRegressionSlopePerDay` from
 * `movement.ts` — the same helper the per-movement detail page uses).
 * Slopes within ±epsilon (kg/week) count as "flat" so a noisy day-to-day
 * e1RM doesn't flip the verdict. Only the count of rising vs falling
 * lifts decides the body verdict — equal counts → "flat".
 *
 * "Main lift" identification
 * ──────────────────────────
 * A movement is treated as a main lift if the user has a
 * `training_maxes` row for it — that's the same canonical mapping the
 * engine (`tier-detection.ts`, `block-complete.ts`, `tm-bump-actions.ts`,
 * `bump-proposal.ts`) uses to decide what's "anchored". It covers the
 * four default roles (squat / horizontal_press / deadlift /
 * vertical_press) and any user-promoted main, without us having to
 * hard-code movement slugs here.
 *
 * Read-only / no engine inputs (mirrors `readiness.ts`): the verdict is
 * for display only and never feeds `buildPrescription` or
 * `getCeilingExplain`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { linearRegressionSlopePerDay } from "./movement";

/**
 * Slope magnitude below which a lift counts as "flat" rather than
 * up/down. Expressed in kg/week to match `formatSlopePerWeek`.
 *
 * HEURISTIC / CP-1 — picked low enough that a real 0.5 kg/week trend
 * over 8 weeks (4 kg of e1RM movement) still registers, but high enough
 * that single-rep noise on a 100 kg lift won't flip the verdict. Tuned
 * for display, not engine input; not calibrated.
 */
export const STRENGTH_SLOPE_EPSILON_KG_PER_WEEK = 0.25;

/**
 * Minimum e1RM points per lift before we'll classify direction. Two
 * points is the bare minimum the regression can fit; anything fewer is
 * "building" cold-start territory.
 */
export const STRENGTH_MIN_POINTS_PER_LIFT = 2;

/**
 * Minimum number of main lifts that pass the point threshold before we
 * even attempt a body verdict. Fewer than this and the body verdict is
 * "building" — there isn't enough breadth to claim a body-wide trend
 * from a single lift.
 */
export const STRENGTH_MIN_LIFTS_FOR_VERDICT = 2;

export type StrengthDirection = "up" | "flat" | "down" | "building";

export type StrengthPerLift = {
  movementId: string;
  /** Display name (movements.display_name) for the chip/tooltip. */
  label: string;
  /** Number of e1RM points the slope was fit over (within the window). */
  pointCount: number;
  /**
   * Slope in kg/week. null when there were fewer than
   * `STRENGTH_MIN_POINTS_PER_LIFT` points or the regression denominator
   * was zero (all points on the same day).
   */
  slopePerWeek: number | null;
  direction: StrengthDirection;
};

export type StrengthProgress = {
  direction: StrengthDirection;
  perLift: StrengthPerLift[];
  detail: string;
  windowDays: number;
};

export type StrengthLiftPoints = {
  movementId: string;
  label: string;
  /** e1RM points in chronological order. */
  points: Array<{ performedAt: string; e1rm: number }>;
};

/** Classify a single lift's slope given its sample count. */
function classifyLift(
  slopePerWeek: number | null,
  pointCount: number,
): StrengthDirection {
  if (slopePerWeek == null || pointCount < STRENGTH_MIN_POINTS_PER_LIFT) {
    return "building";
  }
  if (Math.abs(slopePerWeek) < STRENGTH_SLOPE_EPSILON_KG_PER_WEEK) return "flat";
  return slopePerWeek > 0 ? "up" : "down";
}

/**
 * Pure aggregator — exposed so the verdict matrix can be exercised
 * without a Supabase round-trip (mirrors `aggregateLoadBalance` /
 * `composeReadiness`).
 */
export function composeStrengthProgress(
  perLiftPoints: readonly StrengthLiftPoints[],
  windowDays: number,
): StrengthProgress {
  const perLift: StrengthPerLift[] = perLiftPoints.map((l) => {
    const slopePerDay = linearRegressionSlopePerDay(l.points);
    const slopePerWeek = slopePerDay == null ? null : slopePerDay * 7;
    return {
      movementId: l.movementId,
      label: l.label,
      pointCount: l.points.length,
      slopePerWeek,
      direction: classifyLift(slopePerWeek, l.points.length),
    };
  });

  const classifiable = perLift.filter(
    (l) => l.pointCount >= STRENGTH_MIN_POINTS_PER_LIFT && l.slopePerWeek != null,
  );

  if (classifiable.length < STRENGTH_MIN_LIFTS_FOR_VERDICT) {
    return {
      direction: "building",
      perLift,
      windowDays,
      detail:
        classifiable.length === 0
          ? `No main lift has ≥${STRENGTH_MIN_POINTS_PER_LIFT} logged sets in the last ${windowDays}d yet.`
          : `Only ${classifiable.length} main lift has enough history to trend — keep logging to unlock the body verdict.`,
    };
  }

  const up = classifiable.filter((l) => l.direction === "up").length;
  const down = classifiable.filter((l) => l.direction === "down").length;
  const flat = classifiable.filter((l) => l.direction === "flat").length;

  let direction: StrengthDirection;
  if (up > down) direction = "up";
  else if (down > up) direction = "down";
  else direction = "flat";

  const detail =
    direction === "up"
      ? `${up} of ${classifiable.length} main lifts trending up over the last ${windowDays}d.`
      : direction === "down"
        ? `${down} of ${classifiable.length} main lifts regressing over the last ${windowDays}d.`
        : `${flat} of ${classifiable.length} main lifts holding — no clear direction.`;

  return { direction, perLift, windowDays, detail };
}

type TmRow = { movement_id: string };
type SetRow = {
  weight_kg: number | string | null;
  reps: number | null;
  movement_id: string;
  movement?:
    | { id: string; display_name: string }
    | Array<{ id: string; display_name: string }>
    | null;
  session:
    | { performed_at: string }
    | Array<{ performed_at: string }>
    | null;
};

/** Epley e1RM — kept inline so we don't have to widen `movement.ts`. */
function epleyE1Rm(weight: number, reps: number): number | null {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

/**
 * Read-side wrapper. One round trip to find the user's main-lift
 * movement ids (via `training_maxes`), one round trip for the in-window
 * set_logs, then pure aggregation.
 *
 * Read path only — user-scoped Supabase client, `.eq("user_id", userId)`
 * on every query, no service-role.
 */
export async function getStrengthProgress(
  supabase: SupabaseClient,
  userId: string,
  _tz: string,
  windowDays: number,
): Promise<StrengthProgress> {
  // 1. Which movements does this user treat as main lifts?
  const { data: tms } = await supabase
    .from("training_maxes")
    .select("movement_id")
    .eq("user_id", userId);
  const mainIds = Array.from(
    new Set(((tms ?? []) as TmRow[]).map((r) => r.movement_id).filter(Boolean)),
  );
  if (mainIds.length === 0) {
    return {
      direction: "building",
      perLift: [],
      windowDays,
      detail: "No main lifts set up yet — add training maxes to unlock the body verdict.",
    };
  }

  // 2. Pull all in-window sets for those movements (joined to sessions
  //    so we can filter by performed_at + non-deleted + user_id).
  const sinceIso = new Date(
    Date.now() - windowDays * 86_400_000,
  ).toISOString();
  const { data: rows } = await supabase
    .from("set_logs")
    .select(
      "weight_kg, reps, movement_id, movement:movements(id, display_name), session:sessions!inner(performed_at, completed_at, deleted_at, user_id)",
    )
    .eq("session.user_id", userId)
    .is("session.deleted_at", null)
    .not("session.completed_at", "is", null)
    .gte("session.performed_at", sinceIso)
    .in("movement_id", mainIds)
    .eq("skipped", false)
    .neq("set_kind", "warmup")
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0);

  // 3. Bucket by movement → e1RM points (chronological).
  type Working = {
    movementId: string;
    label: string;
    points: Array<{ performedAt: string; e1rm: number }>;
  };
  const byMovement = new Map<string, Working>();
  for (const r of (rows ?? []) as SetRow[]) {
    const s = Array.isArray(r.session) ? r.session[0] : r.session;
    if (!s?.performed_at) continue;
    const weight = r.weight_kg == null ? 0 : Number(r.weight_kg);
    const reps = r.reps == null ? 0 : Number(r.reps);
    const e1 = epleyE1Rm(weight, reps);
    if (e1 == null) continue;
    const mv = Array.isArray(r.movement) ? r.movement[0] : r.movement;
    const label = mv?.display_name ?? r.movement_id;
    const bucket =
      byMovement.get(r.movement_id) ??
      ({ movementId: r.movement_id, label, points: [] } satisfies Working);
    bucket.points.push({ performedAt: s.performed_at, e1rm: e1 });
    byMovement.set(r.movement_id, bucket);
  }

  // 4. Ensure every main lift surfaces, even with zero in-window points.
  for (const id of mainIds) {
    if (!byMovement.has(id)) {
      byMovement.set(id, { movementId: id, label: id, points: [] });
    }
  }

  const perLiftPoints: StrengthLiftPoints[] = Array.from(byMovement.values())
    .map((w) => ({
      movementId: w.movementId,
      label: w.label,
      points: w.points.sort(
        (a, b) => +new Date(a.performedAt) - +new Date(b.performedAt),
      ),
    }));

  return composeStrengthProgress(perLiftPoints, windowDays);
}
