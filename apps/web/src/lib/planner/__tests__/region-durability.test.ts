/**
 * Region-aware durability de-dup (review fix).
 *
 * The durability floor used to seat one-per-role with no cross-role region
 * coordination, so a squat day could stack a knee isometric (wall sit) on top
 * of a knee HSR (slow front squat) — doubling patellar load. Now the HSR claims
 * its region first and the flexible isometric / plyo / carry steer to a
 * different region.
 */
import { describe, expect, it } from "vitest";
import { pickAccessoriesForSession, type CatalogMovement } from "../accessory-picker";
import { defaultMuscleTargets } from "../focus-muscle-targets";
import type { AccessoryProfile } from "../accessory-roles";

function mv(over: Partial<CatalogMovement> & { id: string; slug: string }): CatalogMovement {
  return {
    id: over.id,
    slug: over.slug,
    displayName: over.displayName ?? over.slug,
    primaryMuscles: over.primaryMuscles ?? [],
    secondaryMuscles: over.secondaryMuscles ?? [],
    primaryRegion: over.primaryRegion ?? "knee",
    secondaryRegions: over.secondaryRegions ?? [],
    bulletproofRoles: over.bulletproofRoles ?? [],
    functionalRoles: over.functionalRoles ?? [],
    isSupported: over.isSupported ?? false,
    isCompound: over.isCompound ?? false,
    eccentricLoadScore: over.eccentricLoadScore ?? null,
    stimToFatigueScore: over.stimToFatigueScore ?? null,
    highStrainTendon: over.highStrainTendon ?? false,
  };
}

// Squat-day catalogue: a knee HSR (pattern-matched), a knee isometric (the
// redundant wall sit) AND a non-knee isometric (a trunk plank) it can steer to.
const CATALOG: CatalogMovement[] = [
  mv({ id: "hsr-knee", slug: "slow-front-squat", bulletproofRoles: ["hsr"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "iso-knee", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "iso-trunk", slug: "plank", bulletproofRoles: ["heavy_isometric"], primaryRegion: "lumbar_trunk", primaryMuscles: ["abs"] }),
  mv({ id: "carry1", slug: "farmer-carry", bulletproofRoles: ["carry"], primaryRegion: "lumbar_trunk", primaryMuscles: ["traps"] }),
  mv({ id: "carry2", slug: "suitcase-carry", bulletproofRoles: ["carry"], primaryRegion: "lumbar_trunk", primaryMuscles: ["traps"] }),
  mv({ id: "plyo-calf", slug: "pogo-hop", bulletproofRoles: ["plyometric_low"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
];

const PROFILE: AccessoryProfile = {
  aesthetic: { itemsPerSession: 0, setsPerItem: 2, repRange: { min: 12, max: 15 }, biasSupported: false },
  functional: { weeklyRoleRequirements: {} },
  durability: { extras: [] },
};

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

describe("region-aware durability de-dup", () => {
  it("a squat day does not stack a knee isometric on top of the knee HSR", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: defaultMuscleTargets().targetsByMuscle,
      maxItems: 6,
      dayPrimaryRole: "squat", // HSR pattern-matches to the knee
    });
    // The HSR took the knee...
    expect(picks.some((p) => p.slug === "slow-front-squat")).toBe(true);
    // ...so the isometric steers to the trunk plank, NOT the redundant wall sit.
    expect(picks.some((p) => p.slug === "plank")).toBe(true);
    expect(picks.some((p) => p.slug === "wall-sit")).toBe(false);
  });

  it("still seats the isometric (soft preference) when no fresh region exists", () => {
    // Only knee isometrics available → falls back rather than dropping the floor.
    const kneeOnly = CATALOG.filter((m) => m.slug !== "plank");
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: kneeOnly,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: defaultMuscleTargets().targetsByMuscle,
      maxItems: 6,
      dayPrimaryRole: "squat",
    });
    // The heavy_isometric floor is still met (wall sit) — de-dup is soft.
    expect(picks.some((p) => p.slug === "wall-sit")).toBe(true);
  });
});
