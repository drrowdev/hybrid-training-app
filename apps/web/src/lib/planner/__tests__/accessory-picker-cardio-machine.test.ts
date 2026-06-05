/**
 * Regression tests for two accessory-picker leaks surfaced from the
 * Quick-workout flow:
 *
 *   1. Cardio movements (`pattern: "cardio"`, e.g. "Erg Row — Threshold")
 *      were being chosen as strength accessories via the aesthetic
 *      muscle-gap pass, then rendered nonsensically through the
 *      accessory-intensity "hold" path. They must be excluded from the
 *      candidate pool entirely.
 *
 *   2. Machine-only movements whose slug doesn't name one of the ten
 *      tracked `MachineType`s (e.g. "Reverse Pec Deck" →
 *      `rear-delt-fly-machine`, tagged `machine-reverse-pec`) leaked past
 *      the slug-only equipment heuristic and were prescribed to users
 *      with no machines. The authoritative DB `equipment` tag must drive
 *      the machine filter via `resolveRequiredEquipment`.
 */
import { describe, it, expect } from "vitest";
import {
  pickAccessoriesForSession,
  type CatalogMovement,
} from "../accessory-picker";
import type { AccessoryProfile } from "../accessory-roles";
import {
  COMMERCIAL_GYM_PRESET,
  HOME_GYM_PRESET,
} from "@/lib/settings/equipment-presets";

function mv(
  over: Partial<CatalogMovement> & { id: string; slug: string },
): CatalogMovement {
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
    pattern: over.pattern,
    equipment: over.equipment,
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

describe("pickAccessoriesForSession — cardio exclusion", () => {
  it("never picks a cardio-pattern movement as an accessory", () => {
    const catalog: CatalogMovement[] = [
      // A cardio "row" carrying the same muscle tags as the seed erg
      // rows — exactly the shape that used to leak into the rear-delt
      // / mid-back aesthetic gap.
      mv({
        id: "erg-threshold",
        slug: "erg-threshold",
        displayName: "Erg Row — Threshold",
        pattern: "cardio",
        equipment: "erg",
        primaryMuscles: ["rear_delts", "mid_back", "lats"],
        primaryRegion: "shoulder_scapular",
      }),
      // A legitimate rear-delt accessory so the pool isn't empty.
      mv({
        id: "rear-delt-fly-db",
        slug: "rear-delt-fly-db",
        displayName: "Rear Delt Fly (DB)",
        primaryMuscles: ["rear_delts"],
        primaryRegion: "shoulder_scapular",
      }),
    ];
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { rear_delts: 6, mid_back: 6, lats: 6 },
      maxItems: 6,
      equipment: COMMERCIAL_GYM_PRESET,
    });
    const slugs = picks.map((p) => p.slug);
    expect(slugs).not.toContain("erg-threshold");
    expect(slugs).toContain("rear-delt-fly-db");
  });
});

describe("pickAccessoriesForSession — DB equipment-tag machine filter", () => {
  const catalog: CatalogMovement[] = [
    // Machine-only, slug does NOT name a tracked MachineType — the
    // exact leak the user reported (Reverse Pec Deck).
    mv({
      id: "reverse-pec-deck",
      slug: "rear-delt-fly-machine",
      displayName: "Reverse Pec Deck",
      equipment: "machine-reverse-pec",
      primaryMuscles: ["rear_delts"],
      primaryRegion: "shoulder_scapular",
    }),
    // Free-weight alternative that survives a no-machine inventory.
    mv({
      id: "rear-delt-fly-db",
      slug: "rear-delt-fly-db",
      displayName: "Rear Delt Fly (DB)",
      equipment: "dumbbells",
      primaryMuscles: ["rear_delts"],
      primaryRegion: "shoulder_scapular",
    }),
  ];

  it("excludes a machine-tagged movement when the user owns no machines", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { rear_delts: 6 },
      maxItems: 6,
      // home gym → no machines
      equipment: { ...HOME_GYM_PRESET, dumbbells: { minKg: 5, maxKg: 40, stepKg: 2.5 } },
    });
    const slugs = picks.map((p) => p.slug);
    expect(slugs).not.toContain("rear-delt-fly-machine");
    expect(slugs).toContain("rear-delt-fly-db");
  });

  it("includes the machine-tagged movement when the user owns a machine", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { rear_delts: 6 },
      maxItems: 6,
      equipment: COMMERCIAL_GYM_PRESET,
    });
    const slugs = picks.map((p) => p.slug);
    expect(slugs).toContain("rear-delt-fly-machine");
  });
});
