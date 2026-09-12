import {
  MAX_POOL_LENGTHS, formatPoolCourse, formatSwimDistance, isValidPoolCourse,
  swimErr, swimOk, type PoolCourse, type SwimResult,
} from "./swimming";

export const DEFAULT_SWIM_POOL: PoolCourse = { numerator: 50, denominator: 1, unit: "m" };
export const SWIM_POOL_CHANGE_VERSION = "swim-pool-1" as const;

export function swimmingPool(
  original: PoolCourse, programme?: PoolCourse, workout?: PoolCourse,
): PoolCourse {
  return workout ?? programme ?? original;
}

/** Preserve physical distance exactly, including rational courses and native yards. */
export function changeSwimLengths(
  lengths: number, from: PoolCourse, to: PoolCourse,
): SwimResult<number> {
  if (!isValidPoolCourse(from) || !isValidPoolCourse(to)) return swimErr("course_invalid", "Choose a valid pool length.");
  if (!Number.isSafeInteger(lengths) || lengths < 1 || lengths > MAX_POOL_LENGTHS) {
    return swimErr("lengths_invalid", "Choose a valid whole-length distance.");
  }
  const numerator = BigInt(lengths) * BigInt(from.numerator) * BigInt(to.denominator)
    * BigInt(from.unit === "yd" ? 9144 : 10000);
  const denominator = BigInt(from.denominator) * BigInt(to.numerator)
    * BigInt(to.unit === "yd" ? 9144 : 10000);
  if (numerator % denominator !== BigInt(0)) {
    return swimErr("distance_not_whole_lengths",
      `${formatSwimDistance(lengths, from)} does not fit whole lengths of a ${formatPoolCourse(to)} pool. Choose another pool or adjust this repeat first.`);
  }
  const next = numerator / denominator;
  if (next > BigInt(MAX_POOL_LENGTHS)) return swimErr("lengths_out_of_range", "This exceeds the workout's length limit.");
  return swimOk(Number(next));
}
