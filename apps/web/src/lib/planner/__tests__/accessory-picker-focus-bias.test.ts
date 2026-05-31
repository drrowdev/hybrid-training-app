/**
 * End-to-end test that focus-muscle bias actually changes accessory
 * picker output. Pure-function test against the same fixture catalog
 * used in `accessory-picker.test.ts`.
 *
 * Substitution-with-cap means: the picker emits MORE sets on the focus
 * muscle than the no-focus baseline does. Total session items are
 * still capped by `maxItems`, so the picker compensates by dropping
 * a non-focus aesthetic item — which is exactly the model.
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
    primaryRegion: over.primaryRegion ?? "lumbar_trunk",
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

// Aesthetic-heavy catalog with multiple candidates per focus-eligible
// muscle so the picker has room to bias.
const CATALOG: CatalogMovement[] = [
  mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "bi2", slug: "incline-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "bi3", slug: "preacher-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "tri1", slug: "rope-pushdown", primaryMuscles: ["triceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "lr1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "lr2", slug: "cable-lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "rd1", slug: "rear-fly", primaryMuscles: ["rear_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "calf1", slug: "standing-calf-raise", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf" }),
  mv({ id: "calf2", slug: "seated-calf-raise", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf" }),
  mv({ id: "ham1", slug: "leg-curl", primaryMuscles: ["hamstrings"], primaryRegion: "hamstring_posterior" }),
  mv({ id: "uc1", slug: "incline-bench", primaryMuscles: ["upper_chest"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "abs1", slug: "cable-crunch", primaryMuscles: ["abs"], primaryRegion: "lumbar_trunk" }),
  mv({ id: "lat1", slug: "lat-pulldown", primaryMuscles: ["lats"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "mb1", slug: "chest-supported-row", primaryMuscles: ["mid_back"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "fa1", slug: "wrist-curl", primaryMuscles: ["forearms"], primaryRegion: "elbow_forearm" }),
];

const AESTHETIC_PROFILE: AccessoryProfile = {
  aesthetic: {
    itemsPerSession: 8,
    setsPerItem: 3,
    repRange: { min: 10, max: 15 },
    biasSupported: false,
  },
  // Empty so durability/functional don't crowd out the aesthetic slots.
  functional: { weeklyRoleRequirements: {} },
  durability: { extras: [] },
};

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

function bicepsSets(picks: ReturnType<typeof pickAccessoriesForSession>): number {
  let total = 0;
  for (const p of picks) {
    if (p.slug.includes("curl") && !p.slug.includes("wrist") && !p.slug.includes("leg")) {
      total += p.sets;
    }
  }
  return total;
}

describe("pickAccessoriesForSession — focus-muscle bias end-to-end", () => {
  it("baseline (no focus) allocates sets across the aesthetic universe", () => {
    const targets = defaultMuscleTargets();
    const picks = pickAccessoriesForSession({
      profile: AESTHETIC_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: targets.targetsByMuscle,
      maxItems: 8,
    });
    expect(picks.length).toBeGreaterThan(0);
  });

  it("biceps focus yields MORE biceps sets than the no-focus baseline", () => {
    const baselineTargets = defaultMuscleTargets();
    const baselinePicks = pickAccessoriesForSession({
      profile: AESTHETIC_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: baselineTargets.targetsByMuscle,
      maxItems: 8,
    });

    const focusTargets = defaultMuscleTargets({ focusMuscles: ["biceps"] });
    const focusPicks = pickAccessoriesForSession({
      profile: AESTHETIC_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: focusTargets.targetsByMuscle,
      maxItems: 8,
    });

    // Either the picker chose more biceps items, or assigned more sets
    // per item — both count as "biased toward biceps".
    expect(bicepsSets(focusPicks)).toBeGreaterThan(bicepsSets(baselinePicks));
  });
});
