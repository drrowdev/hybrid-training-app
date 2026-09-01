/**
 * Which recovery week a block gets, and what its percentages are of.
 *
 * A user-initiated recovery week is PLACED by the platform — it is an extra week
 * between two programmed ones, so no engine has a session to hang it on — but
 * what it CONTAINS is methodology and belongs to the program. This is the single
 * place that maps a block to its program's `RecoveryWeekPolicy`.
 */
import type { RecoveryWeekPolicy } from "@hta/program-core";
import { TB_RECOVERY_WEEK } from "@hta/tacticalbarbell";
import { WENDLER_RECOVERY_WEEK } from "@hta/wendler";
import { GREEN_RECOVERY_WEEK, greenStrengthBasis, type GreenInstance } from "@hta/green";
import { HYROX_RECOVERY_WEEK } from "@hta/hyrox";

/**
 * For a natively assembled block, whose source prescribes no recovery loading of
 * its own. Deliberately not any book's numbers: light straight sets off the true
 * max, which is what the app's own deload week already does elsewhere.
 */
export const GENERIC_RECOVERY_WEEK: RecoveryWeekPolicy = {
  topPercent: 60,
  setOffsets: [0, 0, 0],
  reps: 5,
  recommendedPercent: { min: 50, max: 65 },
  basis: "one-rm",
  easyCardioMaxMin: 30,
  cue: "Recovery week — leave plenty in reserve",
};

const BY_PROGRAM: Record<string, RecoveryWeekPolicy> = {
  "tactical-barbell": TB_RECOVERY_WEEK,
  "wendler-531": WENDLER_RECOVERY_WEEK,
  "green-protocol": GREEN_RECOVERY_WEEK,
  hyrox: HYROX_RECOVERY_WEEK,
};

export function recoveryWeekPolicyFor(
  programId: string | null | undefined,
): RecoveryWeekPolicy {
  return (programId && BY_PROGRAM[programId]) || GENERIC_RECOVERY_WEEK;
}

/**
 * How much to scale a policy percentage by so it means what the policy says.
 *
 * The logger computes load as `1RM × tm_percent × prescribed %`. A block run off
 * a derived training max carries `tm_percent` below 100, so a policy stated
 * against the TRUE max has to be scaled up to survive that multiplication —
 * otherwise a "65 %" Tactical Barbell recovery week silently lands at 58 % of
 * the lifter's actual max, under the range the book gives.
 *
 * A policy stated against the training max (5/3/1, by definition) is unscaled.
 */
export function recoveryPercentScale(
  policy: RecoveryWeekPolicy,
  instance: unknown,
): number {
  if (policy.basis === "training-max") return 1;

  // Green keeps its basis per nested strength engine, so a top-level read finds
  // nothing and concludes "true max". Ask Green (plan §6.9).
  const green = instance as { strength?: Record<string, unknown> } | null | undefined;
  if (green?.strength && typeof green.strength === "object") {
    const basis = greenStrengthBasis(green as GreenInstance);
    return basis?.kind === "training-max" ? 1 / basis.tmPercent : 1;
  }

  const inst = instance as
    | { useTrainingMax?: boolean; tmPercent?: number }
    | null
    | undefined;
  if (!inst?.useTrainingMax || typeof inst.tmPercent !== "number") return 1;
  if (inst.tmPercent <= 0 || inst.tmPercent > 1) return 1;
  return 1 / inst.tmPercent;
}

/** Clamp a user-chosen recovery percentage to something loggable. */
export {
  RECOVERY_PERCENT_MIN,
  RECOVERY_PERCENT_MAX,
  clampRecoveryPercent,
} from "./recovery-week-bounds";

/**
 * Whether a chosen percentage sits outside what the program advises. Drives a
 * warning, never a block — it is the lifter's recovery week (DC-K4).
 */
export function isOutsideRecommended(
  policy: RecoveryWeekPolicy,
  percent: number,
): boolean {
  const range = policy.recommendedPercent;
  if (!range) return false;
  return percent < range.min || percent > range.max;
}
