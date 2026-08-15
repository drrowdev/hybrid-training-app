/**
 * Swap-candidate ranking.
 *
 * When a lifter swaps a movement mid-workout, the picker should lead with the
 * alternatives most LIKE the one being replaced — same target muscles, same
 * intended role, same region — rather than an alphabetical list of everything in
 * the pattern bucket. This module scores each candidate against the original on
 * those signals so the API can return them best-first and flag the top few as
 * "Recommended".
 *
 * Pure (no IO) so the scoring is unit-testable; the route supplies the rows.
 */

export type SwapMovementFields = {
  id: string;
  slug: string;
  display_name: string;
  equipment: string | null;
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
  primary_region?: string | null;
  functional_roles?: string[] | null;
  bulletproof_roles?: string[] | null;
  is_compound?: boolean | null;
  is_supported?: boolean | null;
};

/** A scored, ordered candidate as returned to the client. */
export type RankedSwapCandidate = {
  id: string;
  slug: string;
  display_name: string;
  equipment: string | null;
  /** Similarity score vs the original (higher = closer match). */
  score: number;
  /** True for the leading, genuinely-similar matches (surfaced as "Recommended"). */
  recommended: boolean;
  /**
   * True when this workout ALREADY prescribes the movement in another slot.
   * Swapping into it would put the same movement in two places, which the
   * session UI then has to render as two separate cards for one lift. Never
   * offered as a recommendation; only reachable by explicitly searching for it.
   */
  alreadyInSession?: boolean;
};

// Weights — a primary-muscle match is the strongest "this trains the same thing"
// signal; shared role and region reinforce it; compound/supported parity are
// minor tie-breakers. Heuristic (CP-1), no calibration data.
const W_PRIMARY_MUSCLE = 10;
const W_SECONDARY_MUSCLE = 3;
const W_ROLE = 6;
const W_REGION = 8;
const W_COMPOUND = 3;
const W_SUPPORTED = 2;

/** Number of leading candidates eligible to be tagged "Recommended". */
const RECOMMENDED_MAX = 3;
/**
 * A candidate must clear this score to be "Recommended" — enough to require at
 * least a real overlap signal (one shared primary muscle, or region + a shared
 * role), not merely the same coarse pattern bucket.
 */
const RECOMMENDED_MIN_SCORE = W_PRIMARY_MUSCLE;

function overlapCount(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const set = new Set(a);
  let n = 0;
  for (const x of b) if (set.has(x)) n += 1;
  return n;
}

/**
 * Movement ids the workout already prescribes, minus the one being replaced.
 *
 * Feeds `RankSwapOptions.movementIdsInSession`. Structural input so this stays
 * usable for a planned_session prescription, a quick-workout session
 * prescription, or a plain movement-id list from `session_movements`.
 */
export function prescribedMovementIds(
  prescription: { items?: ReadonlyArray<{ movementId?: string | null }> | null } | null,
  options: { exclude?: string | null } = {},
): string[] {
  const out: string[] = [];
  for (const item of prescription?.items ?? []) {
    const id = item?.movementId;
    if (typeof id !== "string" || id.length === 0) continue;
    if (options.exclude != null && id === options.exclude) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Similarity score of `candidate` vs `original` (already same pattern). */
export function scoreSwapCandidate(
  original: SwapMovementFields,
  candidate: SwapMovementFields,
): number {
  let score = 0;
  score += overlapCount(original.primary_muscles, candidate.primary_muscles) * W_PRIMARY_MUSCLE;
  score += overlapCount(original.secondary_muscles, candidate.secondary_muscles) * W_SECONDARY_MUSCLE;
  score += overlapCount(original.functional_roles, candidate.functional_roles) * W_ROLE;
  score += overlapCount(original.bulletproof_roles, candidate.bulletproof_roles) * W_ROLE;
  if (
    original.primary_region != null &&
    candidate.primary_region != null &&
    original.primary_region === candidate.primary_region
  ) {
    score += W_REGION;
  }
  if (
    original.is_compound != null &&
    candidate.is_compound != null &&
    original.is_compound === candidate.is_compound
  ) {
    score += W_COMPOUND;
  }
  if (
    original.is_supported != null &&
    candidate.is_supported != null &&
    original.is_supported === candidate.is_supported
  ) {
    score += W_SUPPORTED;
  }
  return score;
}

/**
 * Options controlling which candidates are offered.
 */
export type RankSwapOptions = {
  /**
   * Movement ids the session ALREADY prescribes (excluding the movement being
   * replaced). Suggesting one of these produces a duplicate movement in a
   * single workout, which the session view then has to split across two cards
   * for the same lift — and which the plain "same pattern" ranker happily puts
   * at the top (barbell hip thrust is a `hinge`, so it outranks most things
   * when you swap a deadlift, even when the day already includes it).
   */
  movementIdsInSession?: Iterable<string>;
  /**
   * `"recommend"` (default) drops already-present movements outright — the list
   * is a curated set of suggestions and a duplicate is never a good suggestion.
   * `"search"` keeps them, because the user typed the name and hiding the
   * result with no explanation is worse; they are flagged `alreadyInSession`,
   * never `recommended`, and sorted below every non-duplicate.
   */
  mode?: "recommend" | "search";
};

/**
 * Rank candidates best-first by similarity to the original, breaking ties
 * alphabetically (stable, predictable). The leading `RECOMMENDED_MAX` whose
 * score clears `RECOMMENDED_MIN_SCORE` are flagged `recommended`.
 *
 * Movements already prescribed elsewhere in the session are excluded (or, when
 * searching, demoted and flagged) — see `RankSwapOptions`.
 */
export function rankSwapCandidates(
  original: SwapMovementFields,
  candidates: ReadonlyArray<SwapMovementFields>,
  options: RankSwapOptions = {},
): RankedSwapCandidate[] {
  const inSession = new Set(options.movementIdsInSession ?? []);
  const searching = options.mode === "search";
  const pool =
    !searching && inSession.size > 0
      ? candidates.filter((c) => !inSession.has(c.id))
      : candidates;
  const scored = pool.map((c) => ({
    id: c.id,
    slug: c.slug,
    display_name: c.display_name,
    equipment: c.equipment,
    score: scoreSwapCandidate(original, c),
    recommended: false,
    ...(inSession.has(c.id) ? { alreadyInSession: true } : {}),
  }));
  scored.sort((a, b) => {
    const aDup = a.alreadyInSession === true ? 1 : 0;
    const bDup = b.alreadyInSession === true ? 1 : 0;
    if (aDup !== bDup) return aDup - bDup;
    return b.score !== a.score
      ? b.score - a.score
      : a.display_name.localeCompare(b.display_name);
  });
  for (let i = 0; i < scored.length && i < RECOMMENDED_MAX; i++) {
    const c = scored[i]!;
    if (c.alreadyInSession === true) continue;
    if (c.score >= RECOMMENDED_MIN_SCORE) c.recommended = true;
  }
  return scored;
}
