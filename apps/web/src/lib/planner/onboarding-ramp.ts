/**
 * Onboarding accessory-volume ramp.
 *
 * Beginner-tier users starting a brand-new block see a compressed
 * accessory budget for the first two weeks, then a partial step-up
 * in week three, then full prescribed volume from week four onwards.
 *
 * Structural principle (CP-5): the IOC consensus statement on load,
 * overload and injury risk (Soligard et al. 2016, BJSM 50(17),
 * 1030–1041, HIGH evidence on principle) observes that "athletes
 * respond significantly better to relatively small increases (and
 * decreases), rather than larger fluctuations in loading." Brand-new
 * trainees lack the connective-tissue tolerance reflected in the
 * archetype's full prescribed accessory volume, so we ramp them in.
 *
 * Calibration status (CP-3): heuristic schedule. Magnitudes map onto
 * the IOC principle qualitatively only — the exact 0.6 / 0.6 / 0.8 /
 * 1.0 progression is an engineering default, NOT a literature-derived
 * percentage. Replace once user-outcome data exists (CP-1: beginner
 * hypertrophy adherence + completion-quality outcomes).
 *
 * Only applies to `beginner_lt_6m` and `novice_6m_2y` declared-
 * experience tiers. Returns 1.0 for all other tiers, for `null`
 * (no declaration), and for any `blockWeekIndex >= 3`.
 */
import type { DeclaredExperience } from "@hta/engine";

// All four ramp constants are heuristic — no calibration data. CP-3.
const RAMP_WEEK_0 = 0.6; // heuristic, no calibration data
const RAMP_WEEK_1 = 0.6; // heuristic, no calibration data
const RAMP_WEEK_2 = 0.8; // heuristic, no calibration data
const RAMP_FULL = 1.0; // heuristic, no calibration data

const RAMPED_TIERS: ReadonlySet<DeclaredExperience> = new Set<DeclaredExperience>([
  "beginner_lt_6m",
  "novice_6m_2y",
]);

/**
 * Onboarding accessory-volume ramp scalar.
 *
 * @param experience  Declared experience tier, or `null` if undeclared.
 * @param blockWeekIndex  0-indexed week number within the current block
 *                        (0 = week 1, 1 = week 2, …).
 * @returns A scalar in `[0.6, 1.0]` to apply to per-muscle accessory
 *          targets and the accessory `maxItems` budget. Always `1.0`
 *          for non-beginner tiers and from week 4 onwards.
 */
export function onboardingRampScalar(
  experience: DeclaredExperience | null,
  blockWeekIndex: number,
): number {
  if (experience == null || !RAMPED_TIERS.has(experience)) return RAMP_FULL;
  if (blockWeekIndex >= 3) return RAMP_FULL;
  if (blockWeekIndex <= 0) return RAMP_WEEK_0;
  if (blockWeekIndex === 1) return RAMP_WEEK_1;
  return RAMP_WEEK_2; // blockWeekIndex === 2
}

// Floor for any positive target after scaling — a user always gets at
// least one set toward a muscle that was budgeted, even on the deepest
// ramp week. Heuristic. CP-3.
const PER_MUSCLE_TARGET_FLOOR = 1; // heuristic, no calibration data

/**
 * Apply a scalar to every numeric value in a per-muscle target map.
 *
 * Rules:
 *  - `scalar >= 1` → identity (no upward scaling — the ramp only ever
 *    reduces).
 *  - For each entry, the scaled value is `Math.floor(value * scalar)`.
 *  - If the original `value > 0` and the floored result would be `0`,
 *    we clamp UP to `PER_MUSCLE_TARGET_FLOOR` so the muscle does not
 *    silently disappear from the budget.
 *  - If the original `value <= 0`, it is passed through unchanged.
 */
export function applyScalarToTargets<T extends Record<string, number>>(
  targets: T,
  scalar: number,
): T {
  if (scalar >= 1) return { ...targets };
  const out = {} as Record<string, number>;
  for (const key of Object.keys(targets)) {
    const v = targets[key];
    if (v <= 0) {
      out[key] = v;
      continue;
    }
    const scaled = Math.floor(v * scalar);
    out[key] = scaled < PER_MUSCLE_TARGET_FLOOR ? PER_MUSCLE_TARGET_FLOOR : scaled;
  }
  return out as T;
}

/**
 * Apply the ramp to an integer `maxItems` budget. Floor of 1 (a user
 * always gets at least one accessory pick when accessories are budgeted).
 */
export function applyScalarToMaxItems(maxItems: number, scalar: number): number {
  if (scalar >= 1) return maxItems;
  if (maxItems <= 0) return maxItems;
  const scaled = Math.floor(maxItems * scalar);
  return scaled < 1 ? 1 : scaled;
}
