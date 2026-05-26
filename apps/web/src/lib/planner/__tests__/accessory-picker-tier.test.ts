/**
 * PR W1 — accessory picker integration with `experience` tier gate.
 *
 * Two scenarios:
 *   - beginner_lt_6m: power-tagged movements must NEVER appear in the
 *     prescription, regardless of selection path (durability, functional,
 *     muscle gap, power emphasis).
 *   - advanced_5y_10y: power-tagged movements are eligible — the
 *     filter is a no-op for higher tiers.
 *
 * See `experience-tier-scope.md` §4.
 */
import { describe, it, expect } from "vitest";
import {
  pickAccessoriesForSession,
  type CatalogMovement,
} from "../accessory-picker";
import type { AccessoryProfile, FunctionalRole } from "../accessory-roles";

function mv(over: Partial<CatalogMovement> & { id: string; slug: string }): CatalogMovement {
  return {
    id: over.id,
    slug: over.slug,
    displayName: over.displayName ?? over.slug,
    primaryMuscles: over.primaryMuscles ?? [],
    secondaryMuscles: over.secondaryMuscles ?? [],
    primaryRegion: over.primaryRegion ?? "lumbar_trunk",
    secondaryRegions: over.secondaryRegions ?? [],
    bulletproofRoles: over.bulletproofRoles ?? [],
    functionalRoles: over.functionalRoles ?? [],
    isSupported: over.isSupported ?? false,
    isCompound: over.isCompound ?? false,
    eccentricLoadScore: over.eccentricLoadScore ?? null,
    stimToFatigueScore: over.stimToFatigueScore ?? null,
    highStrainTendon: over.highStrainTendon ?? false,
    experienceMin: over.experienceMin,
    experienceMax: over.experienceMax,
  };
}

/**
 * Catalog mixes a satisfied DC-O4 floor (iso/hsr/plyo-low/carry — none
 * are tagged with `power_*` so they survive the beginner gate) with
 * power-tagged candidates that the gate must drop for beginners.
 */
const CATALOG: CatalogMovement[] = [
  // Bulletproof — NOT tagged with power_* roles (these are the
  // bulletproof equivalents, distinct from the functional power tags).
  mv({ id: "iso1", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "hsr1", slug: "tempo-rdl", bulletproofRoles: ["hsr"], primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"] }),
  mv({ id: "plyoLow", slug: "pogo-hops-low", bulletproofRoles: ["plyometric_low"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "carry1", slug: "farmer-carry", bulletproofRoles: ["carry"], primaryRegion: "lumbar_trunk", primaryMuscles: ["forearms"] }),
  mv({ id: "carry2", slug: "suitcase-carry", bulletproofRoles: ["carry"], primaryRegion: "lumbar_trunk", primaryMuscles: ["obliques"] }),
  // Power-tagged candidates — these are what the gate must filter.
  // PR W2: power rows carry curated `experienceMin: 2`, so the new
  // band-based filter drops them for beginner / novice the same way
  // the PR W1 power-tag filter did.
  mv({ id: "oly1", slug: "power-clean", functionalRoles: ["power_olympic"], experienceMin: 2, primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings", "glutes"], highStrainTendon: true, stimToFatigueScore: 4 }),
  mv({ id: "plyB", slug: "broad-jump", functionalRoles: ["power_plyometric"], experienceMin: 1, primaryRegion: "knee", primaryMuscles: ["quads"], highStrainTendon: true, stimToFatigueScore: 3 }),
  mv({ id: "bal1", slug: "kb-swing-russian", functionalRoles: ["power_ballistic"], experienceMin: 2, primaryRegion: "hamstring_posterior", primaryMuscles: ["glutes"], stimToFatigueScore: 4 }),
  // Non-power aesthetic options so the picker has somewhere to land
  // when power candidates are filtered out.
  mv({ id: "lr1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "tri1", slug: "rope-pushdown", primaryMuscles: ["triceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "calf1", slug: "standing-calf", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf" }),
  mv({ id: "ham1", slug: "leg-curl", primaryMuscles: ["hamstrings"], primaryRegion: "hamstring_posterior" }),
];

const STRENGTH_PROFILE: AccessoryProfile = {
  aesthetic: {
    itemsPerSession: 3,
    setsPerItem: 3,
    repRange: { min: 10, max: 15 },
    biasSupported: false,
  },
  functional: { weeklyRoleRequirements: {} },
  durability: { extras: [] },
};

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

// Pre-satisfied DC-O4 floor so the picker skips ahead to muscle / power
// passes where the power-tagged candidates would otherwise surface.
const FLOOR_SATISFIED = [
  { movementId: "iso1", bulletproofRoles: ["heavy_isometric" as const], functionalRoles: [] as FunctionalRole[], primaryMuscles: [] as string[] },
  { movementId: "hsr1", bulletproofRoles: ["hsr" as const], functionalRoles: [] as FunctionalRole[], primaryMuscles: [] as string[] },
  { movementId: "plyoLow", bulletproofRoles: ["plyometric_low" as const], functionalRoles: [] as FunctionalRole[], primaryMuscles: [] as string[] },
  { movementId: "carry1", bulletproofRoles: ["carry" as const], functionalRoles: [] as FunctionalRole[], primaryMuscles: [] as string[] },
  { movementId: "carry2", bulletproofRoles: ["carry" as const], functionalRoles: [] as FunctionalRole[], primaryMuscles: [] as string[] },
];

const POWER_SLUGS = ["power-clean", "broad-jump", "kb-swing-russian"];

describe("PR W1 — pickAccessoriesForSession honours experience tier", () => {
  it("beginner_lt_6m: NO power-tagged movement appears in the prescription", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: FLOOR_SATISFIED,
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, triceps: 6, biceps: 6, calves: 6, hamstrings: 6 },
      maxItems: 4,
      powerEmphasis: true,
      experience: "beginner_lt_6m",
    });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((p) => !POWER_SLUGS.includes(p.slug))).toBe(true);
    expect(picks.some((p) => p.reason === "power")).toBe(false);
  });

  it("advanced_5y_10y: power-tagged movements ARE eligible", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: FLOOR_SATISFIED,
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, triceps: 6, biceps: 6, calves: 6, hamstrings: 6 },
      maxItems: 4,
      powerEmphasis: true,
      experience: "advanced_5y_10y",
    });
    expect(picks.some((p) => POWER_SLUGS.includes(p.slug))).toBe(true);
    expect(picks.some((p) => p.reason === "power")).toBe(true);
  });
});
