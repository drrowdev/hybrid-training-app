/**
 * The one place a prescription item turns into a load in kg.
 *
 * Three surfaces answer "what weight is this set?" — the plan materialiser that
 * writes the planned sets, the live logger's prefill, and the prescribed
 * snapshot recorded against every log. They ran three copies of the same sum,
 * which is how weighted pull-ups came to be prescribed as a percentage of a
 * bodyweight-inclusive max with the bodyweight still in it. One home (plan
 * §6.9) so they cannot disagree again.
 */
import { addedLoadFromSystemLoad } from "./system-load";

export type TargetLoadInput = {
  /** Percentage of the working max (40 = 40%), when the item is %-anchored. */
  percentTm?: number | null;
  /** Concrete kg the engine resolved itself (warm-up ramps, hand-entered work). */
  targetWeightKg?: number | null;
};

export type TargetLoadContext = {
  /** Resolved working max in kg for this movement, or null when unanchored. */
  tmKg?: number | null | undefined;
  /**
   * True when this movement's max is a SYSTEM load — bodyweight plus belt
   * (weighted pull-ups / dips). A percentage of it is a total, so the load to
   * add is that total minus bodyweight.
   */
  isSystemLoad?: boolean;
  /** The lifter's bodyweight in kg. Required to resolve a system-load percentage. */
  bodyweightKg?: number | null | undefined;
  /** Plate-rounding hook so storage matches the displayed load exactly. */
  roundKg?: (kg: number) => number;
  /**
   * Rounding for an ALREADY-CONCRETE `targetWeightKg`. Defaults to leaving it
   * alone: a hand-entered rehab / external-cardio load is the lifter's own
   * number and snapping it to a plate increment would rewrite it.
   */
  roundAbsoluteKg?: (kg: number) => number;
};

function num(v: number | null | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Resolve the prescribed load, or null when the prescription doesn't determine
 * one.
 *
 * Null is a real answer and must not be papered over: an unanchored movement,
 * or a system-load movement for a lifter who has never recorded a bodyweight,
 * genuinely has no prescribed load. Guessing one is how a warm-up ends up
 * heavier than the lifter.
 */
export function resolveTargetLoadKg(
  item: TargetLoadInput | null | undefined,
  ctx: TargetLoadContext = {},
): number | null {
  if (!item) return null;
  const round = ctx.roundKg ?? ((kg: number) => kg);

  const percentTm = num(item.percentTm);
  const tmKg = num(ctx.tmKg);
  if (percentTm != null && tmKg != null && tmKg > 0) {
    const rawKg = (tmKg * percentTm) / 100;
    if (!ctx.isSystemLoad) return round(rawKg);
    const bodyweightKg = num(ctx.bodyweightKg);
    if (bodyweightKg == null || bodyweightKg <= 0) return null;
    return addedLoadFromSystemLoad(rawKg, bodyweightKg, round);
  }

  const absolute = num(item.targetWeightKg);
  // A system-load engine already resolved its ramp to an ADDED load, so an
  // explicit 0 means "bodyweight" and is a prescription, not a missing value.
  if (absolute != null && (absolute > 0 || (ctx.isSystemLoad && absolute === 0))) {
    const roundAbsolute = ctx.roundAbsoluteKg ?? ((kg: number) => kg);
    return roundAbsolute(absolute);
  }
  return null;
}
