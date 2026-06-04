/**
 * ADR 0028 — goal-weighted aesthetic profile.
 *
 * The accessory gap-fill ("aesthetic") slot assigns every aesthetic
 * target muscle the same weekly set target regardless of the user's
 * PRIMARY goal (archetype). After ADR 0027 Lever B credited the
 * synergist coverage the main lifts already deliver, the gap-fill on a
 * PERFORMANCE-primary block (strength / hybrid / endurance) flows toward
 * the muscles with the LEAST main-lift carryover — the canonical
 * "physique triad" of side delts, biceps, and calves (which receive
 * 0–0.33 synergist credit). That is correct for a hypertrophy primary
 * but goal-misaligned for a performance primary, where those slots would
 * better serve a bigger lift or a shorter session.
 *
 * This module applies a single, bounded down-weight (×0.5) to the
 * physique triad on the three performance-primary archetypes, leaving
 * every other muscle — and every other archetype — untouched. It is a
 * deliberate, modest VOLUME reduction (NOT volume-invariant): on a
 * tight-budget day it trims roughly one vanity slot.
 *
 * Two override hatches keep it user-respecting:
 *   1. An HONOURED `muscle` secondary cancels the whole down-weight — the
 *      user asked for physique volume on a performance primary, so honour
 *      it. "Honoured" means the ADR 0020 volume tilt actually fires for
 *      this (primary, secondary) pair (strength + muscle, endurance +
 *      muscle). On `concurrent_hybrid` a `muscle` secondary is INERT by
 *      ADR 0020 design, so it does NOT cancel here either — the triad
 *      stays down-weighted, preserving the ADR 0020 "muscle secondary is a
 *      no-op on concurrent" invariant.
 *   2. A triad muscle the user picked as an explicit `focusMuscle` is
 *      left at its focus-elevated target — an explicit pick always wins.
 *
 * Grounding: SAID / specificity principle + opportunity cost. There is
 * no RCT showing strength athletes gain more by skipping lateral raises;
 * this is a programming-philosophy default, MODERATE confidence as
 * philosophy, LOW as a hard-science claim. The 0.5 magnitude is a CP-1 /
 * Stage-A heuristic with no calibration data.
 */

/**
 * Archetypes whose PRIMARY goal is performance (a bigger lift, hybrid
 * capacity, or endurance) rather than physique. Only these three
 * down-weight the physique triad. `hypertrophy_anchor` (the triad IS the
 * goal), `rebuild`, and `maintenance` (lifecycle archetypes with minimal
 * or zero aesthetic budget) are intentionally excluded.
 */
// heuristic — goal-aligned scope (CP-1), per SAID/specificity principle
export const PERFORMANCE_PRIMARY_ARCHETYPES: ReadonlySet<string> = new Set([
  "strength_anchor",
  "concurrent_hybrid",
  "endurance_anchor",
]);

/**
 * The "physique triad" — aesthetic-target muscles with the least
 * carryover to barbell strength or hybrid performance, and the muscles
 * ADR 0027 synergist credit leaves uncovered (so the gap-fill over-feeds
 * them on performance blocks). These are the only muscles this module
 * touches.
 */
// heuristic — mirror-muscle classification (CP-1), per SAID/specificity + opportunity cost
export const PHYSIQUE_TRIAD: ReadonlySet<string> = new Set([
  "side_delts",
  "biceps",
  "calves",
]);

/**
 * Multiplier applied to a physique-triad muscle's weekly aesthetic
 * target on a performance-primary block. Halving the MEV-floor default
 * (6 → 3) keeps a maintenance dose while freeing roughly one vanity slot
 * on a tight-budget day. CP-1 / Stage-A heuristic — no calibration data.
 */
// heuristic, no calibration data (CP-1)
export const AESTHETIC_GOAL_WEIGHT = 0.5;

/**
 * Floor for any positive triad target after the down-weight, so a muscle
 * the user was budgeting never silently disappears — it is merely
 * de-prioritised. Mirrors `PER_MUSCLE_TARGET_FLOOR` in onboarding-ramp.
 */
const GOAL_WEIGHT_TARGET_FLOOR = 1; // heuristic, no calibration data (CP-3)

export type GoalWeightOpts = {
  /** Primary archetype id (`archetype.id`). */
  archetypeId: string;
  /**
   * True when the user's `muscle` secondary is HONOURED by ADR 0020 for
   * this primary (i.e. `isActiveTilt(secondaryVolumeTilt(...))`). When
   * true, the down-weight is cancelled. On archetypes where a `muscle`
   * secondary is inert (e.g. `concurrent_hybrid`) this is false, so the
   * triad stays down-weighted regardless of the secondary.
   */
  secondaryMuscleHonored: boolean;
  /** User-chosen focus muscles (0–2). An explicit pick is never down-weighted. */
  focusMuscles?: readonly string[];
};

/**
 * Apply the goal-weighted physique-triad down-weight to a per-muscle
 * aesthetic target map.
 *
 * Returns a NEW map. Pure — no I/O, no Date.now(). Identity (a verbatim
 * shallow copy) for:
 *   - any non-performance-primary archetype, OR
 *   - an honoured `muscle` secondary (`secondaryMuscleHonored === true`).
 * Otherwise each physique-triad muscle that is NOT an explicit focus
 * muscle is scaled by `AESTHETIC_GOAL_WEIGHT`, floored at
 * `GOAL_WEIGHT_TARGET_FLOOR` (positive targets only).
 */
export function applyGoalWeightToTargets<T extends Record<string, number>>(
  targets: T,
  opts: GoalWeightOpts,
): T {
  // Override hatch 1 + scope gate: only performance primaries whose
  // `muscle` secondary is NOT an honoured tilt down-weight at all.
  if (
    !PERFORMANCE_PRIMARY_ARCHETYPES.has(opts.archetypeId) ||
    opts.secondaryMuscleHonored
  ) {
    return { ...targets };
  }
  const focusSet = new Set(opts.focusMuscles ?? []);
  const out = {} as Record<string, number>;
  for (const key of Object.keys(targets)) {
    const v = targets[key];
    // Override hatch 2: an explicitly-chosen focus muscle is never
    // down-weighted, even if it is in the triad. Non-triad muscles and
    // non-positive targets pass through unchanged.
    if (v <= 0 || !PHYSIQUE_TRIAD.has(key) || focusSet.has(key)) {
      out[key] = v;
      continue;
    }
    const scaled = Math.floor(v * AESTHETIC_GOAL_WEIGHT);
    out[key] = scaled < GOAL_WEIGHT_TARGET_FLOOR ? GOAL_WEIGHT_TARGET_FLOOR : scaled;
  }
  return out as T;
}
