/**
 * Tier detection — declared experience + 4-input weighted formula.
 *
 * Pure helper (no DB, no Date.now()). Sits in `@hta/engine` so the
 * engine package and `apps/web` import the same identity (plan §6.9
 * single home for derived state).
 *
 * The engine's user tier (`consumer` / `intermediate` / `high_performance`)
 * gates downstream planning parameters per DC-G6 (volume-ceiling
 * headroom, hard-conditioning cap, autoregulation depth). DC-G2's
 * v2 BTS formula remains the long-term target; this module is the
 * pragmatic interim — it consumes the inputs we actually have today
 * (strength relative to bodyweight, behavioural adherence) and rolls
 * them into a transparent, contributor-by-contributor score.
 *
 * Design constraints honoured:
 *  - DC-G1 tier is behavioural, not declared (we still surface a soft
 *    declared-vs-inferred mismatch warning per DC-K4 rather than a
 *    silent overrule).
 *  - DC-G3 enum: `consumer` | `intermediate` | `high_performance`.
 *  - DC-G5 cold-start tier: with no signal and no declaration → consumer
 *    + low confidence (conservative cold-start spirit, ref. DC-K1).
 *  - DC-K4 override-and-warn: a declared-vs-inferred mismatch is a
 *    *soft warn surface*, never a block.
 *
 * Bodyweight-ratio gates default to the conservative MOC table used
 * across mainstream programming references; absolute-kg fallbacks
 * apply only when bodyweight is unknown. Citation comments live next
 * to each gate constant.
 */

export type TierLevel = "consumer" | "intermediate" | "high_performance";

export type DeclaredExperience =
  | "lt_1y" // ≤ 1 year consistent training
  | "1_3y" // 1–3 years
  | "gte_3y"; // 3+ years

export const DECLARED_TO_TIER: Record<DeclaredExperience, TierLevel> = {
  lt_1y: "consumer",
  "1_3y": "intermediate",
  gte_3y: "high_performance",
};

export type MainLift =
  | "squat"
  | "horizontal_press"
  | "deadlift"
  | "vertical_press";

export const MAIN_LIFTS: readonly MainLift[] = [
  "squat",
  "horizontal_press",
  "deadlift",
  "vertical_press",
] as const;

export type TierInputs = {
  declaredExperience: DeclaredExperience | null;
  bodyweightKg: number | null;
  e1rmKgByRole: Partial<Record<MainLift, number>>;
  /** Anchor (main-lift) compliance over the last 12 weeks. 0..1. Null
   *  means no data yet (don't add a behaviour contributor). */
  anchorAdherenceLast12w: number | null;
  /** Coefficient-of-variation of weekly session count, expressed 0..1
   *  where 1 = perfectly regular, 0 = wildly inconsistent. Null when
   *  there aren't enough weeks to compute a CV. */
  scheduleRegularity: number | null;
  /** Fraction of sessions with a pre-session check-in filled. 0..1.
   *  Null when no sessions logged. */
  recoveryInputConsistency: number | null;
};

export type Contributor = {
  name: string;
  /** Raw observation (e.g. ratio 1.42, percentage 0.83). */
  value: number;
  /** Weight in the weighted sum (sums to ≤ 1.0 across all contributors). */
  weight: number;
  /** weight × normalised-strength, attributed to `pointsToward`. */
  contribution: number;
  /** Which tier this evidence points at. */
  pointsToward: TierLevel;
};

export type TierResult = {
  declared: TierLevel | null;
  inferred: TierLevel;
  /** Final tier used by the UI. Matches `declared` when set (DC-K4
   *  soft-warn semantics — see `mismatch`). */
  tier: TierLevel;
  /** True when declared and inferred disagree — render a soft warning. */
  mismatch: boolean;
  confidence: "low" | "moderate" | "high";
  contributors: Contributor[];
  /** Sum of contribution by tier, for diagnostic display. */
  scoresByTier: Record<TierLevel, number>;
  /** Rough estimate of additional sessions until the next-tier inferred
   *  gate is met. NULL when already at high_performance. */
  sessionsUntilNextTier: number | null;
  /** Plain-language explanation of the next-tier gate. */
  nextTierGateNote: string | null;
};

// ── Bodyweight-ratio thresholds ───────────────────────────────────────
// Conservative defaults synthesised from common programming references
// (Rippetoe Starting Strength + Lon Kilgore strength-standards tables);
// see `docs/knowledge/hybrid-training-research-v2.md` §5.x for the tier
// definition and `hybrid-training-design-constraints.md#DC-G1..G6` for
// the contract. Numbers are intentionally lower than competition-level
// standards — a *gate* not a *peak* — because DC-G1 says tier is what
// behaviour supports, not what a one-off PR demonstrates.
const BODYWEIGHT_RATIO_GATES: Record<
  MainLift,
  { intermediate: number; high_performance: number }
> = {
  squat: { intermediate: 1.0, high_performance: 1.5 },
  horizontal_press: { intermediate: 0.75, high_performance: 1.0 },
  deadlift: { intermediate: 1.5, high_performance: 2.0 },
  vertical_press: { intermediate: 0.5, high_performance: 0.75 },
};

const ADVANCED_BODYWEIGHT_RATIOS: Record<MainLift, number> = {
  squat: 2.0,
  horizontal_press: 1.5,
  deadlift: 2.5,
  vertical_press: 1.0,
};

// Absolute-kg fallbacks. Used only when bodyweight is unknown — they
// can't normalise for body size, so each weighs half as much (0.1 vs
// 0.2) and the resulting tier is held conservatively.
const ABSOLUTE_KG_GATES: Record<
  MainLift,
  { intermediate: number; high_performance: number }
> = {
  squat: { intermediate: 120, high_performance: 160 },
  horizontal_press: { intermediate: 80, high_performance: 110 },
  deadlift: { intermediate: 160, high_performance: 200 },
  vertical_press: { intermediate: 50, high_performance: 70 },
};

const STRENGTH_WEIGHT_BW_RATIO = 0.2;
const STRENGTH_WEIGHT_ABSOLUTE = 0.1;
const ANCHOR_ADHERENCE_WEIGHT = 0.1;
const SCHEDULE_REGULARITY_WEIGHT = 0.05;
const RECOVERY_CONSISTENCY_WEIGHT = 0.05;

/**
 * Classify a single main-lift e1RM against bodyweight-ratio gates.
 * Returns the tier the lift *supports*, or `null` when an input is
 * unusable (non-finite, non-positive bodyweight).
 */
export function classifyBodyweightRatio(
  lift: MainLift,
  e1rmKg: number,
  bodyweightKg: number,
): TierLevel | null {
  if (!Number.isFinite(e1rmKg) || e1rmKg <= 0) return null;
  if (!Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return null;
  const ratio = e1rmKg / bodyweightKg;
  const gates = BODYWEIGHT_RATIO_GATES[lift];
  if (ratio >= gates.high_performance) return "high_performance";
  if (ratio >= gates.intermediate) return "intermediate";
  return "consumer";
}

/**
 * Fallback classifier used when bodyweight is unknown. Uses absolute
 * loads, which don't normalise for body size — caller weighs this
 * evidence half as much.
 */
export function classifyAbsoluteThreshold(
  lift: MainLift,
  e1rmKg: number,
): TierLevel | null {
  if (!Number.isFinite(e1rmKg) || e1rmKg <= 0) return null;
  const gates = ABSOLUTE_KG_GATES[lift];
  if (e1rmKg >= gates.high_performance) return "high_performance";
  if (e1rmKg >= gates.intermediate) return "intermediate";
  return "consumer";
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function labelForLift(lift: MainLift): string {
  switch (lift) {
    case "squat":
      return "Squat";
    case "horizontal_press":
      return "Bench";
    case "deadlift":
      return "Deadlift";
    case "vertical_press":
      return "Overhead press";
  }
}

/**
 * The main computation. See module doc for the constraint mapping.
 */
export function computeTier(inputs: TierInputs): TierResult {
  const contributors: Contributor[] = [];
  const scoresByTier: Record<TierLevel, number> = {
    consumer: 0,
    intermediate: 0,
    high_performance: 0,
  };

  const hasBw =
    inputs.bodyweightKg != null &&
    Number.isFinite(inputs.bodyweightKg) &&
    inputs.bodyweightKg > 0;

  // 1) Strength contributors — one per main lift we have an e1RM for.
  for (const lift of MAIN_LIFTS) {
    const e1rm = inputs.e1rmKgByRole[lift];
    if (e1rm == null || !Number.isFinite(e1rm) || e1rm <= 0) continue;

    let pointsToward: TierLevel | null = null;
    let weight: number;
    let value: number;
    let name: string;
    if (hasBw) {
      pointsToward = classifyBodyweightRatio(
        lift,
        e1rm,
        inputs.bodyweightKg as number,
      );
      weight = STRENGTH_WEIGHT_BW_RATIO;
      value = e1rm / (inputs.bodyweightKg as number);
      name = `${labelForLift(lift)} (×BW ratio)`;
    } else {
      pointsToward = classifyAbsoluteThreshold(lift, e1rm);
      weight = STRENGTH_WEIGHT_ABSOLUTE;
      value = e1rm;
      name = `${labelForLift(lift)} (absolute kg)`;
    }
    if (pointsToward == null) continue;
    const contribution = weight;
    scoresByTier[pointsToward] += contribution;
    contributors.push({
      name,
      value,
      weight,
      contribution,
      pointsToward,
    });
  }

  // 2) Anchor adherence (12-week main-lift compliance).
  if (
    inputs.anchorAdherenceLast12w != null &&
    Number.isFinite(inputs.anchorAdherenceLast12w)
  ) {
    const v = clamp01(inputs.anchorAdherenceLast12w);
    let pointsToward: TierLevel;
    if (v >= 0.9) pointsToward = "high_performance";
    else if (v >= 0.8) pointsToward = "intermediate";
    else pointsToward = "consumer";
    scoresByTier[pointsToward] += ANCHOR_ADHERENCE_WEIGHT;
    contributors.push({
      name: "Anchor adherence (12w)",
      value: v,
      weight: ANCHOR_ADHERENCE_WEIGHT,
      contribution: ANCHOR_ADHERENCE_WEIGHT,
      pointsToward,
    });
  }

  // 3) Schedule regularity.
  if (
    inputs.scheduleRegularity != null &&
    Number.isFinite(inputs.scheduleRegularity)
  ) {
    const v = clamp01(inputs.scheduleRegularity);
    let pointsToward: TierLevel;
    if (v >= 0.8) pointsToward = "high_performance";
    else if (v >= 0.6) pointsToward = "intermediate";
    else pointsToward = "consumer";
    scoresByTier[pointsToward] += SCHEDULE_REGULARITY_WEIGHT;
    contributors.push({
      name: "Schedule regularity",
      value: v,
      weight: SCHEDULE_REGULARITY_WEIGHT,
      contribution: SCHEDULE_REGULARITY_WEIGHT,
      pointsToward,
    });
  }

  // 4) Recovery input consistency.
  if (
    inputs.recoveryInputConsistency != null &&
    Number.isFinite(inputs.recoveryInputConsistency)
  ) {
    const v = clamp01(inputs.recoveryInputConsistency);
    let pointsToward: TierLevel;
    if (v >= 0.7) pointsToward = "high_performance";
    else if (v >= 0.4) pointsToward = "intermediate";
    else pointsToward = "consumer";
    scoresByTier[pointsToward] += RECOVERY_CONSISTENCY_WEIGHT;
    contributors.push({
      name: "Recovery check-in fill rate",
      value: v,
      weight: RECOVERY_CONSISTENCY_WEIGHT,
      contribution: RECOVERY_CONSISTENCY_WEIGHT,
      pointsToward,
    });
  }

  // 5) Pick the inferred tier — argmax over scoresByTier.
  // DC-G5 cold start: when nothing observable AND no declaration →
  // consumer + low confidence. Beginner-conservative spirit (DC-K1).
  const totalContribution =
    scoresByTier.consumer +
    scoresByTier.intermediate +
    scoresByTier.high_performance;

  let inferred: TierLevel;
  if (totalContribution === 0) {
    inferred = inputs.declaredExperience
      ? DECLARED_TO_TIER[inputs.declaredExperience]
      : "consumer";
  } else {
    // Tie-break: prefer the lower tier (DC-G1 conservative spirit —
    // don't promote on a coin-flip).
    const order: TierLevel[] = ["consumer", "intermediate", "high_performance"];
    inferred = order[0]!;
    let best = scoresByTier[inferred];
    for (const t of order.slice(1)) {
      if (scoresByTier[t] > best) {
        inferred = t;
        best = scoresByTier[t];
      }
    }
  }

  // 6) Confidence band.
  const topScore = Math.max(
    scoresByTier.consumer,
    scoresByTier.intermediate,
    scoresByTier.high_performance,
  );
  const dataContribCount = contributors.length;
  let confidence: TierResult["confidence"];
  if (topScore >= 0.6 && dataContribCount >= 6) confidence = "high";
  else if (topScore >= 0.4 || dataContribCount >= 4) confidence = "moderate";
  else confidence = "low";

  // 7) Resolve declared vs inferred (DC-K4 soft-warn semantics).
  const declared = inputs.declaredExperience
    ? DECLARED_TO_TIER[inputs.declaredExperience]
    : null;
  const mismatch = declared != null && declared !== inferred;
  // Per user spec: prefer DECLARED when set — the user owns that
  // declaration. The mismatch is surfaced as a soft warning in the UI
  // (DC-K4 override-and-warn — never silent overrule).
  const tier: TierLevel = declared ?? inferred;

  // 8) Next-tier gate estimate.
  const { sessionsUntilNextTier, nextTierGateNote } = estimateNextTierGate(
    inferred,
    inputs,
    hasBw,
  );

  return {
    declared,
    inferred,
    tier,
    mismatch,
    confidence,
    contributors,
    scoresByTier,
    sessionsUntilNextTier,
    nextTierGateNote,
  };
}

function estimateNextTierGate(
  inferred: TierLevel,
  inputs: TierInputs,
  hasBw: boolean,
): { sessionsUntilNextTier: number | null; nextTierGateNote: string | null } {
  if (inferred === "high_performance") {
    return { sessionsUntilNextTier: null, nextTierGateNote: null };
  }
  const target: TierLevel =
    inferred === "consumer" ? "intermediate" : "high_performance";

  // For each main lift we *have* data for but that isn't yet at `target`,
  // compute the kg gap to the relevant gate and turn it into a rough
  // "sessions to close it" using a ~2.5 kg/session progression heuristic
  // for upper-body lifts and ~5 kg/session for lower-body (a generous
  // novice-LP cadence; conservative for intermediate users — the engine
  // calibrates this on real data later, DC-K3).
  let minSessions = Number.POSITIVE_INFINITY;
  let closestLift: MainLift | null = null;
  let closestGapKg = 0;

  const perSessionDeltaKg: Record<MainLift, number> = {
    squat: 5,
    horizontal_press: 2.5,
    deadlift: 5,
    vertical_press: 2.5,
  };

  for (const lift of MAIN_LIFTS) {
    const e1rm = inputs.e1rmKgByRole[lift];
    if (e1rm == null) continue;
    let gateKg: number | null = null;
    if (hasBw && inputs.bodyweightKg) {
      const ratioGate =
        target === "intermediate"
          ? BODYWEIGHT_RATIO_GATES[lift].intermediate
          : BODYWEIGHT_RATIO_GATES[lift].high_performance;
      gateKg = ratioGate * inputs.bodyweightKg;
    } else {
      gateKg =
        target === "intermediate"
          ? ABSOLUTE_KG_GATES[lift].intermediate
          : ABSOLUTE_KG_GATES[lift].high_performance;
    }
    if (gateKg == null) continue;
    const gap = gateKg - e1rm;
    if (gap <= 0) continue;
    const sessions = Math.max(1, Math.ceil(gap / perSessionDeltaKg[lift]));
    if (sessions < minSessions) {
      minSessions = sessions;
      closestLift = lift;
      closestGapKg = gap;
    }
  }

  if (closestLift == null) {
    // No strength data — phrase the gate as a behaviour gate instead.
    if (target === "intermediate") {
      return {
        sessionsUntilNextTier: null,
        nextTierGateNote:
          "Log a few main-lift sessions so the engine can read your e1RMs.",
      };
    }
    return {
      sessionsUntilNextTier: null,
      nextTierGateNote:
        "Hit 90% anchor adherence over 12 weeks plus high recovery check-in fill rate.",
    };
  }

  const friendly =
    closestLift === "horizontal_press"
      ? "bench"
      : closestLift === "vertical_press"
        ? "OHP"
        : closestLift;
  const targetLabel =
    target === "intermediate" ? "intermediate" : "high-performance";
  return {
    sessionsUntilNextTier: Number.isFinite(minSessions) ? minSessions : null,
    nextTierGateNote: `~${Math.round(closestGapKg)}kg from the ${targetLabel} ${friendly} gate (≈ ${minSessions} session${minSessions === 1 ? "" : "s"} of progression).`,
  };
}
