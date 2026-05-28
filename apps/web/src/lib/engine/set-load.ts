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

/**
 * Shared "does this logged set count as real work?" rule.
 *
 * Used by every consumer that reads `set_logs` and computes a load
 * number (actual-session-load, region-ledger, bucket-state-queries).
 * One source of truth for the skip / warmup filter so adding a future
 * set-kind (e.g. "amrap_burnout") only needs to be classified in one
 * place.
 *
 * Rule: a row counts when it is not marked skipped AND not a warmup.
 * Empty rows (no weight / reps) are still "countable" by this rule —
 * the downstream load helpers (`computeSetLoad`, `setBucketLoad`)
 * already return 0 for missing magnitudes, so empty rows contribute
 * nothing to load without needing to be filtered here.
 */
export function isCountableSet(set: {
  setKind?: string | null;
  isSkipped?: boolean | null;
}): boolean {
  if (set.isSkipped === true) return false;
  if (set.setKind === "warmup") return false;
  return true;
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

/**
 * Cardio-to-strength unit-matching scalar.
 *
 * Translates cardio "intensity × duration" output into points
 * comparable in magnitude to strength-set load points. Used by
 * `cardioBucketLoad` (bucket-load.ts) and the region-ledger cardio
 * fan-out. Both consumers MUST import from here to prevent silent
 * divergence.
 *
 * Calibration status (per CP-2/CP-3): heuristic, uncalibrated unit-
 * matching multiplier. The value 8 was chosen so a 30-minute Z2
 * easy bike read in the same order of magnitude as 10 hard sets at
 * RPE 7 in early development. No prospective validation data backs
 * the specific magnitude. Replace once user-outcome data exists to
 * calibrate (CP-1).
 */
export const CARDIO_LOAD_SCALAR = 8;
