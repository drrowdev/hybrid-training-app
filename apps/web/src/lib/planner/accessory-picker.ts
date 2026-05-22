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
 *
 * Returns a list of accessory items to append to this day's prescription,
 * in priority order (durability deficit > functional deficit > aesthetic
 * gap-fill).
 *
 * Per docs/design/accessory-schema.md §21. The picker NEVER reads a
 * specific slug from the archetype config — all decisions flow from
 * role tags on the catalog.
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
  eccentricLoadScore: number | null; // 1..5; null = unknown
  stimToFatigueScore: number | null; // 1..5; null = unknown
  highStrainTendon: boolean;
};

export type WeekContextItem = {
  /** Movement that was already prescribed earlier in this generated week. */
  movementId: string;
  bulletproofRoles: BulletproofRole[];
  functionalRoles: FunctionalRole[];
  primaryMuscles: string[];
};

export type PickFilters = {
  /** Regions with active limitations — movements loading these are filtered out. */
  blockedRegions: Set<string>;
  /** True when the user is currently under concurrent stress (≥4h endurance OR ≥3 cardio/wk). */
  concurrentStressActive: boolean;
  /** Movements used in the immediately previous session of the same day-role; demoted. */
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
  weekContext,
  filters,
  perMuscleTargets,
  maxItems,
  powerEmphasis = false,
}: {
  profile: AccessoryProfile;
  /** Deload scalar from the week profile (e.g. 0.5 on deload weeks). */
  weekDeloadScale: number;
  catalog: CatalogMovement[];
  weekContext: WeekContextItem[];
  filters: PickFilters;
  /** Per-muscle weekly aesthetic target (already concurrent-modifier-applied by caller). */
  perMuscleTargets: Record<string, number>;
  /** Hard cap on items for this session — typically archetype.aesthetic.itemsPerSession + a small budget for functional/durability fills. */
  maxItems: number;
  /** Wizard toggle. Biases the picker toward power-tagged movements + trims hypertrophy filler. */
  powerEmphasis?: boolean;
}): AccessoryPick[] {
  const picks: AccessoryPick[] = [];
  const usedThisSession = new Set<string>();

  const durFloor = effectiveDurabilityFloor(profile, filters.tendinopathyActive);
  const durabilityProgress = countBulletproofRoles(weekContext);
  const functionalProgress = countFunctionalRoles(weekContext);
  const muscleProgress = countMusclesPrimary(weekContext);

  // ─── 1. Durability deficits first ───
  for (const role of orderedBulletproofRoles(durFloor, durabilityProgress)) {
    if (picks.length >= maxItems) break;
    const current = effectiveBulletproofCount(role, durabilityProgress);
    const target = effectiveBulletproofTarget(role, durFloor);
    if (current >= target) continue;
    const candidate = findCandidate({
      catalog,
      requiredBulletproofRole: role,
      filters,
      usedThisSession,
    });
    if (!candidate) continue;
    picks.push(buildPick(candidate, profile, weekDeloadScale, "durability", `Weekly tissue floor: ${roleLabel(role)}`));
    usedThisSession.add(candidate.id);
    bumpBulletproof(durabilityProgress, candidate.bulletproofRoles);
    bumpFunctional(functionalProgress, candidate.functionalRoles);
    for (const m of candidate.primaryMuscles) {
      muscleProgress.set(m, (muscleProgress.get(m) ?? 0) + 1);
    }
  }

  // ─── 2. Functional deficits ───
  for (const [role, required] of Object.entries(profile.functional.weeklyRoleRequirements) as [FunctionalRole, number][]) {
    if (picks.length >= maxItems) break;
    if (!required) continue;
    const current = functionalProgress.get(role) ?? 0;
    if (current >= required) continue;
    const candidate = findCandidate({
      catalog,
      requiredFunctionalRole: role,
      filters,
      usedThisSession,
    });
    if (!candidate) continue;
    picks.push(buildPick(candidate, profile, weekDeloadScale, "functional", `Functional minimum: ${roleLabel(role)}`));
    usedThisSession.add(candidate.id);
    bumpBulletproof(durabilityProgress, candidate.bulletproofRoles);
    bumpFunctional(functionalProgress, candidate.functionalRoles);
    for (const m of candidate.primaryMuscles) {
      muscleProgress.set(m, (muscleProgress.get(m) ?? 0) + 1);
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
      catalog,
      filters,
      usedThisSession,
    });
    if (candidate) {
      picks.push(
        buildPick(
          candidate,
          profile,
          weekDeloadScale,
          "power",
          "Power emphasis: explosive intent (3–5 reps, full recovery)",
          { repsOverride: 5, setsOverride: profile.aesthetic.setsPerItem },
        ),
      );
      usedThisSession.add(candidate.id);
      bumpBulletproof(durabilityProgress, candidate.bulletproofRoles);
      bumpFunctional(functionalProgress, candidate.functionalRoles);
      for (const m of candidate.primaryMuscles) {
        muscleProgress.set(m, (muscleProgress.get(m) ?? 0) + 1);
      }
      powerPickAdded = true;
    }
  }

  // ─── 3. Aesthetic gap-fill ───
  // When power emphasis is on, trim the aesthetic budget by ~1 item (and at
  // least leave room for the power pick we just inserted). High-rep
  // hypertrophy fillers blunt the RFD signal — Schoenfeld 2017.
  const aestheticCap = powerEmphasis
    ? Math.max(picks.length, maxItems - (powerPickAdded ? 0 : 1) - 1)
    : maxItems;
  while (picks.length < aestheticCap) {
    const gapMuscle = pickLargestAestheticGap(perMuscleTargets, muscleProgress);
    if (!gapMuscle) break;
    const candidate = findCandidate({
      catalog,
      requiredMuscle: gapMuscle,
      filters,
      usedThisSession,
      preferSupported: profile.aesthetic.biasSupported && filters.concurrentStressActive,
    });
    if (!candidate) {
      // No catalog match for this muscle — mark it satisfied so we don't loop forever.
      muscleProgress.set(gapMuscle, (perMuscleTargets[gapMuscle] ?? PER_MUSCLE_TARGETS_FALLBACK));
      continue;
    }
    picks.push(
      buildPick(
        candidate,
        profile,
        weekDeloadScale,
        "aesthetic",
        `Per-muscle volume: ${gapMuscle.replace(/_/g, " ")}`,
      ),
    );
    usedThisSession.add(candidate.id);
    bumpBulletproof(durabilityProgress, candidate.bulletproofRoles);
    bumpFunctional(functionalProgress, candidate.functionalRoles);
    for (const m of candidate.primaryMuscles) {
      muscleProgress.set(m, (muscleProgress.get(m) ?? 0) + 1);
    }
  }

  return picks;
}

// ─── Helpers ──────────────────────────────────────────────────────

function countBulletproofRoles(week: WeekContextItem[]): Map<BulletproofRole, number> {
  const m = new Map<BulletproofRole, number>();
  for (const item of week) {
    for (const r of item.bulletproofRoles) m.set(r, (m.get(r) ?? 0) + 1);
  }
  return m;
}

function countFunctionalRoles(week: WeekContextItem[]): Map<FunctionalRole, number> {
  const m = new Map<FunctionalRole, number>();
  for (const item of week) {
    for (const r of item.functionalRoles) m.set(r, (m.get(r) ?? 0) + 1);
  }
  return m;
}

function countMusclesPrimary(week: WeekContextItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of week) {
    for (const muscle of item.primaryMuscles) m.set(muscle, (m.get(muscle) ?? 0) + 1);
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
  filters: PickFilters;
  usedThisSession: Set<string>;
  preferSupported?: boolean;
};

function findCandidate(query: CandidateQuery): CatalogMovement | null {
  const candidates: CatalogMovement[] = [];
  for (const m of query.catalog) {
    if (query.usedThisSession.has(m.id)) continue;
    if (loadsBlockedRegion(m, query.filters.blockedRegions)) continue;
    if (query.requiredBulletproofRole && !m.bulletproofRoles.includes(query.requiredBulletproofRole)) continue;
    if (query.requiredFunctionalRole && !m.functionalRoles.includes(query.requiredFunctionalRole)) continue;
    if (query.requiredMuscle && !m.primaryMuscles.includes(query.requiredMuscle)) continue;
    candidates.push(m);
  }
  if (candidates.length === 0) return null;

  // Rank: lower score = better.
  candidates.sort((a, b) => {
    const sa = candidateScore(a, query);
    const sb = candidateScore(b, query);
    return sa - sb;
  });
  return candidates[0] ?? null;
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
    if (loadsBlockedRegion(m, query.filters.blockedRegions)) continue;
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
    if (query.filters.recentlyUsedMovementIds.has(a.id)) sa += 100;
    if (query.filters.recentlyUsedMovementIds.has(b.id)) sb += 100;
    if (a.stimToFatigueScore != null) sa -= a.stimToFatigueScore;
    if (b.stimToFatigueScore != null) sb -= b.stimToFatigueScore;
    return sa - sb;
  });
  return candidates[0] ?? null;
}

/**
 * Candidate score (lower is better). Encodes the priority order:
 *   1. Variation rotation (don't repeat the previous session's pick)
 *   2. Concurrent-stress filter (prefer supported when active)
 *   3. Concurrent-stress filter (demote high eccentric_load_score)
 *   4. Stim-to-fatigue ratio (higher = better)
 */
function candidateScore(m: CatalogMovement, query: CandidateQuery): number {
  let score = 0;
  if (query.filters.recentlyUsedMovementIds.has(m.id)) score += 100; // big penalty
  if (query.preferSupported && !m.isSupported) score += 30;
  if (query.filters.concurrentStressActive && (m.eccentricLoadScore ?? 3) >= 4) score += 20;
  if (m.stimToFatigueScore != null) score -= m.stimToFatigueScore; // higher SFR is better
  return score;
}

function loadsBlockedRegion(m: CatalogMovement, blocked: Set<string>): boolean {
  if (blocked.has(m.primaryRegion)) return true;
  for (const r of m.secondaryRegions) if (blocked.has(r)) return true;
  return false;
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
  const reps =
    overrides?.repsOverride ??
    Math.round((profile.aesthetic.repRange.min + profile.aesthetic.repRange.max) / 2);
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

function roleLabel(role: BulletproofRole | FunctionalRole): string {
  return role.replace(/_/g, " ");
}

export { DC_O4_FLOOR };
