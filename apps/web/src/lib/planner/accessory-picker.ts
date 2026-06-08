/**
 * Accessory picker — dynamic, role-based, no hardcoded movement slugs.
 *
 * Pure function. Given:
 *   - the archetype's AccessoryProfile
 *   - the week's deload scalar
 *   - the day being generated (kind + role)
 *   - the rolling week context (what's already been picked for this week)
 *   - the tagged catalog of candidate movements
 *   - filters: limitations, concurrent stress, recent-history rotation
 *   - the user's equipment inventory (optional; when present, candidates
 *     whose inferred required implement is missing are dropped before
 *     ranking)
 *
 * Returns a list of accessory items to append to this day's prescription,
 * in priority order (durability deficit > functional deficit > aesthetic
 * gap-fill).
 *
 * Per docs/design/accessory-schema.md §21. The picker NEVER reads a
 * specific slug from the archetype config — all decisions flow from
 * role tags on the catalog.
 *
 * Equipment filtering applies to *every* candidate the picker considers
 * (it only ever produces accessory/tendon-class picks — main lifts come
 * from the TM-resolved variant path in `actions.ts` and bypass the
 * picker entirely). The filter is intentionally conservative: when the
 * slug doesn't clearly imply a specific implement, `inferRequiredEquipment`
 * returns `bodyweight_or_generic` and the movement is allowed through.
 */
import type {
  AccessoryProfile,
  BulletproofRole,
  FunctionalRole,
} from "./accessory-roles";
import {
  DC_O4_FLOOR,
  FLOOR_PLYOMETRIC_TOTAL,
  POWER_FUNCTIONAL_ROLES,
  effectiveDurabilityFloor,
} from "./accessory-roles";
import type { DeclaredExperience } from "@hta/engine";
import type { Equipment } from "@/lib/settings/equipment-schema";
import {
  isEquipmentAvailable,
  resolveRequiredEquipment,
} from "./equipment-requirements";
import { declaredExperienceToTier, tierInBand } from "./experience-tier";
import { inferAccessoryBucket } from "./accessory-intensity";
import { accessoryRationale } from "./accessory-rationale";
import { FOCUS_LANDMARKS } from "./focus-muscle-targets";
import type { AccessoryBucket } from "./accessory-intensity";

/**
 * Experience tiers that should NOT see plyometric / ballistic / Olympic
 * variants land in their prescription. The declared-tier (`profiles.training_experience`)
 * is the only signal — actual barbell strength is gated separately
 * via TM-resolved variants in `actions.ts`.
 *
 * @deprecated PR W2 replaces this set-based "beginner gate" with the
 * proper experience-band columns on every movement (see
 * `experience-tier-scope.md` §3 Option B). Kept exported so the legacy
 * PR W1 tests keep passing — the value still has the same membership
 * the predicate uses today.
 */
export const BEGINNER_TIERS: ReadonlySet<DeclaredExperience> = new Set([
  "beginner_lt_6m",
  "novice_6m_2y",
]);

/**
 * Power-role tags blocked for beginner / novice tiers when the legacy
 * gate is active.
 *
 * @deprecated Retained for the PR W1 backwards-compat surface. The PR W2
 * filter (`filterForExperienceTier`) uses the per-movement
 * `experienceMin` / `experienceMax` band instead.
 */
const BLOCKED_POWER_ROLES: ReadonlySet<FunctionalRole> = new Set<FunctionalRole>([
  "power_plyometric",
  "power_ballistic",
  "power_olympic",
]);

/**
 * True when the declared experience tier should suppress power-tagged
 * movements from the prescription. Returns false for `null` so users
 * who haven't declared a tier yet keep the current (unfiltered)
 * behaviour — conservative default per the scope doc.
 *
 * @deprecated Use `declaredExperienceToTier` + `tierInBand` instead.
 * Kept for the PR W1 power-filter unit tests (which now pass through to
 * the same outcome: beginner / novice tiers don't see plyometric / oly /
 * ballistic rows because those rows are curated `experienceMin >= 2`).
 */
export function blocksPowerMovements(
  experience: DeclaredExperience | null,
): boolean {
  if (!experience) return false;
  return BEGINNER_TIERS.has(experience);
}

/**
 * Drop power-tagged candidates from a catalog when the declared tier
 * is a beginner one.
 *
 * @deprecated PR W2 replaces this with `filterForExperienceTier`, which
 * checks the per-movement band on every candidate. Kept as a backwards-
 * compatible alias so the PR W1 unit tests still pass — the new filter
 * is a strict superset (every power-tagged row is curated
 * `experienceMin >= 2` so the legacy behaviour falls out for free).
 */
export function filterPowerForExperience(
  catalog: CatalogMovement[],
  experience: DeclaredExperience | null,
): CatalogMovement[] {
  if (!blocksPowerMovements(experience)) return catalog;
  return catalog.filter(
    (m) => !m.functionalRoles.some((r) => BLOCKED_POWER_ROLES.has(r)),
  );
}

/**
 * PR W2 — drop catalog rows whose curated band excludes the user's
 * declared tier. `null` experience leaves the catalog untouched
 * (conservative default — matches PR #143).
 *
 * Applied BEFORE every dispatch path in `pickAccessoriesForSession`
 * (durability, functional, muscle-gap, power emphasis) and re-used by
 * `pickPotentiationMovement` so the power primer honours the same gate.
 */
export function filterForExperienceTier(
  catalog: CatalogMovement[],
  experience: DeclaredExperience | null,
): CatalogMovement[] {
  const tier = declaredExperienceToTier(experience);
  if (tier == null) return catalog;
  return catalog.filter((m) =>
    tierInBand(tier, m.experienceMin ?? 0, m.experienceMax ?? 4),
  );
}

export type CatalogMovement = {
  id: string;
  slug: string;
  displayName: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  primaryRegion: string;
  secondaryRegions: string[];
  bulletproofRoles: BulletproofRole[];
  functionalRoles: FunctionalRole[];
  isSupported: boolean;
  isCompound: boolean;
  /**
   * ADR 0012 — true when the movement can carry external/added load (so
   * progressive overload across a block is feasible): barbell/dumbbell/
   * cable work and weighted-bodyweight staples (weighted pull-up, dip,
   * chin-up). Surfaced from the DB `body_weight_loaded` column ∪ inherently
   * loadable patterns. Optional for legacy fixture catalogs; absent ⇒ false.
   */
  isLoadable?: boolean;
  eccentricLoadScore: number | null; // 1..5; null = unknown
  stimToFatigueScore: number | null; // 1..5; null = unknown
  highStrainTendon: boolean;
  /**
   * PR W2 experience band — see `experience-tier.ts`. Optional on the
   * type so legacy fixture catalogs (built before the column shipped)
   * stay compileable. Resolvers always read with `?? 0` / `?? 4` so an
   * absent value means "universally applicable".
   */
  experienceMin?: number;
  experienceMax?: number;
  /**
   * DB `movements.pattern`. Used to exclude cardio movements (`"cardio"`)
   * from the strength-accessory candidate pool — they're conditioning, not
   * accessories, and render nonsensically through the accessory-intensity
   * path. Optional so legacy fixture catalogs (no pattern) are unaffected.
   */
  pattern?: string | null;
  /**
   * DB `movements.equipment` tag (e.g. `"machine-reverse-pec"`, `"erg"`,
   * `"barbell"`). Authoritative input to equipment filtering for the
   * machine/cable family via `resolveRequiredEquipment`. Optional so
   * legacy fixtures fall back to slug inference unchanged.
   */
  equipment?: string | null;
};

export type WeekAccessoryHistoryItem = {
  /** Movement that was already prescribed earlier in this generated week. */
  movementId: string;
  bulletproofRoles: BulletproofRole[];
  functionalRoles: FunctionalRole[];
  primaryMuscles: string[];
  /**
   * Set count this item contributed (ADR 0022). The per-muscle aesthetic
   * progress accumulator is denominated in **sets/week** to match the
   * `perMuscleTargets` units. When omitted (legacy callers / fixtures that
   * never recorded it) the picker falls back to `profile.aesthetic.setsPerItem`
   * — "assume one standard exposure at the archetype base." Production always
   * supplies the real value via the assembler.
   */
  sets?: number;
};

export type PickFilters = {
  /** Regions with active limitations — movements loading these are filtered out. */
  blockedRegions: Set<string>;
  /**
   * Muscles flagged by any active limitation. A movement with any of
   * these as a primary OR secondary muscle is dropped — UNLESS the
   * movement's id is in `allowedMovementIds` (user-asserted exception).
   * Optional for back-compat with legacy test fixtures.
   */
  blockedMuscles?: Set<string>;
  /**
   * Specific catalog movement ids flagged by any active limitation
   * (`affected_movement_ids`). An unconditional drop — NOT bypassed by
   * `allowedMovementIds` (if the user flagged this exact movement as
   * affected, we don't prescribe it). ADR 0014. Optional for back-compat.
   */
  blockedMovementIds?: Set<string>;
  /**
   * Per-exercise allow-list across all active limitations. Movements
   * here bypass the muscle-level drop. Region drops still apply.
   * Optional for back-compat with legacy test fixtures.
   */
  allowedMovementIds?: Set<string>;
  /** True when the user is currently under concurrent stress (≥4h endurance OR ≥3 cardio/wk). */
  concurrentStressActive: boolean;
  /** Movements used in the PREVIOUS block for the same day-role; value-weighted demotion (ADR 0012). */
  recentlyUsedMovementIds: Set<string>;
  /** True when any tendinopathy flag is active — suppresses plyometric_*. */
  tendinopathyActive: boolean;
};

export type AccessoryPick = {
  movementId: string;
  slug: string;
  displayName: string;
  sets: number;
  reps: number;
  reason: "durability" | "functional" | "aesthetic" | "power";
  rationale: string;
};

const PER_MUSCLE_TARGETS_FALLBACK = 6; // default per-muscle weekly target when archetype is silent

/**
 * Main entry point. Returns picks in priority order (durability first).
 * Caller is responsible for stopping at the archetype's per-session item cap.
 *
 * `powerEmphasis` (wizard step 2 toggle, persisted on
 * `training_blocks.power_emphasis`) inserts a "power bias" pass between
 * functional and aesthetic — one power-tagged accessory per session when
 * the catalog has a clean candidate, and trims the per-session aesthetic
 * budget so explosive intent isn't drowned in high-rep hypertrophy work
 * (Schoenfeld 2017 review).
 */
export function pickAccessoriesForSession({
  profile,
  weekDeloadScale,
  catalog,
  weekAccessoryHistory,
  filters,
  perMuscleTargets,
  maxItems,
  aestheticMaxItems,
  powerEmphasis = false,
  equipment,
  experience = null,
  compoundCoverageCredit,
  focusMuscles = [],
  runningCardio = false,
  dayPrimaryRole,
  pressingMainLift = false,
  variationSeed,
}: {
  profile: AccessoryProfile;
  /** Deload scalar from the week profile (e.g. 0.5 on deload weeks). */
  weekDeloadScale: number;
  catalog: CatalogMovement[];
  /** Accessories already prescribed earlier this week — credited toward the weekly role/muscle floors. Mutated in place by the assembler across the week's days. */
  weekAccessoryHistory: WeekAccessoryHistoryItem[];
  filters: PickFilters;
  /** Per-muscle weekly aesthetic target (already concurrent-modifier-applied by caller). */
  perMuscleTargets: Record<string, number>;
  /** Hard cap on items for this session — typically archetype.aesthetic.itemsPerSession + a small budget for functional/durability fills. */
  maxItems: number;
  /**
   * Separate, usually smaller cap on the AESTHETIC (hypertrophy gap-fill)
   * section only. The durability + functional floors may use the full
   * `maxItems`; aesthetic fills stop at this lower budget. Lets the caller
   * hold a tissue-prep floor/functional reserve OUTSIDE the onboarding ramp
   * (so a beginner's ramp compresses hypertrophy breadth but never the DC-O4
   * floor) without that reserve leaking into extra aesthetic volume. Defaults
   * to `maxItems` — byte-identical to the single-cap behaviour for every
   * existing call site. See ADR 0024 addendum + tendon-floor invariant.
   */
  aestheticMaxItems?: number;
  /** Wizard toggle. Biases the picker toward power-tagged movements + trims hypertrophy filler. */
  powerEmphasis?: boolean;
  /**
   * User equipment inventory from `profiles.equipment`. When supplied,
   * candidates whose inferred required implement is missing are
   * dropped from the pool. Optional so older call-sites and tests that
   * don't care about equipment keep working unchanged.
   */
  equipment?: Equipment;
  /**
   * Declared training experience from `profiles.training_experience`.
   * When set to a beginner tier (`beginner_lt_6m` / `novice_6m_2y`) the
   * picker filters out plyometric / ballistic / Olympic candidates
   * BEFORE any role/muscle dispatch — bulletproofing every selection
   * path (durability, functional, muscle gap, power emphasis).
   * `null` (user hasn't declared) leaves the catalog untouched.
   * See `experience-tier-scope.md` §4.
   */
  experience?: DeclaredExperience | null;
  /**
   * ADR 0027 Lever B — synergist credit. A muscle → effective-set map of the
   * coverage the week's main compound lifts already deliver to each aesthetic
   * target muscle. Folded into the aesthetic ledger (`muscleProgress`) so the
   * gap-fill prioritises genuinely under-trained muscles instead of muscles the
   * squat/bench/deadlift already train. Optional — omitted by legacy callers
   * and tests, leaving the pre-ADR-0027 ledger untouched. See
   * `synergist-credit.ts`.
   */
  compoundCoverageCredit?: Map<string, number>;
  /**
   * Finding #1 — focus-muscle MEV floor. The user's 0–2 declared focus muscles
   * (from `FOCUS_MUSCLE_ALLOWLIST`). When present, a guaranteed top-up pass runs
   * AFTER the aesthetic gap-fill to bring each focus muscle to at least its MEV
   * landmark (`FOCUS_LANDMARKS[m].building`) in direct sets/week — seated above
   * the aesthetic trim so a low-volume base-1 archetype, whose tissue floor can
   * saturate the per-session cap and starve the gap-fill, still honours the
   * declared focus. Empty (every non-focus user) → the pass no-ops and output is
   * byte-identical. See `focus-muscle-targets.ts` + the substitution-bias path.
   */
  focusMuscles?: readonly string[];
  /**
   * ADR 0034 — true when the block's cardio includes a running-impact day.
   * Drives Phase 1: the week's FIRST HSR fill prefers the Achilles/calf region
   * (highest-probability overuse site for runners). Default false → byte-identical.
   */
  runningCardio?: boolean;
  /**
   * ADR 0034 — the day's primary main-lift role (`squat` / `deadlift` /
   * `horizontal_press` / `vertical_press`). Drives Phase 2: HSR fills not claimed
   * by the running/Achilles preference prefer the day's pattern tendon region
   * (hinge day → posterior, squat day → knee). Undefined → no pattern preference.
   */
  dayPrimaryRole?: string;
  /**
   * ADR 0035 — true when the block has a pressing main lift (vertical_press /
   * horizontal_press as a primary or secondary). When set, the functional floor
   * adds one weekly `shoulder_stability` (rotator-cuff) requirement so an
   * overhead/bench presser carries guaranteed cuff prehab. Default false →
   * byte-identical (the golden harness, custom blocks, and legacy callers omit it).
   */
  pressingMainLift?: boolean;
  /**
   * Quick-generate variation seed (quick-workout path only). Forwarded to each
   * `findCandidate` call (offset per slot so different gaps rotate
   * independently) so consecutive quick generations vary. `undefined` (every
   * planned-block caller) keeps the deterministic best-pick — byte-identical.
   */
  variationSeed?: number;
}): AccessoryPick[] {
  // Cardio movements are conditioning, not strength accessories. They have
  // muscle tags (lats, quads, …) so the aesthetic gap-fill could otherwise
  // pick e.g. "Erg Row — Threshold" as an accessory, where it renders
  // nonsensically through the accessory-intensity path. Exclude them from
  // the candidate pool entirely. Legacy fixtures omit `pattern` (undefined)
  // so they're unaffected.
  const strengthCatalog = catalog.filter((m) => m.pattern !== "cardio");
  const equipmentFiltered = equipment
    ? strengthCatalog.filter((m) =>
        isEquipmentAvailable(resolveRequiredEquipment(m), equipment),
      )
    : strengthCatalog;
  if (equipment && equipmentFiltered.length === 0) {
    // Pathological: every catalog entry was rejected. Surface so we
    // notice in logs rather than silently producing an empty
    // prescription.
    console.warn(
      "[accessory-picker] equipment filter rejected every catalog candidate",
    );
  }
  // PR W2 — experience-tier band gate (Option B). Replaces the
  // PR #143 power-tag filter with a per-movement band check applied
  // BEFORE every dispatch path (durability, functional, muscle gap,
  // power emphasis). The legacy `filterPowerForExperience` is still
  // exported and its tests still pass, but the proper-band filter is
  // a strict superset — every power-tagged row was curated
  // `experienceMin >= 2`, so beginner / novice runs land on the same
  // exclusions plus the new variations-of-variations gates.
  const workingCatalog = filterForExperienceTier(equipmentFiltered, experience);
  const picks: AccessoryPick[] = [];
  const usedThisSession = new Set<string>();

  // Quick-generate variation: hand each `findCandidate` a distinct seed
  // (base + running cursor) so different slots rotate independently. Returns
  // `undefined` for every planned-block caller → deterministic best pick.
  let variationCursor = 0;
  const seedFor = (): number | undefined =>
    variationSeed == null ? undefined : variationSeed + variationCursor++;

  const durFloor = effectiveDurabilityFloor(profile, filters.tendinopathyActive);
  const durabilityProgress = countBulletproofRoles(weekAccessoryHistory);
  const functionalProgress = countFunctionalRoles(weekAccessoryHistory);
  const muscleProgress = countMusclesPrimary(weekAccessoryHistory, profile.aesthetic.setsPerItem);
  // ADR 0027 Lever B — seed the aesthetic ledger with the coverage the week's
  // main compound lifts already deliver, so the gap-fill redirects toward
  // genuinely under-trained muscles. Additive on top of accessory history; only
  // ever credits muscles a main lift trains (covered muscles), so it can
  // de-prioritise but never starve a truly-missed muscle.
  if (compoundCoverageCredit) {
    for (const [muscle, credit] of compoundCoverageCredit) {
      muscleProgress.set(muscle, (muscleProgress.get(muscle) ?? 0) + credit);
    }
  }

  // ─── 1. Durability deficits first ───
  for (const role of orderedBulletproofRoles(durFloor, durabilityProgress)) {
    if (picks.length >= maxItems) break;
    const current = effectiveBulletproofCount(role, durabilityProgress);
    const target = effectiveBulletproofTarget(role, durFloor);
    if (current >= target) continue;
    // ADR 0034 — region preference for the HSR slot. Phase 1: a running-impact
    // block steers its FIRST HSR of the week (none picked yet) to the
    // Achilles/calf region. Phase 2: any later HSR prefers the day's main-lift
    // pattern region (hinge → posterior, squat → knee), so tendon loading is
    // distributed across patterns instead of doubling patellar work. Soft —
    // findCandidate falls back to any in-role HSR when no region match exists.
    let preferRegion: string | undefined;
    if (role === "hsr") {
      const hsrPickedThisWeek = current; // weekly count credited before this fill
      preferRegion =
        runningCardio && hsrPickedThisWeek === 0
          ? RUNNING_HSR_REGION
          : dayPrimaryRole
            ? HSR_REGION_BY_ROLE[dayPrimaryRole]
            : undefined;
    }
    const candidate = findCandidate({
      catalog: workingCatalog,
      requiredBulletproofRole: role,
      preferRegion,
      filters,
      usedThisSession,
      variationSeed: seedFor(),
    });
    if (!candidate) continue;
    // Plain-language reason from the known durability trigger (surfaced as a
    // per-movement "why" spark). The internal bucket name never leaks.
    const pick = buildPick(
      candidate,
      profile,
      weekDeloadScale,
      "durability",
      accessoryRationale({ reason: "durability", bulletproofRole: role }),
    );
    picks.push(pick);
    usedThisSession.add(candidate.id);
    bumpBulletproof(durabilityProgress, candidate.bulletproofRoles);
    bumpFunctional(functionalProgress, candidate.functionalRoles);
    for (const m of candidate.primaryMuscles) {
      muscleProgress.set(m, (muscleProgress.get(m) ?? 0) + pick.sets);
    }
  }

  // ─── 2. Functional deficits ───
  // ADR 0035 — when the block has a pressing main lift, add a weekly
  // `shoulder_stability` (rotator-cuff) requirement on top of the archetype's
  // own functional needs. Gated on `pressingMainLift` → omitted by default, so
  // every legacy caller / golden stays byte-identical. The assembler grants a
  // matching +1 to the total item cap so this seats in its own headroom rather
  // than displacing an aesthetic slot.
  const effectiveFunctionalReqs: [FunctionalRole, number][] = [
    ...(Object.entries(profile.functional.weeklyRoleRequirements) as [FunctionalRole, number][]),
    ...(pressingMainLift ? ([["shoulder_stability", 1]] as [FunctionalRole, number][]) : []),
  ];
  for (const [role, required] of effectiveFunctionalReqs) {
    if (picks.length >= maxItems) break;
    if (!required) continue;
    const current = functionalProgress.get(role) ?? 0;
    if (current >= required) continue;
    const candidate = findCandidate({
      catalog: workingCatalog,
      requiredFunctionalRole: role,
      filters,
      usedThisSession,
      variationSeed: seedFor(),
    });
    if (!candidate) continue;
    // Plain-language reason from the known functional trigger.
    const pick = buildPick(
      candidate,
      profile,
      weekDeloadScale,
      "functional",
      accessoryRationale({ reason: "functional", functionalRole: role }),
    );
    picks.push(pick);
    usedThisSession.add(candidate.id);
    bumpBulletproof(durabilityProgress, candidate.bulletproofRoles);
    bumpFunctional(functionalProgress, candidate.functionalRoles);
    for (const m of candidate.primaryMuscles) {
      muscleProgress.set(m, (muscleProgress.get(m) ?? 0) + pick.sets);
    }
  }

  // ─── 2.5 Power bias (wizard `power_emphasis = true`) ───
  // One power-tagged accessory per session when the catalog has a clean
  // candidate. Per Schoenfeld 2017, RFD/power adaptations and high-rep
  // hypertrophy work compete for the same recovery budget — so we also
  // trim the aesthetic budget below.
  let powerPickAdded = false;
  if (powerEmphasis && picks.length < maxItems) {
    const candidate = findPowerCandidate({
      catalog: workingCatalog,
      filters,
      usedThisSession,
    });
    if (candidate) {
      const pick = buildPick(
        candidate,
        profile,
        weekDeloadScale,
        "power",
        "Power emphasis: explosive intent (3–5 reps, full recovery)",
        { repsOverride: 5, setsOverride: profile.aesthetic.setsPerItem },
      );
      picks.push(pick);
      usedThisSession.add(candidate.id);
      bumpBulletproof(durabilityProgress, candidate.bulletproofRoles);
      bumpFunctional(functionalProgress, candidate.functionalRoles);
      for (const m of candidate.primaryMuscles) {
        muscleProgress.set(m, (muscleProgress.get(m) ?? 0) + pick.sets);
      }
      powerPickAdded = true;
    }
  }

  // ─── 3. Aesthetic gap-fill ───
  // Aesthetic fills are bounded by their OWN budget (`aestheticMaxItems`,
  // defaulting to `maxItems`), which may be lower than the total `maxItems`
  // when the caller reserves floor/functional headroom. When power emphasis is
  // on, trim that budget by ~1 item (and at least leave room for the power pick
  // we just inserted). High-rep hypertrophy fillers blunt the RFD signal —
  // Schoenfeld 2017.
  const aestheticBudget = aestheticMaxItems ?? maxItems;
  const aestheticCap = powerEmphasis
    ? Math.max(picks.length, aestheticBudget - (powerPickAdded ? 0 : 1) - 1)
    : aestheticBudget;
  while (picks.length < aestheticCap) {
    const gapMuscle = pickLargestAestheticGap(perMuscleTargets, muscleProgress);
    if (!gapMuscle) break;
    const candidate = findCandidate({
      catalog: workingCatalog,
      requiredMuscle: gapMuscle,
      filters,
      usedThisSession,
      preferSupported: profile.aesthetic.biasSupported && filters.concurrentStressActive,
      // ADR 0027 Lever A — prefer targeted isolation over a redundant compound.
      demoteCompound: true,
      aestheticEligibleOnly: true,
      variationSeed: seedFor(),
    });
    if (!candidate) {
      // No catalog match for this muscle — mark it satisfied so we don't loop forever.
      muscleProgress.set(gapMuscle, (perMuscleTargets[gapMuscle] ?? PER_MUSCLE_TARGETS_FALLBACK));
      continue;
    }
    const pick = buildPick(
      candidate,
      profile,
      weekDeloadScale,
      "aesthetic",
      // Plain-language reason naming the muscle this fill targets.
      accessoryRationale({ reason: "aesthetic", gapMuscle }),
    );
    picks.push(pick);
    usedThisSession.add(candidate.id);
    bumpBulletproof(durabilityProgress, candidate.bulletproofRoles);
    bumpFunctional(functionalProgress, candidate.functionalRoles);
    for (const m of candidate.primaryMuscles) {
      muscleProgress.set(m, (muscleProgress.get(m) ?? 0) + pick.sets);
    }
  }

  // ─── 4. Focus-muscle MEV floor (Finding #1) ───
  // When the user declared focus muscles, guarantee each reaches at least its
  // MEV landmark (`FOCUS_LANDMARKS[m].building`) in direct sets/week. This is
  // seated ABOVE the aesthetic trim: a low-volume base-1 archetype
  // (endurance / rebuild), whose durability + functional floor can saturate the
  // per-session `maxItems` cap and starve the aesthetic gap-fill entirely, would
  // otherwise honour the elevated focus *target* nowhere (the gap-fill never
  // runs). Runs AFTER the gap-fill so it is a TRUE NO-OP whenever the normal
  // path already brought the muscle to MEV (healthy budgets). Entirely gated on
  // `focusMuscles` — byte-identical for every user who hasn't picked one. Adds
  // at most one pick per under-MEV focus muscle per session (<=2 total),
  // accumulating toward the weekly floor across the block's strength days via
  // `weekAccessoryHistory` (the assembler records every pick's sets).
  for (const m of focusMuscles) {
    const floor = FOCUS_LANDMARKS[m]?.building ?? 0;
    if (floor <= 0) continue;
    if ((muscleProgress.get(m) ?? 0) >= floor) continue;
    const candidate = findCandidate({
      catalog: workingCatalog,
      requiredMuscle: m,
      filters,
      usedThisSession,
      preferSupported:
        profile.aesthetic.biasSupported && filters.concurrentStressActive,
      demoteCompound: true,
      aestheticEligibleOnly: true,
      variationSeed: seedFor(),
    });
    if (!candidate) continue;
    const pick = buildPick(
      candidate,
      profile,
      weekDeloadScale,
      "aesthetic",
      accessoryRationale({ reason: "focus", gapMuscle: m }),
    );
    picks.push(pick);
    usedThisSession.add(candidate.id);
    bumpBulletproof(durabilityProgress, candidate.bulletproofRoles);
    bumpFunctional(functionalProgress, candidate.functionalRoles);
    for (const mm of candidate.primaryMuscles) {
      muscleProgress.set(mm, (muscleProgress.get(mm) ?? 0) + pick.sets);
    }
  }

  return picks;
}

// ─── Helpers ──────────────────────────────────────────────────────

function countBulletproofRoles(week: WeekAccessoryHistoryItem[]): Map<BulletproofRole, number> {
  const m = new Map<BulletproofRole, number>();
  for (const item of week) {
    for (const r of item.bulletproofRoles) m.set(r, (m.get(r) ?? 0) + 1);
  }
  return m;
}

function countFunctionalRoles(week: WeekAccessoryHistoryItem[]): Map<FunctionalRole, number> {
  const m = new Map<FunctionalRole, number>();
  for (const item of week) {
    for (const r of item.functionalRoles) m.set(r, (m.get(r) ?? 0) + 1);
  }
  return m;
}

function countMusclesPrimary(
  week: WeekAccessoryHistoryItem[],
  fallbackSets: number,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of week) {
    // ADR 0022 — aesthetic progress is denominated in sets/week to match
    // the perMuscleTargets units. Credit each item's recorded set count
    // (falling back to the archetype base when a legacy item omits it).
    const sets = item.sets ?? fallbackSets;
    for (const muscle of item.primaryMuscles) m.set(muscle, (m.get(muscle) ?? 0) + sets);
  }
  return m;
}

function bumpBulletproof(map: Map<BulletproofRole, number>, roles: BulletproofRole[]): void {
  for (const r of roles) map.set(r, (map.get(r) ?? 0) + 1);
}

function bumpFunctional(map: Map<FunctionalRole, number>, roles: FunctionalRole[]): void {
  for (const r of roles) map.set(r, (map.get(r) ?? 0) + 1);
}

/**
 * Returns bulletproof roles ordered by which has the largest deficit. Plyo
 * is treated specially because plyometric_low + plyometric_high together
 * satisfy a single floor slot.
 */
function orderedBulletproofRoles(
  floor: Record<BulletproofRole, number>,
  progress: Map<BulletproofRole, number>,
): BulletproofRole[] {
  const rolesWithDeficit = (Object.keys(floor) as BulletproofRole[])
    .map((role) => ({
      role,
      deficit: Math.max(0, effectiveBulletproofTarget(role, floor) - effectiveBulletproofCount(role, progress)),
    }))
    .filter((x) => x.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit);
  return rolesWithDeficit.map((x) => x.role);
}

/** Joint plyometric counter — total of low + high. */
function effectiveBulletproofCount(role: BulletproofRole, progress: Map<BulletproofRole, number>): number {
  if (role === "plyometric_low" || role === "plyometric_high") {
    return (progress.get("plyometric_low") ?? 0) + (progress.get("plyometric_high") ?? 0);
  }
  return progress.get(role) ?? 0;
}

/** Joint plyometric target — both low and high contribute to the same floor slot. */
function effectiveBulletproofTarget(role: BulletproofRole, floor: Record<BulletproofRole, number>): number {
  if (role === "plyometric_low" || role === "plyometric_high") {
    // If the caller (effectiveDurabilityFloor) zeroed the plyo lines — e.g.
    // tendinopathy suppression — respect that and don't fall back to the
    // module-level minimum.
    if (floor.plyometric_low === 0 && floor.plyometric_high === 0) return 0;
    return Math.max(floor.plyometric_low, FLOOR_PLYOMETRIC_TOTAL);
  }
  return floor[role];
}

function pickLargestAestheticGap(
  targets: Record<string, number>,
  progress: Map<string, number>,
): string | null {
  let best: { muscle: string; gap: number } | null = null;
  for (const [muscle, target] of Object.entries(targets)) {
    const current = progress.get(muscle) ?? 0;
    const gap = target - current;
    if (gap <= 0) continue;
    if (!best || gap > best.gap) best = { muscle, gap };
  }
  return best?.muscle ?? null;
}

type CandidateQuery = {
  catalog: CatalogMovement[];
  requiredBulletproofRole?: BulletproofRole;
  requiredFunctionalRole?: FunctionalRole;
  requiredMuscle?: string;
  /**
   * ADR 0034 — soft region preference. When set, a candidate whose
   * `primaryRegion` matches gets a ranking BOOST (never a hard filter), so a
   * region-targeted durability fill prefers e.g. a calf/Achilles HSR for a
   * runner or a hinge-pattern HSR on deadlift day — while gracefully falling
   * back to any in-role candidate when no matching-region movement is feasible.
   */
  preferRegion?: string;
  filters: PickFilters;
  usedThisSession: Set<string>;
  preferSupported?: boolean;
  /**
   * ADR 0027 Lever A — aesthetic-slot anti-redundancy. When set, compound
   * movements are penalised in the candidate ranking so the hypertrophy
   * gap-fill slot prefers targeted isolation over a redundant compound that
   * merely echoes the main lift. Set ONLY on the aesthetic `findCandidate`
   * call; the durability / functional / power passes leave it unset (compounds
   * are correct there).
   */
  demoteCompound?: boolean;
  /**
   * AESTHETIC pass only. When true, candidates whose movement `pattern`
   * isn't a hypertrophy-eligible pattern (see `AESTHETIC_ELIGIBLE_PATTERNS`)
   * are excluded, so cardio / plyometric / Olympic / tendon / carry / drill
   * movements can never be prescribed as a rep-based muscle-gap filler.
   * Movements with no `pattern` (legacy fixture catalogs) are never excluded
   * — keeps existing fixture-driven goldens byte-identical.
   */
  aestheticEligibleOnly?: boolean;
  /**
   * Quick-generate variation (quick-workout path only). When set, the
   * candidate ranking still computes the quality score, but instead of always
   * returning the single best movement, it rotates among the top few
   * near-best candidates by this seed — so two consecutive quick generations
   * differ without dropping below comparable quality. `undefined` (every
   * planned-block caller) returns the deterministic best pick — byte-identical.
   */
  variationSeed?: number;
};

function findCandidate(query: CandidateQuery): CatalogMovement | null {
  const candidates: CatalogMovement[] = [];
  for (const m of query.catalog) {
    if (query.usedThisSession.has(m.id)) continue;
    if (query.filters.blockedMovementIds?.has(m.id)) continue;
    if (loadsBlockedRegion(m, query.filters.blockedRegions)) continue;
    if (
      loadsBlockedMuscle(
        m,
        query.filters.blockedMuscles,
        query.filters.allowedMovementIds,
      )
    )
      continue;
    if (query.requiredBulletproofRole && !m.bulletproofRoles.includes(query.requiredBulletproofRole)) continue;
    if (query.requiredFunctionalRole && !m.functionalRoles.includes(query.requiredFunctionalRole)) continue;
    if (query.requiredMuscle && !m.primaryMuscles.includes(query.requiredMuscle)) continue;
    if (
      query.aestheticEligibleOnly &&
      m.pattern != null &&
      !AESTHETIC_ELIGIBLE_PATTERNS.has(m.pattern)
    )
      continue;
    candidates.push(m);
  }
  if (candidates.length === 0) return null;

  // Rank: lower score = better. Stable sort preserves catalog order on ties,
  // so the unseeded pick is byte-identical to the pre-variation behaviour.
  candidates.sort((a, b) => candidateScore(a, query) - candidateScore(b, query));

  // Deterministic path (every planned-block caller): the single best pick.
  if (query.variationSeed == null) return candidates[0] ?? null;

  // Quick-generate variation: rotate among the top-K near-best candidates so
  // consecutive generations differ while staying within comparable quality.
  // The seed is bit-mixed (not used additively) so a per-slot cursor doesn't
  // collapse the variation to a single uniform shift — neighbouring base seeds
  // map to genuinely different rotations rather than the same offset.
  const k = Math.min(VARIATION_TOP_K, candidates.length);
  const pickIdx = mixSeed(query.variationSeed) % k;
  return candidates[pickIdx] ?? candidates[0] ?? null;
}

/** How many near-best candidates the quick variation rotates among. */
const VARIATION_TOP_K = 3;

/**
 * Movement patterns eligible for the AESTHETIC (hypertrophy muscle-gap)
 * pass. These are straight-set, rep-based resistance movements you'd
 * legitimately prescribe at ~8–15 reps to fill a per-muscle volume gap.
 *
 * Everything else is excluded from the aesthetic slot — NOT from the
 * picker entirely — because those patterns reach the prescription through
 * their own dedicated, correctly-shaped paths:
 *   - `cardio`               → conditioning, already stripped from the pool.
 *   - `plyometric`/`olympic` → the power pass (`findPowerCandidate`),
 *                              prescribed as low-rep explosive work.
 *   - `tendon`               → the durability floor (heavy isometric / HSR),
 *                              prescribed as holds / slow tempo.
 *   - `carry`                → durability / functional (loaded carries are
 *                              time/distance, not 12-rep hypertrophy).
 *   - `drill`                → running-form work, never a strength accessory.
 *
 * Without this guard the muscle-gap pass — which filters by `primaryMuscles`
 * alone — could pick e.g. `pogo-hop` (plyo, calves) or `iso-calf-hold`
 * (tendon) as a "4×12 @ RIR 3" calf filler, the same class of bug as the
 * "Erg Row — Threshold" cardio leak. See accessory-picker-cardio-machine
 * + catalog-integrity tests.
 */
const AESTHETIC_ELIGIBLE_PATTERNS: ReadonlySet<string> = new Set([
  "squat",
  "hinge",
  "press",
  "pull",
  "isolation",
  "cuff",
]);

/**
 * Bit-mix a seed into a well-distributed non-negative int (variant of the
 * splitmix32 finalizer). Ensures additively-adjacent seeds (e.g. base + a
 * per-slot cursor) produce uncorrelated rotations instead of a uniform shift.
 */
function mixSeed(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return x < 0 ? x + 0x100000000 : x;
}

/**
 * Find a movement tagged with any of the power functional roles. Honours
 * blocked regions + the tendinopathy flag (a plyometric/oly variant on a
 * symptomatic tendon would be unsafe). Returns null if no candidate
 * matches — caller silently skips the power pass rather than degrading
 * to an aesthetic pick.
 */
function findPowerCandidate(query: {
  catalog: CatalogMovement[];
  filters: PickFilters;
  usedThisSession: Set<string>;
}): CatalogMovement | null {
  const candidates: CatalogMovement[] = [];
  for (const m of query.catalog) {
    if (query.usedThisSession.has(m.id)) continue;
    if (query.filters.blockedMovementIds?.has(m.id)) continue;
    if (loadsBlockedRegion(m, query.filters.blockedRegions)) continue;
    if (
      loadsBlockedMuscle(
        m,
        query.filters.blockedMuscles,
        query.filters.allowedMovementIds,
      )
    )
      continue;
    const hasPowerRole = m.functionalRoles.some((r) =>
      (POWER_FUNCTIONAL_ROLES as readonly FunctionalRole[]).includes(r),
    );
    if (!hasPowerRole) continue;
    if (query.filters.tendinopathyActive && m.highStrainTendon) continue;
    candidates.push(m);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    let sa = 0;
    let sb = 0;
    // ADR 0012 — value-weighted block rotation (mirrors candidateScore).
    // Inert when there is no prior block (empty recency set).
    if (query.filters.recentlyUsedMovementIds.size > 0) {
      const va = movementValueNorm(a);
      const vb = movementValueNorm(b);
      if (query.filters.recentlyUsedMovementIds.has(a.id)) sa += ROTATION_BASE * (1 - va);
      if (query.filters.recentlyUsedMovementIds.has(b.id)) sb += ROTATION_BASE * (1 - vb);
      sa -= ACCESSORY_VALUE_BONUS * va;
      sb -= ACCESSORY_VALUE_BONUS * vb;
    }
    if (a.stimToFatigueScore != null) sa -= a.stimToFatigueScore;
    if (b.stimToFatigueScore != null) sb -= b.stimToFatigueScore;
    return sa - sb;
  });
  return candidates[0] ?? null;
}

// ─── ADR 0012 — accessory value-weighted block rotation ─────────────
// Value model = compound + loadable. Both signals are already populated
// in the catalog and both carry MODERATE evidence (Gentil 2015 PMID
// 26446291 — multi-joint ≈ isolation hypertrophy + more loadable;
// Schoenfeld 2010 PMID 20847704 — mechanical tension). SFR is
// deliberately excluded: it's a LOW-confidence practitioner heuristic
// that over-values isolations (the movements that SHOULD rotate freely).
const ACCESSORY_VALUE_WEIGHTS = { compound: 2, loadable: 1 } as const; // heuristic CP-1
const ACCESSORY_VALUE_MAX =
  ACCESSORY_VALUE_WEIGHTS.compound + ACCESSORY_VALUE_WEIGHTS.loadable; // 3
// Penalty for a movement used in the previous block for this day-role,
// scaled by (1 − value). Largest single term so low-value movements
// reliably rotate, but small enough that value meaningfully modulates it
// (the old flat +100 swamped every other term). Per Kassiano 2022 (PMID
// 35438660) / Baz-Valle 2019 — systematic per-mesocycle variation.
export const ROTATION_BASE = 40; // heuristic CP-1
// Selection bias toward higher-value movements for a shared muscle gap.
// Kept < ROTATION_BASE so it never overrides region/limitation filters
// or the structural phase order.
export const ACCESSORY_VALUE_BONUS = 8; // heuristic CP-1

// ADR 0027 Lever A — aesthetic-slot compound demotion. Penalty added to a
// compound's candidate score ONLY in the aesthetic (hypertrophy gap-fill)
// slot, so a targeted isolation reliably outranks a redundant compound that
// merely echoes the main lift. Set to 2× ACCESSORY_VALUE_BONUS so it cleanly
// REVERSES the ADR-0012 staple bias inside this slot (a fresh isolation beats a
// fresh compound for a shared muscle gap), while staying BELOW ROTATION_BASE
// (40) so block-to-block rotation among isolations still dominates. Resulting
// order for a gap muscle: fresh isolation < fresh compound < recently-used
// isolation — a compound is chosen only when it is the sole surviving
// candidate. heuristic CP-1 (Stage-A); revisit against logged selection data.
export const AESTHETIC_COMPOUND_PENALTY = 2 * ACCESSORY_VALUE_BONUS; // = 16

// ADR 0034 — soft region-preference weight for region-targeted durability
// fills (Achilles HSR for runners; day-pattern HSR). Set ABOVE ROTATION_BASE
// (40) so a matching tendon region reliably wins over block-rotation novelty,
// but it is only a SCORE term — hard role / limitation / equipment filters
// still gate selection, so it can never force an empty fill. Structural soft
// preference, not a dose — no calibration debt (CP-1 N/A).
export const REGION_PREFERENCE_BONUS = 50;

// ADR 0034 — day-pattern -> preferred HSR tendon region. Used by Phase 2 so a
// hinge day gets posterior-chain HSR (slow RDL) and a squat day gets knee/quad
// HSR (slow front squat), instead of doubling patellar load. Presses map to the
// shoulder region; no shoulder HSR exists yet (Phase 3), so the soft preference
// simply no-ops and falls back to any HSR. Keyed by `StrengthRole` strings
// (kept loose to avoid importing the archetype module).
const HSR_REGION_BY_ROLE: Record<string, string> = {
  squat: "knee",
  deadlift: "hamstring_posterior",
  horizontal_press: "shoulder_scapular",
  vertical_press: "shoulder_scapular",
};

/** ADR 0034 — the Achilles/calf tendon region a running-impact block prioritises. */
const RUNNING_HSR_REGION = "foot_ankle_calf";

/**
 * Movement staple-value, normalised to [0,1]. Compound + loadable = 1.0
 * (a sticky staple — e.g. weighted chin-up / dip / row); a redundant
 * isolation = 0 (free to rotate each block). ADR 0012.
 */
export function movementValueNorm(m: CatalogMovement): number {
  const raw =
    (m.isCompound ? ACCESSORY_VALUE_WEIGHTS.compound : 0) +
    (m.isLoadable ? ACCESSORY_VALUE_WEIGHTS.loadable : 0);
  return raw / ACCESSORY_VALUE_MAX;
}

/**
 * Candidate score (lower is better). Encodes the priority order:
 *   1. Variation rotation (don't repeat the previous BLOCK's pick — ADR 0012)
 *   2. Concurrent-stress filter (prefer supported when active)
 *   3. Concurrent-stress filter (demote high eccentric_load_score)
 *   4. Stim-to-fatigue ratio (higher = better; legacy, currently unpopulated)
 */
function candidateScore(m: CatalogMovement, query: CandidateQuery): number {
  let score = 0;
  // ADR 0012 — value-weighted block rotation. The penalty for a movement
  // used in the PREVIOUS block (same day-role) is scaled DOWN by the
  // movement's staple value, so high-value compounds (chin-ups, dips,
  // rows) persist across blocks while redundant isolations churn; a small
  // value bonus also biases selection toward the higher-value movement for
  // a shared muscle gap. The whole block is inert when there is no prior
  // block (empty recency set) — first-ever blocks stay byte-identical.
  if (query.filters.recentlyUsedMovementIds.size > 0) {
    const value = movementValueNorm(m);
    if (query.filters.recentlyUsedMovementIds.has(m.id)) {
      score += ROTATION_BASE * (1 - value);
    }
    score -= ACCESSORY_VALUE_BONUS * value;
  }
  if (query.preferSupported && !m.isSupported) score += 30;
  // ADR 0034 — soft region preference for region-targeted durability fills.
  // A matching primaryRegion outranks block-rotation novelty (bonus > ROTATION_BASE)
  // because honouring the modality/pattern-specific tendon need matters more than
  // rotating to a different region; still below any hard filter, so limitations /
  // equipment / role gates always win.
  if (query.preferRegion && m.primaryRegion === query.preferRegion) {
    score -= REGION_PREFERENCE_BONUS;
  }
  if (query.filters.concurrentStressActive && (m.eccentricLoadScore ?? 3) >= 4) score += 20;
  // ADR 0027 Lever A — demote redundant compounds in the aesthetic slot only.
  if (query.demoteCompound && m.isCompound) score += AESTHETIC_COMPOUND_PENALTY;
  if (m.stimToFatigueScore != null) score -= m.stimToFatigueScore; // higher SFR is better
  return score;
}

export function loadsBlockedRegion(m: CatalogMovement, blocked: Set<string>): boolean {
  if (blocked.has(m.primaryRegion)) return true;
  for (const r of m.secondaryRegions) if (blocked.has(r)) return true;
  return false;
}

/**
 * Muscle-level drop introduced in PR `feat/limitations-v2-lifecycle`.
 *
 * A movement loading any blocked muscle as a primary OR secondary is
 * dropped — EXCEPT when the user has explicitly allow-listed the
 * movement ("I can still do this one without pain"). Region drops
 * are unaffected and apply ahead of this gate.
 */
export function loadsBlockedMuscle(
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

function repsForBucket(
  bucket: AccessoryBucket,
  repRange: { min: number; max: number },
): number {
  // ADR 0022 — bias reps within the archetype's existing range by movement
  // type. heuristic, consistent with Schoenfeld 2017 (hypertrophy is largely
  // rep-range-insensitive at matched effort, so compound→low / isolation→high
  // is a free joint-stress / practicality win). isometric / carry / plyometric
  // / tendon buckets ignore the rep number downstream (holds / distance /
  // explosive-intent overrides), so the midpoint there is harmless.
  switch (bucket) {
    case "isolation":
      return repRange.max;
    case "compound":
      return repRange.min;
    default:
      return Math.round((repRange.min + repRange.max) / 2);
  }
}

function buildPick(
  movement: CatalogMovement,
  profile: AccessoryProfile,
  weekDeloadScale: number,
  reason: AccessoryPick["reason"],
  rationale: string,
  overrides?: { repsOverride?: number; setsOverride?: number },
): AccessoryPick {
  const baseSets = overrides?.setsOverride ?? profile.aesthetic.setsPerItem;
  const sets = Math.max(1, Math.round(baseSets * weekDeloadScale));
  const bucket = inferAccessoryBucket({
    reason,
    slug: movement.slug,
    primaryRegion: movement.primaryRegion,
    primaryMuscles: movement.primaryMuscles,
    isCompound: movement.isCompound,
    bulletproofRoles: movement.bulletproofRoles,
    functionalRoles: movement.functionalRoles,
  });
  const reps =
    overrides?.repsOverride ?? repsForBucket(bucket, profile.aesthetic.repRange);
  return {
    movementId: movement.id,
    slug: movement.slug,
    displayName: movement.displayName,
    sets,
    reps,
    reason,
    rationale,
  };
}

export { DC_O4_FLOOR };
