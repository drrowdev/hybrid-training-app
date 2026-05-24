/**
 * Cross-family normalised difficulty score for a single working set.
 *
 * Used by:
 *  - Effective-volume tracking (a set of one-arm chins counts more than a
 *    set of band-assisted pull-ups for volume budgeting)
 *  - Progression suggestion gating (Phase 4)
 *  - Mixed-modal classifier (Phase 5)
 *
 * Composite of five inputs from the bodyweight addendum:
 *  - difficulty_anchor (the node's intrinsic difficulty, 1-100)
 *  - reps (raw rep count)
 *  - tempoSec (eccentric component used — slower = more TUT)
 *  - rir (proximity to failure)
 *  - externalLoadKg (added vest / belt load) — bodyweight-relative
 *
 * Returns a number in a deliberately open scale; calibration will iterate.
 */
export function effectiveDifficulty(input: {
  node: { difficultyAnchor: number; tutPerRepSeconds: number };
  reps: number;
  tempoSec: number;
  rir: number;
  externalLoadKg: number;
  userBodyweightKg: number;
}): number {
  const { node, reps, tempoSec, rir, externalLoadKg, userBodyweightKg } = input;
  // Base: anchor × reps × tempo-scale factor.
  const tempoScale = Math.max(0.6, tempoSec / node.tutPerRepSeconds);
  const proximityFactor = Math.max(0.4, 1 - rir * 0.1);
  const externalLoadFactor =
    userBodyweightKg > 0 ? 1 + externalLoadKg / userBodyweightKg : 1;
  return (
    node.difficultyAnchor *
    reps *
    tempoScale *
    proximityFactor *
    externalLoadFactor
  );
}
