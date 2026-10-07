/**
 * Authored Test-week max updates (DC-K4: proposed, never silently applied).
 *
 * A main set logged from a Test week carries the authored rule in its
 * prescribed snapshot. This module turns that set into a proposed 1RM; the
 * caller stores it as a pending suggestion the user accepts or dismisses.
 *
 * Pure module. No I/O, no React.
 */
import { readAuthoredTestRule, type AuthoredTestRule } from "@hta/domain";
import { roundToPlate } from "@/lib/planner/archetypes";
import { conservativeEstimate, type FormulaId } from "./e1rm";
import { AMRAP_CONFIDENCE_REP_CAP, SUGGESTION_DELTA_KG } from "./suggestions";

export type AuthoredTestSetInput = {
  id: string;
  movementId: string;
  setKind: string | null;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  skipped?: boolean | null;
  prescribed: { authoredTest?: unknown } | null;
};

export type AuthoredTestTopSet = {
  id: string;
  movementId: string;
  weightKg: number;
  reps: number;
  rpe: number | null;
  rule: AuthoredTestRule;
};

/** Heaviest logged working set per movement that came from an authored Test week. */
export function pickAuthoredTestSetsByMovement(
  sets: readonly AuthoredTestSetInput[],
): Map<string, AuthoredTestTopSet> {
  const top = new Map<string, AuthoredTestTopSet>();
  for (const s of sets) {
    if (s.skipped) continue;
    if (s.setKind !== "main" && s.setKind !== "back_off") continue;
    const rule = readAuthoredTestRule(s.prescribed?.authoredTest);
    if (!rule) continue;
    const w = s.weightKg;
    const r = s.reps;
    if (w == null || r == null || w <= 0 || r < 1) continue;
    const prev = top.get(s.movementId);
    if (!prev || w > prev.weightKg) {
      top.set(s.movementId, { id: s.id, movementId: s.movementId, weightKg: w, reps: r, rpe: s.rpe, rule });
    }
  }
  return top;
}

export type AuthoredTestResult =
  | { suggest: false; reason: "no-change" | "invalid-input" | "low-confidence" }
  | { suggest: true; oneRmKg: number; formula: FormulaId | null };

/** Proposed 1RM for a Test set, or why there is none. */
export function evaluateAuthoredTest(input: {
  currentOneRmKg: number;
  weightKg: number;
  reps: number;
  rpe?: number | null;
  rule: AuthoredTestRule;
}): AuthoredTestResult {
  if (!Number.isFinite(input.currentOneRmKg) || input.currentOneRmKg <= 0) {
    return { suggest: false, reason: "invalid-input" };
  }
  if (input.rule.after === "fixedIncrease") {
    return { suggest: true, oneRmKg: roundToPlate(input.currentOneRmKg + input.rule.stepKg), formula: null };
  }
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0 || !Number.isInteger(input.reps) || input.reps < 1) {
    return { suggest: false, reason: "invalid-input" };
  }
  if (input.reps > AMRAP_CONFIDENCE_REP_CAP) return { suggest: false, reason: "low-confidence" };
  const rpe = input.rpe != null && input.rpe >= 5 && input.rpe <= 10 ? input.rpe : undefined;
  const estimate = conservativeEstimate(input.weightKg, input.reps, rpe);
  const oneRmKg = roundToPlate(estimate.value);
  if (Math.abs(oneRmKg - input.currentOneRmKg) < SUGGESTION_DELTA_KG) {
    return { suggest: false, reason: "no-change" };
  }
  return { suggest: true, oneRmKg, formula: estimate.formula };
}
