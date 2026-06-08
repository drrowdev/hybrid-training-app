/**
 * Plyometric / power accessories must be prescribed as a LOW-rep reactive
 * stimulus (Behm & Sale 1993: 3–5 max-intent reps), NOT the archetype's 12–15
 * hypertrophy rep range. Regression guard for the "Jump Squat 2×14 @ max intent"
 * misdose (a plyometric floor item that inherited the aesthetic rep midpoint).
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

const CATALOG: CatalogMovement[] = [
  mv({ id: "plyo1", slug: "jump-squat", pattern: "plyometric", bulletproofRoles: ["plyometric_low"], primaryMuscles: ["quads"], primaryRegion: "knee" }),
  mv({ id: "iso1", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"], primaryMuscles: ["quads"], primaryRegion: "knee" }),
  mv({ id: "hsr1", slug: "tempo-squat", bulletproofRoles: ["hsr"], primaryMuscles: ["quads"], primaryRegion: "knee" }),
  mv({ id: "carry1", slug: "farmer-carry", bulletproofRoles: ["carry"], primaryMuscles: ["traps"], primaryRegion: "lumbar_trunk" }),
  mv({ id: "carry2", slug: "suitcase-carry", bulletproofRoles: ["carry"], primaryMuscles: ["traps"], primaryRegion: "lumbar_trunk" }),
];

// Wide hypertrophy rep range (12–15) so a regression would surface as ~13 reps.
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

describe("plyometric accessory reps (Behm & Sale 1993)", () => {
  it("prescribes a low rep count (5), NOT the 12–15 hypertrophy midpoint", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: defaultMuscleTargets().targetsByMuscle,
      maxItems: 6,
    });
    const jump = picks.find((p) => p.slug === "jump-squat");
    expect(jump, "plyometric floor item should be picked").toBeTruthy();
    expect(jump!.reps).toBe(5);
  });
});
