/**
 * Power Emphasis Phase 3 — main-lift transforms.
 *
 * When the wizard's "Add power emphasis" toggle is on, two engine-level
 * shifts apply to strength-led archetypes (`strength_anchor`,
 * `hypertrophy_anchor`, `concurrent_hybrid`):
 *
 *   1. **Intensity clamp + reps rewrite** — top-set load is capped at
 *      90% TM and any working set above 85% TM has its rep target
 *      rewritten to 3. This trades the 1RM-grinder peak for a sweet
 *      spot closer to where peak power output lives on the
 *      force-velocity curve (40–70% 1RM; Sale 1992 / Häkkinen 1985
 *      lineage). A "compensatory acceleration" cue is attached to top
 *      sets so the lifter knows to move every rep as fast as possible
 *      (Schoenfeld 2017 review on velocity-cued intent vs grinder reps).
 *
 *   2. **Pre-session potentiation** — when the day is a strength day,
 *      a single 3 × 3–5 explosive movement is *prepended* to the
 *      prescription. The picker matches the day's primary lift
 *      pattern to a tagged movement (power_plyometric /
 *      power_ballistic / power_olympic). Research basis: PAP / PAPE
 *      meta-analyses (Seitz & Haff 2016; Boullosa 2018) showing
 *      ~3–5% boost in subsequent heavy-lift output when preceded by
 *      a brief explosive primer ~4–8 min earlier.
 *
 * The transform is a no-op for endurance / maintenance / rebuild
 * archetypes — they don't have heavy strength to cap, so the clamp
 * has nothing to clamp, and the potentiation pass is gated on the
 * archetype list below.
 */
import type { PrescriptionItem } from "@hta/db";
import type { DeclaredExperience } from "@hta/engine";
import type { ArchetypeId, StrengthRole } from "./archetypes";
import type { CatalogMovement } from "./accessory-picker";
import { filterForExperienceTier, movementValueNorm, ROTATION_BASE, ACCESSORY_VALUE_BONUS } from "./accessory-picker";
import { POWER_FUNCTIONAL_ROLES, type FunctionalRole } from "./accessory-roles";

/**
 * Archetypes where power emphasis transforms apply. Endurance /
 * maintenance / rebuild aren't in here — they don't carry the heavy
 * main-lift work the transforms target, so the toggle stays a no-op
 * at the main-lift level on those (it still biases accessories
 * upstream when relevant, per Phase 1+2).
 */
export const POWER_EMPHASIS_ARCHETYPES = new Set<ArchetypeId>([
  "strength_anchor",
  "hypertrophy_anchor",
  "concurrent_hybrid",
]);

/** Intensity ceiling on any main-lift working set when power on (Sale 1992 / Häkkinen 1985). */
export const POWER_MAIN_INTENSITY_CAP = 0.90;

/** Above this threshold the rep target is rewritten to 3 (heavy single → triple). */
export const POWER_REPS_REWRITE_THRESHOLD = 0.85;

/** Rep target for any set above the rewrite threshold. */
export const POWER_REPS_TARGET = 3;

/** Compensatory-acceleration cue surfaced to the UI via `meta.cue`. */
export const COMPENSATORY_ACCELERATION_CUE =
  "Compensatory acceleration — move every rep as fast as possible.";

/** Rest-window guidance on the potentiation primer (PAPE window). */
export const POTENTIATION_REST_GUIDANCE =
  "Rest 4–8 min before your main lift (PAPE window: Seitz & Haff 2016; Boullosa 2018).";

/**
 * In-place mutation: clamp + reps rewrite on the main items of a
 * strength-day prescription. Operates only on items with
 * `kind: "main"` and a known `percentTm`. Other kinds are left alone.
 *
 * Returns the same array reference for chainability.
 *
 * Citation rationale: peak mechanical power output on multi-joint
 * compound lifts sits around 40–70% 1RM (force-velocity curve, Sale
 * 1992; Häkkinen 1985), so 85–90% caps preserve enough load to keep
 * the strength signal while staying out of the grind-zone that
 * compromises bar speed. Velocity-cued execution (compensatory
 * acceleration) re-introduces an RFD stimulus that high-percentage
 * grinders lose (Schoenfeld 2017 review).
 */
export function applyPowerClampToMainItems(items: PrescriptionItem[]): PrescriptionItem[] {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || item.kind !== "main") continue;
    if (item.percentTm == null) continue;

    const cappedPct = Math.min(item.percentTm, Math.round(POWER_MAIN_INTENSITY_CAP * 100));
    const repsRewritten = item.percentTm > Math.round(POWER_REPS_REWRITE_THRESHOLD * 100);
    const nextReps = repsRewritten ? POWER_REPS_TARGET : item.reps;

    items[i] = {
      ...item,
      percentTm: cappedPct,
      reps: nextReps,
      intensityLabel: `${cappedPct}% TM`,
      meta: {
        ...(item.meta ?? {}),
        cue: COMPENSATORY_ACCELERATION_CUE,
        powerEmphasis: true,
        ...(repsRewritten ? { repsRewrittenFrom: item.reps ?? null } : {}),
        ...(cappedPct < item.percentTm ? { cappedFromPercentTm: item.percentTm } : {}),
      },
    };
  }
  return items;
}

/**
 * Lift-pattern → preferred functional role + muscle/region hints used
 * by the potentiation picker. The intent is "first tagged movement
 * matching the pattern" — biased toward the pattern's natural
 * specificity, falling back to any tagged power movement on the same
 * pattern axis if the preferred sub-bucket is empty.
 */
type PatternHint = {
  preferredRoles: readonly FunctionalRole[];
  preferredRegions: readonly string[];
  preferredMuscles: readonly string[];
};

const PATTERN_HINTS: Record<StrengthRole, PatternHint> = {
  squat: {
    preferredRoles: ["power_plyometric"],
    preferredRegions: ["knee", "hip", "foot_ankle_calf"],
    preferredMuscles: ["quads", "glutes", "calves"],
  },
  horizontal_press: {
    preferredRoles: ["power_ballistic"],
    preferredRegions: ["shoulder_scapular", "elbow_forearm"],
    preferredMuscles: ["chest", "upper_chest", "triceps", "pecs"],
  },
  deadlift: {
    // Posterior-chain plyo (broad jump) OR hinge ballistic (american swing).
    preferredRoles: ["power_plyometric", "power_ballistic"],
    preferredRegions: ["hamstring_posterior", "hip", "lumbar_trunk"],
    preferredMuscles: ["hamstrings", "glutes", "posterior_chain"],
  },
  vertical_press: {
    // Overhead derivatives — push-press / push-jerk (oly) or overhead throws (ballistic).
    preferredRoles: ["power_olympic", "power_ballistic"],
    preferredRegions: ["shoulder_scapular"],
    preferredMuscles: ["shoulders", "delts", "triceps"],
  },
};

export type PotentiationPick = {
  movement: CatalogMovement;
  reason: "pattern_match" | "fallback_any_power";
};

/**
 * Pick the first power-tagged movement matching the day's strength
 * role. Honours blocked regions and the tendinopathy flag (a
 * high-strain-tendon plyo / oly variant on a symptomatic tendon would
 * be unsafe — DC-J5 / DC-O3).
 *
 * Returns `null` if no clean candidate exists — caller silently skips
 * the potentiation pass rather than degrading to an unrelated pick.
 */
export function pickPotentiationMovement({
  strengthRole,
  catalog,
  blockedRegions,
  blockedMuscles,
  allowedMovementIds,
  tendinopathyActive,
  recentlyUsedMovementIds,
  experience = null,
}: {
  strengthRole: StrengthRole;
  catalog: CatalogMovement[];
  blockedRegions: Set<string>;
  /** Optional — see PR `feat/limitations-v2-lifecycle`. */
  blockedMuscles?: Set<string>;
  /** Optional — see PR `feat/limitations-v2-lifecycle`. */
  allowedMovementIds?: Set<string>;
  tendinopathyActive: boolean;
  recentlyUsedMovementIds: Set<string>;
  /**
   * Declared training experience. Beginner / novice tiers suppress
   * plyometric / ballistic / Olympic potentiation primers — same gate
   * as the accessory picker. `null` leaves selection unfiltered.
   * See `experience-tier-scope.md` §4.
   */
  experience?: DeclaredExperience | null;
}): PotentiationPick | null {
  const hint = PATTERN_HINTS[strengthRole];
  const allowedRoles = new Set<FunctionalRole>(POWER_FUNCTIONAL_ROLES as readonly FunctionalRole[]);

  // Experience-tier gate (PR W2 / Option B). Applied here too because
  // this picker doesn't go through `pickAccessoriesForSession` — the
  // primer is prepended directly by `assemblePrescriptionItems`.
  const tierFiltered = filterForExperienceTier(catalog, experience);

  const safe = tierFiltered.filter((m) => {
    const hasPowerRole = m.functionalRoles.some((r) => allowedRoles.has(r));
    if (!hasPowerRole) return false;
    if (loadsBlockedRegion(m, blockedRegions)) return false;
    if (loadsBlockedMuscleHere(m, blockedMuscles, allowedMovementIds)) return false;
    if (tendinopathyActive && m.highStrainTendon) return false;
    return true;
  });
  if (safe.length === 0) return null;

  // Stable score: lower is better. Pattern-match is heavily preferred;
  // recently-used demoted; higher stim-to-fatigue prized.
  const score = (m: CatalogMovement): number => {
    let s = 0;
    const matchesPreferredRole = m.functionalRoles.some((r) =>
      (hint.preferredRoles as readonly FunctionalRole[]).includes(r),
    );
    if (!matchesPreferredRole) s += 50;
    const matchesRegion =
      hint.preferredRegions.includes(m.primaryRegion) ||
      m.secondaryRegions.some((r) => hint.preferredRegions.includes(r));
    if (!matchesRegion) s += 20;
    const matchesMuscle =
      m.primaryMuscles.some((mu) => hint.preferredMuscles.includes(mu)) ||
      m.secondaryMuscles.some((mu) => hint.preferredMuscles.includes(mu));
    if (!matchesMuscle) s += 10;
    // ADR 0012 — value-weighted block rotation (mirrors the accessory
    // picker). Inert when there is no prior block (empty recency set), so
    // structural pattern-matching is the sole driver on first blocks.
    if (recentlyUsedMovementIds.size > 0) {
      const value = movementValueNorm(m);
      if (recentlyUsedMovementIds.has(m.id)) s += ROTATION_BASE * (1 - value);
      s -= ACCESSORY_VALUE_BONUS * value;
    }
    if (m.stimToFatigueScore != null) s -= m.stimToFatigueScore;
    return s;
  };

  // Deterministic tiebreak — sort by slug after the score so the
  // "FIRST tagged movement matching the pattern" intent is stable
  // across runs (no RNG, no hidden ordering).
  safe.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return a.slug.localeCompare(b.slug);
  });
  const best = safe[0];
  if (!best) return null;
  const reason: PotentiationPick["reason"] = best.functionalRoles.some((r) =>
    (hint.preferredRoles as readonly FunctionalRole[]).includes(r),
  )
    ? "pattern_match"
    : "fallback_any_power";
  return { movement: best, reason };
}

/**
 * Build a `power_potentiation` prescription item for the picked
 * movement. Defaults to 3 × 5 reps — the upper end of the 3–5 rep
 * window cited by Seitz & Haff 2016 / Boullosa 2018 — but caller can
 * override reps to lean toward 3 for heavier ballistic / Olympic
 * derivatives.
 */
export function buildPotentiationItem(
  movement: CatalogMovement,
  opts: { sets?: number; reps?: number } = {},
): PrescriptionItem {
  const sets = opts.sets ?? 3;
  const reps = opts.reps ?? 5;
  return {
    movementId: movement.id,
    movementSlug: movement.slug,
    movementName: movement.displayName,
    kind: "power_potentiation",
    sets,
    reps,
    intensityLabel: "Explosive primer",
    notes: "PAPE primer — 3 sets × 3–5 reps, full intent, full recovery between sets.",
    meta: {
      cue: "Maximum bar / body velocity. Stop a rep short of grind.",
      restBeforeMainLift: POTENTIATION_REST_GUIDANCE,
      pap: true,
    },
  };
}

function loadsBlockedRegion(m: CatalogMovement, blocked: Set<string>): boolean {
  if (blocked.has(m.primaryRegion)) return true;
  for (const r of m.secondaryRegions) if (blocked.has(r)) return true;
  return false;
}

/**
 * Muscle-level drop introduced in PR `feat/limitations-v2-lifecycle`.
 * Local copy of the same predicate that lives in accessory-picker —
 * both pickers share the rule but neither owns it as a public export.
 * If/when a third site needs it, lift to `./limitations-filter.ts`.
 */
function loadsBlockedMuscleHere(
  m: CatalogMovement,
  blockedMuscles: Set<string> | undefined,
  allowedMovementIds: Set<string> | undefined,
): boolean {
  if (!blockedMuscles || blockedMuscles.size === 0) return false;
  if (allowedMovementIds?.has(m.id)) return false;
  for (const mu of m.primaryMuscles) if (blockedMuscles.has(mu)) return true;
  for (const mu of m.secondaryMuscles) if (blockedMuscles.has(mu)) return true;
  return false;
}

/**
 * True when the wizard toggle should cause an engine-level transform on
 * the given archetype. Centralised so the picker, the action wiring,
 * and tests stay in lockstep.
 */
export function archetypeSupportsPowerTransforms(id: ArchetypeId): boolean {
  return POWER_EMPHASIS_ARCHETYPES.has(id);
}
