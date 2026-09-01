/**
 * Pure logic for the AMRAP→TM suggestion gate.
 *
 * Kept separate from `actions.ts` because that file is `"use server"` and
 * every export there must be an async function. The gate itself is sync and
 * fully testable without a Supabase client.
 */
import { conservativeEstimate, type FormulaId } from "./e1rm";
import { roundToPlate } from "@/lib/planner/archetypes";

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

export type AmrapSetCandidateInput = {
  id: string;
  movementId: string;
  setKind: string | null;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  notes: string | null;
  skipped?: boolean | null;
  prescribed: { isAmrap?: boolean } | null;
};

export type AmrapTopSet = {
  id: string;
  movementId: string;
  weightKg: number;
  reps: number;
  rpe: number | null;
};

/**
 * AMRAP source of truth for TM suggestions (ADR 0070).
 *
 * Current rows carry a prescribed snapshot: only `isAmrap === true` qualifies.
 * Never infer from raw reps — a programmed 5 is not an open set.
 * Legacy rows with no snapshot fall back to an explicit "amrap" note.
 */
export function isAmrapSetForTmSuggestion(set: {
  notes: string | null | undefined;
  prescribed: { isAmrap?: boolean } | null | undefined;
}): boolean {
  if (set.prescribed != null) return set.prescribed.isAmrap === true;
  return (set.notes ?? "").toLowerCase().includes("amrap");
}

/** Heaviest qualifying AMRAP working set per movement. */
export function pickAmrapTopSetsByMovement(
  sets: readonly AmrapSetCandidateInput[],
): Map<string, AmrapTopSet> {
  const topByMovement = new Map<string, AmrapTopSet>();
  for (const s of sets) {
    if (s.skipped) continue;
    if (s.setKind !== "main" && s.setKind !== "back_off") continue;
    const w = s.weightKg;
    const r = s.reps;
    if (w == null || r == null || w <= 0 || r < 1) continue;
    if (!isAmrapSetForTmSuggestion(s)) continue;
    const prev = topByMovement.get(s.movementId);
    if (!prev || w > prev.weightKg) {
      topByMovement.set(s.movementId, {
        id: s.id,
        movementId: s.movementId,
        weightKg: w,
        reps: r,
        rpe: s.rpe,
      });
    }
  }
  return topByMovement;
}

export type DesiredTmSuggestion = {
  movementId: string;
  setLogId: string;
  currentTmKg: number;
  suggestedTmKg: number;
  source: string;
  derivedFormula: string;
};

export type ExistingTmSuggestion = {
  id: string;
  movementId: string;
  derivedFromSetLogId: string | null;
  status: string;
  currentTmKg: number | string | null;
  suggestedTmKg: number | string;
  derivedFormula: string | null;
  source: string;
};

export type TmSuggestionReconcilePlan = {
  deletePendingIds: string[];
  updates: Array<DesiredTmSuggestion & { id: string }>;
  inserts: DesiredTmSuggestion[];
};

function numEq(a: number | string | null | undefined, b: number): boolean {
  return a != null && Number(a) === b;
}

function isIdenticalOffer(
  existing: ExistingTmSuggestion,
  desired: DesiredTmSuggestion,
): boolean {
  return (
    existing.derivedFromSetLogId === desired.setLogId &&
    numEq(existing.suggestedTmKg, desired.suggestedTmKg) &&
    numEq(existing.currentTmKg, desired.currentTmKg)
  );
}

/**
 * Reconcile pending TM suggestions for one completed session.
 * Accepted/dismissed rows are never mutated. An identical dismissed offer
 * is not resurrected; an accepted offer for the same set is not re-queued.
 */
export function planTmSuggestionReconcile(
  desired: readonly DesiredTmSuggestion[],
  existing: readonly ExistingTmSuggestion[],
): TmSuggestionReconcilePlan {
  const pending = existing.filter((s) => s.status === "pending");
  const accepted = existing.filter((s) => s.status === "accepted");
  const dismissed = existing.filter((s) => s.status === "dismissed");
  const claimed = new Set<string>();
  const updates: Array<DesiredTmSuggestion & { id: string }> = [];
  const inserts: DesiredTmSuggestion[] = [];

  for (const next of desired) {
    const sameSet = pending.find(
      (p) => p.derivedFromSetLogId === next.setLogId && !claimed.has(p.id),
    );
    const sameMovement = pending.find(
      (p) => p.movementId === next.movementId && !claimed.has(p.id),
    );
    const reusable = sameSet ?? sameMovement;
    if (reusable) {
      claimed.add(reusable.id);
      const needsUpdate =
        reusable.derivedFromSetLogId !== next.setLogId ||
        !numEq(reusable.suggestedTmKg, next.suggestedTmKg) ||
        !numEq(reusable.currentTmKg, next.currentTmKg) ||
        reusable.source !== next.source ||
        reusable.derivedFormula !== next.derivedFormula;
      if (needsUpdate) updates.push({ id: reusable.id, ...next });
      continue;
    }
    if (accepted.some((row) => row.derivedFromSetLogId === next.setLogId)) {
      continue;
    }
    if (dismissed.some((row) => isIdenticalOffer(row, next))) continue;
    inserts.push(next);
  }

  return {
    deletePendingIds: pending.filter((p) => !claimed.has(p.id)).map((p) => p.id),
    updates,
    inserts,
  };
}

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
