/**
 * Suggested-progression engine (Phase 2 D).
 *
 * Pure helper — no DB, no React, no I/O. Given the lifter's top set on a
 * main lift, the prescribed rep target, and the current training max,
 * returns a "next time, try this" hint.
 *
 * The principle (not the source program) is documented broadly in the
 * strength literature: linear progression of weight on the main lifts
 * once a rep target is comfortably hit; hold and chase a rep when the
 * top set was on the edge; reset 5 kg when a rep target is missed by a
 * clear margin (Helms — Muscle & Strength Pyramids vol. 1 §6; Boyle —
 * Advances in Functional Training, anti-grinder argument). Methodology
 * purity (plan §1): no external program names anywhere user-visible.
 *
 * Accessories use rep progression rather than weight (DC-O8 spirit —
 * accessory volume is the lever; absolute load is secondary).
 */

import { type WeightUnit, formatWeight } from "@/lib/stats/units";

export type ProgressionKind = "increase" | "hold" | "retry" | "reset";

export type ProgressionSuggestion = {
  /** "increase" → +load next time, "hold" → same load, more reps,
   *  "retry" → same load, same reps, "reset" → drop load.            */
  kind: ProgressionKind;
  /** Suggested weight in kg for the next attempt. Same as input on
   *  "hold" / "retry", lower on "reset", higher on "increase".       */
  nextWeightKg: number;
  /** Suggested rep target. May increase on "hold" (chase a rep),
   *  stay on the prescribed value otherwise.                         */
  nextReps: number;
  /** Plain-language explanation, surfaced in the UI as a footnote.   */
  rationale: string;
};

export type SuggestNextInput = {
  /** The top set from the just-finished session for this lift. */
  lastSet: {
    weightKg: number;
    reps: number;
    /** RPE 6-10, optional — informs the e1RM cap. */
    rpe?: number | null;
  };
  /** Target reps prescribed for this lift today (e.g. 5 for "3×5 @ 80%"). */
  targetReps: number;
  /** Best-estimate one-rep max from the top set (Epley/RPE conservative).
   *  Pass null when the top set fell outside the e1RM formula window.   */
  e1rmKg: number | null;
  /** Current training max for this movement. */
  trainingMaxKg: number;
  /** Plate increment (default 2.5 kg). The standard +2.5 kg jump and the
   *  -5 kg reset are both expressed as multiples of this. */
  plateIncrement?: number;
  /**
   * Main lift (one of the four strength roles) vs accessory. Accessory
   * lifts use rep-progression: same weight, +1 rep target rather than +2.5 kg.
   */
  isMainLift: boolean;
  /** Display unit for the rationale string. Defaults to metric (kg). */
  units?: WeightUnit;
};

/**
 * Cap increments to a single plate jump (no fractional silliness, no
 * double-jumps). Conservative on purpose.
 */
const INCREMENT_STEPS = 1;

const RESET_MARGIN_REPS = 3;

/**
 * Returns a one-line "try X next time" suggestion for the given top set.
 *
 * Branches:
 *   1. Hit the prescribed reps AND e1RM ≥ TM → "increase" by one plate
 *      step. Capped at the plate increment (no fractional weights).
 *   2. Hit the prescribed reps but e1RM < TM → "hold" — same weight,
 *      target +1 rep. The lifter is still earning load before bumping.
 *   3. Missed by 1-2 reps → "retry" — same weight, same target. Honest
 *      attempt to repeat without panicking.
 *   4. Missed by ≥3 reps → "reset" — drop one plate step × 2 (≈ 5 kg
 *      with the default 2.5 kg increment). Rebuild momentum.
 *
 * Accessories (isMainLift = false) collapse to "hold" semantics: chase
 * reps rather than weight, except a clear miss still triggers "retry".
 */
export function suggestNextWeight(input: SuggestNextInput): ProgressionSuggestion {
  const plate = input.plateIncrement ?? 2.5;
  const units = input.units ?? "metric";
  const { weightKg, reps } = input.lastSet;
  const target = Math.max(1, input.targetReps);
  const diff = reps - target;

  if (!input.isMainLift) {
    // Accessory: rep progression. Missed reps = retry; hit reps = chase one more.
    if (diff < 0) {
      return {
        kind: "retry",
        nextWeightKg: weightKg,
        nextReps: target,
        rationale: `${formatWeight(weightKg, units)} × ${target} again — close it out before adding reps.`,
      };
    }
    return {
      kind: "hold",
      nextWeightKg: weightKg,
      nextReps: reps + 1,
      rationale: `Stay at ${formatWeight(weightKg, units)} — try for ${reps + 1} reps next time.`,
    };
  }

  // Main lift branches.
  if (diff <= -RESET_MARGIN_REPS) {
    // ≥3 reps short — drop 2× plate increment.
    const drop = plate * 2;
    const next = Math.max(plate, Math.round((weightKg - drop) / plate) * plate);
    return {
      kind: "reset",
      nextWeightKg: next,
      nextReps: target,
      rationale: `Drop to ${formatWeight(next, units)} × ${target} to reset and rebuild.`,
    };
  }
  if (diff < 0) {
    return {
      kind: "retry",
      nextWeightKg: weightKg,
      nextReps: target,
      rationale: `Stay at ${formatWeight(weightKg, units)} × ${target} — try again next session.`,
    };
  }

  // Hit the rep target. Decide whether to bump or hold.
  if (input.e1rmKg != null && input.e1rmKg >= input.trainingMaxKg) {
    // Hard-earned: the top set implies a 1RM at-or-above the TM. Bump.
    const next = Math.round((weightKg + plate * INCREMENT_STEPS) / plate) * plate;
    return {
      kind: "increase",
      nextWeightKg: next,
      nextReps: target,
      rationale: `Try ${formatWeight(next, units)} × ${target} next time.`,
    };
  }
  // Hit the reps but e1RM still under TM — keep the weight, chase one more rep.
  return {
    kind: "hold",
    nextWeightKg: weightKg,
    nextReps: reps + 1,
    rationale: `Stay at ${formatWeight(weightKg, units)} — go for ${reps + 1} reps next time.`,
  };
}
