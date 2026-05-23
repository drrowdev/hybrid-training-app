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

export type SuggestionGateInput = {
  currentTmKg: number;
  amrapWeightKg: number;
  amrapReps: number;
  amrapRpe?: number | null;
};

export type SuggestionGateResult =
  | { suggest: false; reason: "no-improvement" | "invalid-input" }
  | {
      suggest: true;
      suggestedTmKg: number;
      formula: FormulaId;
      e1RmKg: number;
    };

/**
 * Decide whether a heavy AMRAP set warrants a TM bump:
 *
 *   1. Pick the smallest of (Epley, Brzycki, Zourdos-when-RPE-present).
 *   2. Round to the 2.5 kg plate increment.
 *   3. Suggest only when the rounded value beats current TM by ≥ 2.5 kg.
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
