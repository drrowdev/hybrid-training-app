/**
 * TM-anchored PR detection.
 *
 * Background: the original PR detector (`./pr.ts`) fires when a logged set
 * beats the user's *historical* max from `set_logs`. That's fine for the
 * lifetime-stats catalog at `/app/stats/prs`, but it makes the in-session
 * "⭐ PR!" flash meaningless for a brand-new user — the first set they
 * ever log is, by definition, a Weight PR. The motivational moment loses
 * its bite.
 *
 * This helper redefines the *in-session* PR semantics: a PR fires only
 * when the user beats what they explicitly told the app they can do —
 * the saved one-rep max from `training_maxes.one_rm_kg`. Three flavours:
 *
 *   Weight PR  — `weight_kg > one_rm_kg + ε` (you hit the bar above
 *                your saved max, reps don't matter).
 *   e1RM PR    — `bestEstimateOneRm(weight, reps, rpe) > one_rm_kg + ε`
 *                (the rep-extrapolated 1RM beats your claim).
 *   Rep PR     — top-set / AMRAP slot only: `actualReps > prescribedReps`.
 *                Anchored to the *prescription*, not history. Outside of
 *                a top-set context, no Rep PR fires.
 *
 * When the user has no saved 1RM for a movement (TM unset), every flag
 * is false. We refuse to fire a false ⭐ against a missing anchor.
 *
 * Warmup and accessory sets never trigger.
 *
 * Two-tier rationale (see PR body for `feat/pr-vs-tm`):
 *   - In-session flash + post-session callout: TM-anchored (this file).
 *   - Stats `/app/stats/prs` page: historical-max via `./pr.ts`. The
 *     page header reads "personal records from your log" — accurate for
 *     a historical record. The motivation moment is the in-session
 *     flash; the stats page is the audit trail.
 */
import { bestEstimateOneRm } from "./one-rm";
import type { SetKind } from "@hta/db";

/** Epsilon (kg) used everywhere to avoid floating-point "PR every set" noise. */
const TM_PR_EPSILON_KG = 0.5;

export type TmAnchoredPrInputs = {
  weightKg: number;
  reps: number;
  rpe: number | null;
  /** Backing `set_logs.set_kind` value (or a compatible string). */
  kind: SetKind;
  /** Prescription rep target — only used for Rep PR. Null when freestyle. */
  prescribedReps?: number | null;
  /** True when this slot is the last main set / AMRAP top set. */
  isTopSet: boolean;
  /** User's saved 1RM from `training_maxes.one_rm_kg`. Null = unset. */
  tmKg: number | null;
};

export type TmAnchoredPrFlash = {
  isWeightPr: boolean;
  isRepPr: boolean;
  isE1rmPr: boolean;
  /**
   * Estimated 1RM for display. Returned when this is a top set with
   * countable reps so the focus view can show "e1RM 142 kg" even when
   * no PR fires. Null otherwise.
   */
  e1rmKg: number | null;
};

const EMPTY: TmAnchoredPrFlash = {
  isWeightPr: false,
  isRepPr: false,
  isE1rmPr: false,
  e1rmKg: null,
};

/**
 * Pure detector. Returns `EMPTY` flags when TM is unset, the set is a
 * warmup / accessory / non-countable entry, or the numbers don't beat
 * the saved 1RM (plus epsilon).
 */
export function detectTmAnchoredPr(inputs: TmAnchoredPrInputs): TmAnchoredPrFlash {
  const { weightKg, reps, rpe, kind, prescribedReps, isTopSet, tmKg } = inputs;

  // No anchor → no PR. Don't fire against a missing claim.
  if (tmKg == null || !Number.isFinite(tmKg) || tmKg <= 0) return EMPTY;

  // Warmup / accessory / tendon sets are not credit-bearing.
  if (kind === "warmup" || kind === "accessory" || kind === "tendon") return EMPTY;

  // Guard malformed numerics — same shape as detectPrs.
  if (!Number.isFinite(weightKg) || weightKg <= 0) return EMPTY;
  if (!Number.isFinite(reps) || reps < 1) return EMPTY;

  const isWeightPr = weightKg > tmKg + TM_PR_EPSILON_KG;

  const newE1rm = bestEstimateOneRm({ weight: weightKg, reps, rpe });
  const isE1rmPr = newE1rm != null && newE1rm > tmKg + TM_PR_EPSILON_KG;

  const isRepPr =
    isTopSet && prescribedReps != null && prescribedReps > 0 && reps > prescribedReps;

  // Surface e1RM for informational display when we're on a top set
  // with at least one rep — useful even without a PR firing.
  const e1rmKg = isTopSet && reps >= 1 ? newE1rm : null;

  return { isWeightPr, isRepPr, isE1rmPr, e1rmKg };
}

/** Exported for tests that want to assert the threshold directly. */
export const TM_PR_EPSILON_KG_EXPORTED = TM_PR_EPSILON_KG;
