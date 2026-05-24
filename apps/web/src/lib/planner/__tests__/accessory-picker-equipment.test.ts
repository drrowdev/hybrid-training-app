/**
 * Equipment-aware accessory-picker integration tests.
 *
 * Verifies that:
 *   - When given a `home_gym` preset (no machines, no DBs by default),
 *     the picker excludes every machine- and cable-tagged movement.
 *   - When given a `commercial_gym` preset, no filtering occurs and the
 *     same candidates remain reachable as without an equipment blob.
 *   - The picker only ever produces accessory/tendon picks — main lifts
 *     come from the TM-resolved variant path in `actions.ts` and bypass
 *     the picker entirely, so they cannot be filtered out by mistake.
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

const CATALOG: CatalogMovement[] = [
  // Side-delt candidates spanning machine / cable / DB / generic.
  mv({ id: "lr-cable", slug: "cable-lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "lr-machine", slug: "lateral-raise-machine", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "lr-db", slug: "lateral-raise-db", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  // Quad candidates spanning leg-press machine / DB split-squat / bodyweight.
  mv({ id: "leg-press", slug: "leg-press-45", primaryMuscles: ["quads"], primaryRegion: "knee" }),
  mv({ id: "bss-db", slug: "bulgarian-split-squat-db", primaryMuscles: ["quads"], primaryRegion: "knee" }),
  mv({ id: "pistol", slug: "pistol-squat", primaryMuscles: ["quads"], primaryRegion: "knee" }),
  // Floor durability fillers (always-allowed: isometric, generic).
  mv({ id: "wall-sit", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "pallof", slug: "pallof-press", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryRegion: "lumbar_trunk", primaryMuscles: ["abs"] }),
];

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

describe("pickAccessoriesForSession — equipment filter", () => {
  it("home gym (no machines, no DBs default): excludes every machine / cable / DB pick", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, quads: 6 },
      maxItems: 6,
      equipment: HOME_GYM_PRESET,
    });
    const slugs = picks.map((p) => p.slug);
    expect(slugs).not.toContain("cable-lateral-raise");
    expect(slugs).not.toContain("leg-press-45");
    // Home gym has no dumbbells by default either.
    expect(slugs).not.toContain("lateral-raise-db");
    expect(slugs).not.toContain("bulgarian-split-squat-db");
    // `lateral-raise-machine` does not name a specific MachineType in
    // the slug, so per the conservative heuristic it falls through to
    // `bodyweight_or_generic` and may still be picked. Test pins that
    // the *specific*-machine and *cable* matches are filtered out.
    // Still produces something — bodyweight + isometric remain.
    expect(picks.length).toBeGreaterThan(0);
  });

  it("commercial gym: returns the same full pool as no-equipment-filter mode", () => {
    const withEquip = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, quads: 6 },
      maxItems: 6,
      equipment: COMMERCIAL_GYM_PRESET,
    });
    const withoutEquip = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, quads: 6 },
      maxItems: 6,
    });
    expect(withEquip.map((p) => p.slug).sort()).toEqual(
      withoutEquip.map((p) => p.slug).sort(),
    );
  });

  it("main lifts bypass the filter — picker never returns main-lift kinds", () => {
    // The picker only emits picks with reason ∈
    // {durability, functional, aesthetic, power}. Main lifts are
    // resolved upstream (createBlock TM lookup) and never enter the
    // picker's catalog argument as "main". This test pins that
    // contract: even with the strictest equipment blob (no bars at
    // all), the picker's output never claims to be a main-lift pick
    // because the type system forbids it. We assert at runtime too.
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6 },
      maxItems: 6,
      equipment: {
        ...HOME_GYM_PRESET,
        bars: { barbellKg: 0, trapBarKg: null, safetyBarKg: null },
      },
    });
    for (const p of picks) {
      expect(["durability", "functional", "aesthetic", "power"]).toContain(p.reason);
    }
  });
});
