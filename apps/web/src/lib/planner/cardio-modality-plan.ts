/**
 * ADR 0039 — specificity-aware cardio modality plan (pure).
 *
 * Decides, per cardio day, WHICH modality the session should be prescribed in,
 * so the engine protects goal-specific work and may diversify the transferable
 * aerobic base toward a lower-interference modality on strength-constrained
 * blocks. It produces a per-day ranked modality preference that is fed to the
 * existing ADR 0017 resolver (`resolvePreferredCardioModality`), reusing its
 * equipment/tier/kind feasibility logic — this module only decides the ranking.
 *
 * Design (signed off 2026-06-08):
 *   1. Goal modality  = upcoming A-priority event → user preference → running.
 *   2. Specificity     = quality (vo2/threshold/alactic) + the anchor long Z2 are
 *      specificity-critical and stay in the goal modality; the shorter easy Z2
 *      base is diversifiable.
 *   3. Diversify only on strength-constrained blocks (not pure-cardio).
 *   4. Diversify target = the lowest-interference owned modality, and ONLY when
 *      it is lower-interference than the goal (so a cyclist's base stays cycling;
 *      only a runner's filler moves to e.g. the bike).
 *   5. Specific sessions override a generic vehicle preference; the diversifiable
 *      base respects an explicit preference.
 *
 * SAFETY: the new behaviour activates ONLY when the goal comes from a confirmed
 * event (`source === "event"`). With no event, every day returns the user's
 * existing preference list, so the ADR 0017 call is unchanged and the
 * prescription is byte-identical to today. Grounded in Wilson 2012 (modality
 * interference) + SAID/specificity (central transfers, peripheral is specific).
 */
import type { ArchetypeId, CardioDay } from "./archetypes";
import type { PreferredCardioModality } from "./preferred-cardio-modality";

/** Map a stored `events.modality` value to a cardio modality, or null. */
export function goalModalityFromEvent(
  eventModality: string | null | undefined,
): PreferredCardioModality | null {
  switch ((eventModality ?? "").toLowerCase().trim()) {
    case "run":
      return "running";
    case "bike":
      return "cycling";
    case "swim":
      return "swimming";
    case "row":
      return "rowing";
    case "ski":
      return "ski_erg";
    // strength / padel / other → no cardio goal modality.
    default:
      return null;
  }
}

export type GoalModalitySource = "event" | "preference" | "default";
export interface GoalModality {
  modality: PreferredCardioModality | null;
  source: GoalModalitySource;
}

/**
 * Resolve the block's goal cardio modality. Event (A-priority) wins; else the
 * user's top stated preference; else running (the archetype default). Only an
 * `event` source unlocks the specificity/diversification behaviour.
 */
export function resolveGoalModality(args: {
  eventModality: string | null | undefined;
  preferred: readonly PreferredCardioModality[];
}): GoalModality {
  const fromEvent = goalModalityFromEvent(args.eventModality);
  if (fromEvent) return { modality: fromEvent, source: "event" };
  if (args.preferred.length > 0) {
    return { modality: args.preferred[0]!, source: "preference" };
  }
  return { modality: "running", source: "default" };
}

/**
 * Per-modality interference cost (lower = friendlier to concurrent strength),
 * keyed by `PreferredCardioModality`. Mirrors `MODALITY_INTERFERENCE`
 * (`engine/concurrent-scalar.ts`, Wilson 2012) translated to the planner's
 * modality vocabulary; modalities absent there default to the `other` cost.
 */
const MODALITY_INTERFERENCE_RANK: Record<PreferredCardioModality, number> = {
  running: 1.0,
  rucking: 0.8,
  swimming: 0.6,
  rowing: 0.5,
  cycling: 0.4,
  ski_erg: 0.4,
  elliptical: 0.7,
  stair: 0.7,
  sled: 0.7,
};

/** Substitutable modalities ordered by ascending interference cost. */
const DIVERSIFY_ORDER: readonly PreferredCardioModality[] = (
  Object.keys(MODALITY_INTERFERENCE_RANK) as PreferredCardioModality[]
).sort((a, b) => MODALITY_INTERFERENCE_RANK[a] - MODALITY_INTERFERENCE_RANK[b]);

/**
 * Is auto-diversification (moving the non-specific base off the goal modality)
 * enabled for this block? True only when strength is a real concurrent
 * constraint — never on a pure-cardio block, where specificity wins.
 */
export function diversificationEnabled(
  archetypeId: ArchetypeId,
  secondaryFocus: string | null,
): boolean {
  if (archetypeId === "endurance_anchor") {
    // Pure cardio (no strength/muscle secondary) keeps everything in-sport.
    return secondaryFocus === "strength" || secondaryFocus === "muscle";
  }
  if (archetypeId === "concurrent_hybrid") return true;
  if (archetypeId === "strength_anchor") return true; // strength primary, cardio is filler
  return false; // maintenance / rebuild / custom — not a concurrent build
}

export type CardioSpecificity = "quality" | "anchor_long" | "diversifiable";

/** The single specificity-anchor long Z2 day (longest; prefers a "long" role). */
function anchorLongDay(allCardioDays: readonly CardioDay[]): CardioDay | null {
  const z2 = allCardioDays.filter((d) => d.cardioKind === "cardio_z2");
  if (z2.length === 0) return null;
  const longRole = z2.filter((d) => (d.role ?? "").includes("long"));
  const pool = longRole.length > 0 ? longRole : z2;
  return pool.reduce((best, d) => {
    const bd = best.durationMin ?? 0;
    const dd = d.durationMin ?? 0;
    if (dd > bd) return d;
    if (dd === bd && d.dayIndex < best.dayIndex) return d;
    return best;
  });
}

const sameDay = (a: CardioDay, b: CardioDay): boolean =>
  a.dayIndex === b.dayIndex && (a.slot ?? "single") === (b.slot ?? "single") && a.role === b.role;

/** Classify a cardio day's specificity relative to the block's cardio set. */
export function classifyCardioSpecificity(
  day: CardioDay,
  allCardioDays: readonly CardioDay[],
): CardioSpecificity {
  if (
    day.cardioKind === "cardio_vo2" ||
    day.cardioKind === "cardio_threshold" ||
    day.cardioKind === "cardio_alactic"
  ) {
    return "quality";
  }
  if (day.cardioKind === "cardio_z2") {
    const anchor = anchorLongDay(allCardioDays);
    if (anchor && sameDay(day, anchor)) return "anchor_long";
    return "diversifiable";
  }
  return "diversifiable";
}

/**
 * The ranked modality preference to feed the ADR 0017 resolver for one cardio
 * day. Returns the user's existing preference list unchanged whenever the goal
 * is not event-derived — so non-event blocks stay byte-identical.
 */
export function modalityPreferenceForDay(args: {
  day: CardioDay;
  allCardioDays: readonly CardioDay[];
  archetypeId: ArchetypeId;
  secondaryFocus: string | null;
  goal: GoalModality;
  userPreferred: readonly PreferredCardioModality[];
}): readonly PreferredCardioModality[] {
  const { day, allCardioDays, archetypeId, secondaryFocus, goal, userPreferred } = args;
  // New behaviour requires a confirmed event goal; else today's behaviour.
  if (goal.source !== "event" || !goal.modality) return userPreferred;
  const goalModality = goal.modality;

  const spec = classifyCardioSpecificity(day, allCardioDays);
  // Specificity-critical work → goal modality, overriding a generic vehicle
  // preference (a runner's intervals stay runs even if they "prefer" the bike).
  if (spec === "quality" || spec === "anchor_long") {
    return [goalModality];
  }

  // Diversifiable base: respect an explicit preference first (decision 5).
  if (userPreferred.length > 0) return userPreferred;

  // Else auto-diversify toward a LOWER-interference modality, only when strength
  // is a constraint. Candidates lower than the goal → a cyclist's base stays
  // cycling (no lower option); only a runner's filler drops to e.g. the bike.
  if (diversificationEnabled(archetypeId, secondaryFocus)) {
    const lower = DIVERSIFY_ORDER.filter(
      (m) =>
        m !== goalModality &&
        MODALITY_INTERFERENCE_RANK[m] < MODALITY_INTERFERENCE_RANK[goalModality],
    );
    if (lower.length > 0) return [...lower, goalModality];
  }
  // No diversification → keep the base in the goal modality for consistency.
  return [goalModality];
}
