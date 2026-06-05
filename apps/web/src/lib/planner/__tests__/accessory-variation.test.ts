/**
 * Quick-generate variation: the accessory picker rotates among near-best
 * candidates when a `variationSeed` is supplied, and is byte-identical
 * (deterministic best pick) when it is not.
 */
import { describe, it, expect } from "vitest";
import { pickAccessoriesForSession, type CatalogMovement } from "../accessory-picker";
import { STRENGTH_ANCHOR } from "../archetypes";

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

// Several interchangeable side-delt isolations so the top-K rotation has room.
const CATALOG: CatalogMovement[] = [
  mv({ id: "lr1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"] }),
  mv({ id: "lr2", slug: "cable-lateral-raise", primaryMuscles: ["side_delts"] }),
  mv({ id: "lr3", slug: "machine-lateral-raise", primaryMuscles: ["side_delts"] }),
  mv({ id: "lr4", slug: "leaning-lateral-raise", primaryMuscles: ["side_delts"] }),
  mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "bi2", slug: "ez-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "tri1", slug: "rope-pushdown", primaryMuscles: ["triceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "tri2", slug: "overhead-ext", primaryMuscles: ["triceps"], primaryRegion: "elbow_forearm" }),
];

function pick(seed: number | undefined) {
  return pickAccessoriesForSession({
    profile: STRENGTH_ANCHOR.accessoryProfile!,
    weekDeloadScale: 1.0,
    catalog: CATALOG,
    weekAccessoryHistory: [],
    filters: {
      blockedRegions: new Set(),
      blockedMuscles: new Set(),
      blockedMovementIds: new Set(),
      allowedMovementIds: new Set(),
      concurrentStressActive: false,
      recentlyUsedMovementIds: new Set(),
      tendinopathyActive: false,
    },
    perMuscleTargets: { side_delts: 6, biceps: 6, triceps: 6 },
    maxItems: 6,
    aestheticMaxItems: 6,
    variationSeed: seed,
  }).map((p) => p.movementId);
}

describe("accessory picker — quick variation", () => {
  it("no seed → deterministic (same result every call)", () => {
    expect(pick(undefined)).toEqual(pick(undefined));
  });

  it("same seed → identical (deterministic given the seed)", () => {
    expect(pick(7)).toEqual(pick(7));
  });

  it("different seeds → at least one different pick across a small sweep", () => {
    const base = JSON.stringify(pick(1));
    const variants = [2, 3, 4, 5, 6, 7, 8].map((s) => JSON.stringify(pick(s)));
    expect(variants.some((v) => v !== base)).toBe(true);
  });

  it("variation stays within the catalog (never invents a movement)", () => {
    const ids = new Set(CATALOG.map((m) => m.id));
    for (const s of [1, 2, 3, 4, 5]) {
      for (const id of pick(s)) expect(ids.has(id)).toBe(true);
    }
  });
});
