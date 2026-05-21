/**
 * AMRAP TM-bump confidence gate.
 *
 * Replaces Wendler's classic "+5 reps over target -> bump" rule with a
 * multi-signal scoring approach that doesn't over-fire on conservatively-
 * set TMs. Hard gates suppress entirely; soft signals must clear a
 * threshold for the proposal to surface.
 *
 * Design: docs/design/prs-and-tm-progression.md §7
 */
import type { AmrapTarget } from "./amrap";
import { bestEstimateOneRm, tmFromOneRm } from "./one-rm";

export type GateInput = {
  /** Reps actually performed on the AMRAP top set. */
  performedReps: number;
  /** AMRAP target (5+, 3+, 1+). */
  target: AmrapTarget;
  /** Wave week (0-indexed). Wk3 = canonical bump signal in 5/3/1. */
  weekIndex: number;
  /** Top-set weight (used for e1RM math). */
  performedWeight: number;
  /** RPE of the AMRAP set, if logged. */
  performedRpe: number | null;
  /** User's CURRENT TM for the movement (kg). */
  currentTm: number;
  /** Days since the last TM change for this movement. null = never changed. */
  daysSinceLastTmChange: number | null;
  /** Was a TM-bump proposal already emitted for this movement within the last 28 days? */
  recentProposalExists: boolean;
  /** Region of this movement is currently in an active limitation? */
  hasActiveLimitation: boolean;
  /**
   * Number of prior AMRAP "smashes" (≥+5 reps over target) in the last
   * ~6 weeks. Capped at 2 by the soft-signal scorer.
   */
  priorSmashCount: number;
  /** Today's GRM (per-session readiness). null = no check-in this session. */
  todayGrm: number | null;
};

export type GateReason = {
  /** Plain-English explanation surfaced on the proposal card. */
  label: string;
  /** Signed point contribution. Negative values reflect fatigue masking. */
  points: number;
};

export type GateResult =
  | {
      passes: true;
      /** Suggested new TM (kg), rounded to plate-friendly increment. */
      newTm: number;
      /** Estimated 1RM that drove the bump. */
      estimatedOneRm: number;
      score: number;
      reasons: GateReason[];
    }
  | {
      passes: false;
      /** Why the gate suppressed the proposal. */
      blockedBy: HardGateName | "score_below_threshold";
      score: number;
      reasons: GateReason[];
    };

export type HardGateName =
  | "cooldown_active"          // TM changed in last 28 days
  | "proposal_already_emitted" // Already proposed in last 28 days
  | "active_limitation";       // Movement region is in an active limitation

const COOLDOWN_DAYS = 28;
const SCORE_THRESHOLD = 3;
const GRM_FATIGUE_THRESHOLD = 0.93;

/**
 * Run the gate. Pure function — no side effects.
 *
 * Hard gates are checked first; any one failure returns a blocked result.
 * Otherwise the soft-signal scorer accumulates points and compares against
 * the threshold (3 points).
 */
export function evaluateBumpGate(input: GateInput): GateResult {
  // Hard gates: any failure suppresses entirely.
  if (input.daysSinceLastTmChange != null && input.daysSinceLastTmChange < COOLDOWN_DAYS) {
    return {
      passes: false,
      blockedBy: "cooldown_active",
      score: 0,
      reasons: [{ label: `TM was changed ${input.daysSinceLastTmChange} day(s) ago — cooldown active.`, points: 0 }],
    };
  }
  if (input.recentProposalExists) {
    return {
      passes: false,
      blockedBy: "proposal_already_emitted",
      score: 0,
      reasons: [{ label: "Already proposed a TM bump for this lift in the last 4 weeks.", points: 0 }],
    };
  }
  if (input.hasActiveLimitation) {
    return {
      passes: false,
      blockedBy: "active_limitation",
      score: 0,
      reasons: [{ label: "Active injury limitation covers this lift's region.", points: 0 }],
    };
  }

  // Compute e1RM for the soft signals.
  const estimatedOneRm = bestEstimateOneRm({
    weight: input.performedWeight,
    reps: input.performedReps,
    rpe: input.performedRpe,
  });
  if (estimatedOneRm == null) {
    return {
      passes: false,
      blockedBy: "score_below_threshold",
      score: 0,
      reasons: [{ label: "Couldn't estimate 1RM from this set (too many reps?).", points: 0 }],
    };
  }
  const e1RmImpliedTm = estimatedOneRm * 0.9;
  const e1RmExcessPct = ((e1RmImpliedTm - input.currentTm) / input.currentTm) * 100;
  const repsOverTarget = input.performedReps - input.target;

  // Soft signals.
  const reasons: GateReason[] = [];
  let score = 0;

  // +1: reps over target ≥ 5
  if (repsOverTarget >= 5) {
    reasons.push({ label: `Beat the ${input.target}+ target by ${repsOverTarget} reps.`, points: 1 });
    score += 1;
  }

  // +2: Wk3 (1+) beaten by ≥ 5 reps — Wendler's canonical bump signal
  if (input.weekIndex === 2 && input.target === 1 && repsOverTarget >= 5) {
    reasons.push({ label: "Wk3 (1+) beaten by 5+ reps — Wendler's canonical bump signal.", points: 2 });
    score += 2;
  }

  // +2: Wk1/Wk2 AMRAP beaten by ≥ 7 reps — early-week outlier
  if ((input.weekIndex === 0 || input.weekIndex === 1) && repsOverTarget >= 7) {
    reasons.push({ label: `Wk${input.weekIndex + 1} beaten by ${repsOverTarget} reps — early-week outlier.`, points: 2 });
    score += 2;
  }

  // +2: e1RM-implied TM exceeds current TM by ≥ 7%
  if (e1RmExcessPct >= 7) {
    reasons.push({
      label: `Estimated 1RM implies a TM ${e1RmExcessPct.toFixed(0)}% over your current.`,
      points: 2,
    });
    score += 2;
  }

  // +1 per prior AMRAP smash (capped at +2)
  const priorBoost = Math.min(2, input.priorSmashCount);
  if (priorBoost > 0) {
    reasons.push({
      label: `${input.priorSmashCount} prior AMRAP smash${input.priorSmashCount === 1 ? "" : "es"} on this lift in the last 6 weeks.`,
      points: priorBoost,
    });
    score += priorBoost;
  }

  // +1: ≥ 1 full cycle (21 days) since last TM change
  if (input.daysSinceLastTmChange != null && input.daysSinceLastTmChange >= 21) {
    reasons.push({ label: "Over a full cycle since your last TM change.", points: 1 });
    score += 1;
  }

  // −1: acute fatigue (today's GRM < 0.93)
  if (input.todayGrm != null && input.todayGrm < GRM_FATIGUE_THRESHOLD) {
    reasons.push({
      label: `Today's readiness check showed acute fatigue (GRM ${input.todayGrm.toFixed(2)}) — penalty applied.`,
      points: -1,
    });
    score -= 1;
  }

  if (score < SCORE_THRESHOLD) {
    return {
      passes: false,
      blockedBy: "score_below_threshold",
      score,
      reasons,
    };
  }

  // Compute the suggested new TM from Wendler's 90% rule.
  const newTm = tmFromOneRm(estimatedOneRm);
  return {
    passes: true,
    newTm,
    estimatedOneRm,
    score,
    reasons,
  };
}
