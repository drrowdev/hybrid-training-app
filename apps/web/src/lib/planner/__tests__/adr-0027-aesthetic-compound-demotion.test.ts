/**
 * ADR 0027 Lever A — the aesthetic (hypertrophy gap-fill) slot must prefer a
 * targeted isolation over a redundant compound that merely echoes the main
 * lift. The demotion is scoped to the aesthetic slot ONLY: the durability /
 * functional / power passes still select compounds.
 *
 * Pure-function tests against a synthetic catalog. The compound is listed
 * FIRST so that, absent the demotion, it would win the SFR tie on array order
 * (the production tie-break, since `loadPickerCatalog` has no ORDER BY).
 */
import { describe, expect, it } from "vitest";
import { pickAccessoriesForSession, type CatalogMovement } from "../accessory-picker";
import type { AccessoryProfile, FunctionalRole } from "../accessory-roles";

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

const PROFILE: AccessoryProfile = {
  aesthetic: {
    itemsPerSession: 4,
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

// A compound and an isolation, BOTH primary-train side_delts, identical SFR.
// Compound is first → wins the tie on array order absent the demotion.
const SIDE_DELT_COMPOUND = mv({
  id: "c1",
  slug: "kb-swing-american",
  primaryMuscles: ["side_delts"],
  isCompound: true,
  stimToFatigueScore: 3,
});
const SIDE_DELT_ISO = mv({
  id: "i1",
  slug: "db-lateral-raise",
  primaryMuscles: ["side_delts"],
  isCompound: false,
  stimToFatigueScore: 3,
});

describe("ADR 0027 Lever A — aesthetic-slot compound demotion", () => {
  it("aesthetic gap-fill prefers the isolation over an equal-SFR compound", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: [SIDE_DELT_COMPOUND, SIDE_DELT_ISO],
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 3 },
      maxItems: 4,
    });
    const aesthetic = picks.filter((p) => p.reason === "aesthetic");
    expect(aesthetic.length).toBeGreaterThan(0);
    // The isolation fills the side_delts gap; the redundant compound is never
    // reached (one isolation item satisfies the target).
    expect(aesthetic[0]!.slug).toBe("db-lateral-raise");
    expect(aesthetic.some((p) => p.slug === "kb-swing-american")).toBe(false);
  });

  it("still picks the compound when it is the only candidate (re-rank, never filter)", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: [SIDE_DELT_COMPOUND], // no isolation alternative
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6 },
      maxItems: 4,
    });
    const aesthetic = picks.filter((p) => p.reason === "aesthetic");
    // Slot is still filled — the penalty re-ranks, it does not drop volume.
    expect(aesthetic.some((p) => p.slug === "kb-swing-american")).toBe(true);
  });

  it("does NOT leak into the functional pass — a compound still fills a functional role", () => {
    const role: FunctionalRole = "anti_rotation";
    const compoundWithRole = mv({
      id: "c2",
      slug: "landmine-press",
      primaryMuscles: ["front_delts"],
      isCompound: true,
      functionalRoles: [role],
      stimToFatigueScore: 3,
    });
    const isoWithRole = mv({
      id: "i2",
      slug: "pallof-press",
      primaryMuscles: ["abs"],
      isCompound: false,
      functionalRoles: [role],
      stimToFatigueScore: 3,
    });
    const picks = pickAccessoriesForSession({
      profile: {
        ...PROFILE,
        functional: { weeklyRoleRequirements: { [role]: 1 } },
      },
      weekDeloadScale: 1.0,
      catalog: [compoundWithRole, isoWithRole],
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: {},
      maxItems: 4,
    });
    const functional = picks.filter((p) => p.reason === "functional");
    // The compound (listed first, equal SFR) wins the functional slot — the
    // aesthetic demotion did not bleed into this pass.
    expect(functional.some((p) => p.slug === "landmine-press")).toBe(true);
    expect(functional.some((p) => p.slug === "pallof-press")).toBe(false);
  });
});
