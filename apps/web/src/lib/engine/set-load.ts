/**
 * Per-set load calculation.
 *
 * Formula (verified, no double-counting):
 *
 *   set_load_kg = sets × reps × weight × rpe_multiplier
 *   region_load = set_load_kg × muscle_weight   // 1.0 primary, 0.5 secondary
 *
 * RPE multiplier interpolated from proximity-to-failure literature
 * (Pareja-Blanco 2017, 2020): each ~1 RIR closer to failure ≈ 1.5× more
 * damage stimulus. Missing RPE defaults to 0.50 (conservative midpoint).
 *
 * The intensity premium (%1RM) is intentionally NOT a separate term — it's
 * already captured by RPE (heavier work at the same reps yields higher
 * RPE). Adding both would double-count intensity.
 *
 * Eccentric premium (heavy-eccentric movements like deadlifts, Nordic
 * curls) is deferred — that's a per-movement metadata tag rather than a
 * per-set calculation.
 */

export type SetLoadInput = {
  /** Number of working sets (typically 1 per logged row). */
  sets: number;
  reps: number;
  weightKg: number;
  rpe?: number | null;
};

/**
 * RPE → multiplier table. Each band reflects ~1 RIR change.
 * RPE 10 (0 RIR) = 1.0; RPE 6 (4 RIR) = 0.4; RPE ≤5 = 0.30 floor.
 */
function rpeMultiplier(rpe: number | null | undefined): number {
  if (rpe == null) return 0.5; // Conservative default — no RPE logged.
  if (rpe >= 10) return 1.0;
  if (rpe >= 9) return 0.85;
  if (rpe >= 8) return 0.7;
  if (rpe >= 7) return 0.55;
  if (rpe >= 6) return 0.4;
  return 0.3;
}

/** Returns the kg-load value for one set (before any muscle / region weighting). */
export function computeSetLoad(input: SetLoadInput): number {
  const { sets, reps, weightKg, rpe } = input;
  if (sets <= 0 || reps <= 0 || weightKg <= 0) return 0;
  return sets * reps * weightKg * rpeMultiplier(rpe);
}

/**
 * Region-credit weights when distributing a set's load across the
 * movement's regions. Primary gets full credit; secondary gets half.
 */
export const PRIMARY_REGION_WEIGHT = 1.0;
export const SECONDARY_REGION_WEIGHT = 0.5;

/** Same multiplier table exposed for inspection / future calibration tests. */
export { rpeMultiplier };
