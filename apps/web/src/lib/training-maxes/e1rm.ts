/**
 * e1RM — estimated one-rep-max from a heavy set.
 *
 * Three independent formulas are kept here so the caller can disclose which
 * one produced a number; the planner never silently picks behind the user's
 * back (DC-K4 override-and-warn → here the analogue is "estimate-and-label").
 *
 *   - Epley (1985)     · weight · (1 + reps/30)
 *   - Brzycki (1993)   · weight · 36 / (37 − reps)             [reps ≤ 12]
 *   - Zourdos (2016)   · weight / (%1RM at given reps × RPE)   [lookup]
 *
 * `conservativeEstimate` picks the SMALLER value to avoid pushing TMs upward
 * on noisy single sets — TMs are deliberate underestimates, so a tied vote
 * between two formulas is broken in the conservative direction.
 *
 * Pure module. No I/O, no React.
 */

export type FormulaId = "epley" | "brzycki" | "rpe_zourdos";

/** Epley 1985 — generic, slightly optimistic at low rep counts. */
export function epley(weight: number, reps: number): number {
  assertPositive(weight, "weight");
  assertReps(reps);
  return weight * (1 + reps / 30);
}

/**
 * Brzycki 1993 — narrower validity window. Returns NaN for reps ≥ 37
 * (denominator becomes ≤ 0). Caller should clamp to reps ≤ 12 before use;
 * we encode that as a soft cap by returning the reps=12 value for >12.
 */
export function brzycki(weight: number, reps: number): number {
  assertPositive(weight, "weight");
  assertReps(reps);
  const r = Math.min(reps, 12);
  return (weight * 36) / (37 - r);
}

/**
 * Zourdos 2016 RPE→%1RM chart.
 *
 * Rows indexed by reps (1..12). Columns indexed by RPE (5.0..10.0 in 0.5
 * steps). Values are %1RM. Authoritative table values, no interpolation —
 * the chart itself is the canonical source.
 */
const RPE_STEPS: readonly number[] = [
  5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0,
] as const;

// reps → array of %1RM values aligned to RPE_STEPS.
const ZOURDOS_PCT_1RM: Readonly<Record<number, readonly number[]>> = {
  1:  [79.0, 81.0, 83.0, 85.0, 87.0, 89.2, 91.5, 93.5, 95.5, 97.8, 100.0],
  2:  [75.5, 77.0, 79.0, 81.0, 83.0, 85.0, 87.0, 89.2, 91.5, 93.5, 95.5],
  3:  [73.9, 75.5, 77.0, 79.0, 81.0, 83.0, 85.0, 87.0, 89.2, 91.5, 93.5],
  4:  [72.3, 73.9, 75.5, 77.0, 79.0, 81.0, 83.0, 85.0, 87.0, 89.2, 91.5],
  5:  [70.7, 72.3, 73.9, 75.5, 77.0, 79.0, 81.0, 83.0, 85.0, 87.0, 89.2],
  6:  [69.0, 70.7, 72.3, 73.9, 75.5, 77.0, 79.0, 81.0, 83.0, 85.0, 87.0],
  7:  [68.0, 69.0, 70.7, 72.3, 73.9, 75.5, 77.0, 79.0, 81.0, 83.0, 85.0],
  8:  [66.7, 68.0, 69.0, 70.7, 72.3, 73.9, 75.5, 77.0, 79.0, 81.0, 83.0],
  9:  [65.3, 66.7, 68.0, 69.0, 70.7, 72.3, 73.9, 75.5, 77.0, 79.0, 81.0],
  10: [64.0, 65.3, 66.7, 68.0, 69.0, 70.7, 72.3, 73.9, 75.5, 77.0, 79.0],
  11: [62.6, 64.0, 65.3, 66.7, 68.0, 69.0, 70.7, 72.3, 73.9, 75.5, 77.0],
  12: [61.3, 62.6, 64.0, 65.3, 66.7, 68.0, 69.0, 70.7, 72.3, 73.9, 75.5],
};

/**
 * RPE → %1RM lookup. Conservative interpolation: when RPE falls between two
 * 0.5 steps, round UP to the higher RPE (lower e1RM). Reps > 12 clamped to
 * 12. Reps < 1 throws.
 */
export function rpePercent1Rm(reps: number, rpe: number): number {
  assertReps(reps);
  if (rpe < 5 || rpe > 10) {
    throw new Error(`RPE must be in [5, 10], got ${rpe}`);
  }
  const r = Math.min(Math.max(Math.round(reps), 1), 12);
  // Round RPE UP to the nearest 0.5 step → conservative (higher %1RM, lower e1RM).
  const snapped = Math.min(10, Math.ceil(rpe * 2) / 2);
  const idx = RPE_STEPS.indexOf(snapped);
  if (idx < 0) {
    // Defensive — every 0.5 step in [5,10] is present.
    throw new Error(`Unmapped RPE step ${snapped}`);
  }
  return ZOURDOS_PCT_1RM[r][idx];
}

/** Zourdos-based e1RM. */
export function rpeZourdos(weight: number, reps: number, rpe: number): number {
  assertPositive(weight, "weight");
  const pct = rpePercent1Rm(reps, rpe);
  return weight / (pct / 100);
}

export type ConservativeEstimate = {
  value: number;
  formula: FormulaId;
};

/**
 * Pick the most conservative (smallest) e1RM across the available formulas.
 *
 * - Always compares Epley and Brzycki.
 * - Includes Zourdos when an RPE is provided.
 * - Ties broken in stable order: epley < brzycki < rpe_zourdos.
 *
 * Returns the chosen value + the formula id so the caller can label the row
 * ("e1RM · Epley", etc).
 */
export function conservativeEstimate(
  weight: number,
  reps: number,
  rpe?: number,
): ConservativeEstimate {
  const candidates: ConservativeEstimate[] = [
    { value: epley(weight, reps), formula: "epley" },
    { value: brzycki(weight, reps), formula: "brzycki" },
  ];
  if (rpe != null) {
    candidates.push({ value: rpeZourdos(weight, reps, rpe), formula: "rpe_zourdos" });
  }
  // Smallest value wins; stable ordering preserves the array order on ties.
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].value < best.value) best = candidates[i];
  }
  return best;
}

function assertPositive(n: number, label: string): void {
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive finite number, got ${n}`);
  }
}

function assertReps(reps: number): void {
  if (!Number.isFinite(reps) || reps < 1 || !Number.isInteger(reps)) {
    throw new Error(`reps must be a positive integer, got ${reps}`);
  }
}
