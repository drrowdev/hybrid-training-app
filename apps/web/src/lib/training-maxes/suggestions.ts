/**
 * Pure logic for the AMRAP→TM suggestion gate.
 *
 * Kept separate from `actions.ts` because that file is `"use server"` and
 * every export there must be an async function. The gate itself is sync and
 * fully testable without a Supabase client.
 */
import { conservativeEstimate, type FormulaId } from "./e1rm";
import { roundToPlate } from "./queries";

/**
 * Minimum kg delta between current TM and a derived e1RM before we surface
 * a suggestion. Matches the 2.5 kg plate increment used everywhere else so
 * sub-plate bumps don't pester the user.
 */
export const SUGGESTION_DELTA_KG = 2.5;

/**
 * High-confidence rep cap for an AMRAP-derived TM suggestion.
 *
 * 1RM-prediction formulas (Epley, Brzycki) are validated and reliable only in
 * the low-rep range; beyond ~5 reps the error grows sharply because high-rep
 * performance is governed as much by individual muscular endurance / fatigue
 * resistance as by maximal strength (LeSuer 1997; Reynolds 2006; Brzycki's own
 * validity window). A TM CHANGE is a deliberate, infrequent event — especially
 * for an advanced athlete — so we only trust an AMRAP-derived e1RM enough to
 * propose a bump when the set was in that high-confidence range. A set with more
 * reps (e.g. 8) cannot be a high-confidence 1RM signal, and surfacing it risks
 * "banner fatigue" from noisy data. Sets above the cap are suppressed entirely.
 */
export const AMRAP_CONFIDENCE_REP_CAP = 5;

export type SuggestionGateInput = {
  currentTmKg: number;
  amrapWeightKg: number;
  amrapReps: number;
  amrapRpe?: number | null;
};

export type SuggestionGateResult =
  | { suggest: false; reason: "no-improvement" | "invalid-input" | "low-confidence" }
  | {
      suggest: true;
      suggestedTmKg: number;
      formula: FormulaId;
      e1RmKg: number;
    };

/**
 * Decide whether a heavy AMRAP set warrants a TM bump:
 *
 *   1. Reject when the set is above the high-confidence rep cap (≤ 5 reps): a
 *      high-rep set can't yield a trustworthy 1RM estimate, so we don't fire.
 *   2. Pick the smallest of (Epley, Brzycki, Zourdos-when-RPE-present).
 *   3. Round to the 2.5 kg plate increment.
 *   4. Suggest only when the rounded value beats current TM by ≥ 2.5 kg.
 */
export function evaluateTmSuggestion(input: SuggestionGateInput): SuggestionGateResult {
  if (
    !Number.isFinite(input.currentTmKg) ||
    input.currentTmKg < 0 ||
    !Number.isFinite(input.amrapWeightKg) ||
    input.amrapWeightKg <= 0 ||
    !Number.isInteger(input.amrapReps) ||
    input.amrapReps < 1
  ) {
    return { suggest: false, reason: "invalid-input" };
  }
  // Confidence gate: a high-rep AMRAP can't produce a high-confidence 1RM.
  if (input.amrapReps > AMRAP_CONFIDENCE_REP_CAP) {
    return { suggest: false, reason: "low-confidence" };
  }
  const rpe =
    input.amrapRpe != null && Number.isFinite(input.amrapRpe) ? input.amrapRpe : undefined;
  const est = conservativeEstimate(input.amrapWeightKg, input.amrapReps, rpe);
  const rounded = roundToPlate(est.value);
  if (rounded - input.currentTmKg < SUGGESTION_DELTA_KG) {
    return { suggest: false, reason: "no-improvement" };
  }
  return {
    suggest: true,
    suggestedTmKg: rounded,
    formula: est.formula,
    e1RmKg: est.value,
  };
}
