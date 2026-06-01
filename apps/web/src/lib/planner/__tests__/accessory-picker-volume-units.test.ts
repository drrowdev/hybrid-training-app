import { describe, it, expect } from "vitest";
import { pickAccessoriesForSession, type CatalogMovement } from "../accessory-picker";
import type { AccessoryProfile } from "../accessory-roles";

/**
 * ADR 0022 — accessory weekly-volume units fix + bucket-aware reps.
 *
 * Two guarantees:
 *  - B1: per-muscle aesthetic progress is denominated in SETS/week (not items),
 *    so a muscle "completes" once its set target is met and stops being filled.
 *  - A:  reps are biased within the archetype rep range by bucket
 *    (compound → low end, isolation → high end).
 */

function mv(over: Partial<CatalogMovement> & { id: string; slug: string }): CatalogMovement {
  return {
    id: over.id,
    slug: over.slug,
    displayName: over.displayName ?? over.slug,
    primaryMuscles: over.primaryMuscles ?? [],
    secondaryMuscles: over.secondaryMuscles ?? [],
    primaryRegion: over.primaryRegion ?? "shoulder_scapular",
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

// Aesthetic-only catalog with NO durability / functional roles, so the
// durability floor finds no candidate and the picker fills purely from the
// aesthetic gap phase — isolating the behaviour under test.
const AESTHETIC_CATALOG: CatalogMovement[] = [
  mv({ id: "sd1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"] }),
  mv({ id: "sd2", slug: "cable-lateral-raise", primaryMuscles: ["side_delts"] }),
  mv({ id: "sd3", slug: "machine-lateral-raise", primaryMuscles: ["side_delts"] }),
  mv({ id: "sd4", slug: "leaning-lateral-raise", primaryMuscles: ["side_delts"] }),
];

const PROFILE: AccessoryProfile = {
  aesthetic: { itemsPerSession: 4, setsPerItem: 3, repRange: { min: 10, max: 15 }, biasSupported: false },
  functional: { weeklyRoleRequirements: {} },
  durability: { extras: [] },
};

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

describe("ADR 0022 — weekly volume counted in sets, not items", () => {
  it("stops filling a muscle once its weekly SET target is met", () => {
    // Target 6 sets ÷ 3 sets/item = 2 exposures. Four candidates exist and
    // maxItems is generous, so the only thing that should cap the count is the
    // set budget. Under the old item-counting bug this would have picked all
    // four variants (6 items < target) before marking the muscle satisfied.
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: AESTHETIC_CATALOG,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6 },
      maxItems: 8,
    });
    const sideDelts = picks.filter((p) => p.reason === "aesthetic");
    expect(sideDelts.length).toBe(2);
    expect(sideDelts.reduce((s, p) => s + p.sets, 0)).toBe(6);
  });

  it("credits prior weekly history in sets so a part-filled muscle finishes, not restarts", () => {
    // One exposure already logged this week (3 sets). Remaining budget for a
    // 6-set target is 3 sets = exactly one more item.
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: AESTHETIC_CATALOG,
      weekAccessoryHistory: [
        { movementId: "sd1", bulletproofRoles: [], functionalRoles: [], primaryMuscles: ["side_delts"], sets: 3 },
      ],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6 },
      maxItems: 8,
    });
    expect(picks.filter((p) => p.reason === "aesthetic").length).toBe(1);
  });

  it("falls back to the archetype base when a history item omits sets", () => {
    // Legacy history item without a `sets` field is credited at setsPerItem (3),
    // so a 6-set target has 3 sets remaining = one more item.
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: AESTHETIC_CATALOG,
      weekAccessoryHistory: [
        { movementId: "sd1", bulletproofRoles: [], functionalRoles: [], primaryMuscles: ["side_delts"] },
      ],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6 },
      maxItems: 8,
    });
    expect(picks.filter((p) => p.reason === "aesthetic").length).toBe(1);
  });
});

describe("ADR 0022 — bucket-aware reps within the archetype range", () => {
  it("isolation movements take the high end of the rep range", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: [mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"], isCompound: false })],
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { biceps: 6 },
      maxItems: 8,
    });
    const curl = picks.find((p) => p.slug === "db-curl");
    expect(curl?.reps).toBe(15); // repRange.max
  });

  it("compound movements take the low end of the rep range", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: [
        mv({
          id: "row1",
          slug: "barbell-row",
          primaryMuscles: ["lats", "upper_back"],
          isCompound: true,
        }),
      ],
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { lats: 6 },
      maxItems: 8,
    });
    const row = picks.find((p) => p.slug === "barbell-row");
    expect(row?.reps).toBe(10); // repRange.min
  });
});
