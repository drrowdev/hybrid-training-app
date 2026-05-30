import { describe, it, expect } from "vitest";
import {
  pickAccessoriesForSession,
  movementValueNorm,
  type CatalogMovement,
  type WeekContextItem,
} from "../accessory-picker";
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
    isLoadable: over.isLoadable ?? false,
    eccentricLoadScore: over.eccentricLoadScore ?? null,
    stimToFatigueScore: over.stimToFatigueScore ?? null,
    highStrainTendon: over.highStrainTendon ?? false,
  };
}

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

// Profile where the ONLY unmet deficit is heavy_isometric, so the picker's
// first (and only) pick is decided purely by candidate scoring among the
// heavy_isometric movements. Mirrors the rotation test in
// accessory-picker.test.ts.
const ISO_ONLY: AccessoryProfile = {
  aesthetic: { itemsPerSession: 0, setsPerItem: 3, repRange: { min: 10, max: 15 }, biasSupported: false },
  functional: { weeklyRoleRequirements: {} },
  durability: { extras: [] },
};

// Pre-satisfy every durability floor role except heavy_isometric.
const PRESATISFIED_CONTEXT: WeekContextItem[] = [
  { movementId: "hsr1", bulletproofRoles: ["hsr"], functionalRoles: [], primaryMuscles: [] },
  { movementId: "plyo1", bulletproofRoles: ["plyometric_low"], functionalRoles: [], primaryMuscles: [] },
  { movementId: "carry1", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
  { movementId: "carry2", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
];

describe("movementValueNorm (ADR 0012)", () => {
  it("scores compound + loadable as a maximal staple (1.0)", () => {
    expect(movementValueNorm(mv({ id: "a", slug: "weighted-chin", isCompound: true, isLoadable: true }))).toBe(1);
  });

  it("scores compound-only at ~0.67 and loadable-only at ~0.33", () => {
    expect(movementValueNorm(mv({ id: "b", slug: "row", isCompound: true }))).toBeCloseTo(2 / 3, 5);
    expect(movementValueNorm(mv({ id: "c", slug: "bw-only", isLoadable: true }))).toBeCloseTo(1 / 3, 5);
  });

  it("scores a redundant isolation as 0 (free to rotate)", () => {
    expect(movementValueNorm(mv({ id: "d", slug: "lateral-raise" }))).toBe(0);
  });
});

describe("value-weighted block rotation (ADR 0012)", () => {
  it("keeps a high-value staple even when used in the previous block", () => {
    // staple (compound+loadable) used last block vs a fresh isolation.
    // Penalty on the staple is ROTATION_BASE·(1−1)=0, plus a value bonus,
    // so the staple still wins → it persists across blocks.
    const catalog = [
      mv({ id: "iso1", slug: "weighted-iso", bulletproofRoles: ["heavy_isometric"], isCompound: true, isLoadable: true }),
      mv({ id: "iso2", slug: "bodyweight-iso", bulletproofRoles: ["heavy_isometric"] }),
    ];
    const picks = pickAccessoriesForSession({
      profile: ISO_ONLY,
      weekDeloadScale: 1.0,
      catalog,
      weekContext: PRESATISFIED_CONTEXT,
      filters: { ...EMPTY_FILTERS, recentlyUsedMovementIds: new Set(["iso1"]) },
      perMuscleTargets: {},
      maxItems: 1,
    });
    expect(picks[0]?.slug).toBe("weighted-iso");
  });

  it("rotates a low-value isolation that was used in the previous block", () => {
    const catalog = [
      mv({ id: "iso1", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"] }),
      mv({ id: "iso2", slug: "spanish-squat-hold", bulletproofRoles: ["heavy_isometric"] }),
    ];
    const picks = pickAccessoriesForSession({
      profile: ISO_ONLY,
      weekDeloadScale: 1.0,
      catalog,
      weekContext: PRESATISFIED_CONTEXT,
      filters: { ...EMPTY_FILTERS, recentlyUsedMovementIds: new Set(["iso1"]) },
      perMuscleTargets: {},
      maxItems: 1,
    });
    expect(picks[0]?.slug).toBe("spanish-squat-hold");
  });

  it("falls back to the recently-used movement when it is the only candidate", () => {
    const catalog = [
      mv({ id: "iso1", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"] }),
    ];
    const picks = pickAccessoriesForSession({
      profile: ISO_ONLY,
      weekDeloadScale: 1.0,
      catalog,
      weekContext: PRESATISFIED_CONTEXT,
      filters: { ...EMPTY_FILTERS, recentlyUsedMovementIds: new Set(["iso1"]) },
      perMuscleTargets: {},
      maxItems: 1,
    });
    expect(picks[0]?.slug).toBe("wall-sit");
  });

  it("is inert with an empty recency set — value flags do not change the pick (parity)", () => {
    // Catalog order decides the tie when recency is empty. The first
    // movement is a low-value isolation; the second is a high-value staple.
    // Pre-ADR-0012 behaviour (catalog order) must be preserved: iso1 wins
    // despite iso2 being higher value, because the value bonus is gated off.
    const catalog = [
      mv({ id: "iso1", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"] }),
      mv({ id: "iso2", slug: "weighted-iso", bulletproofRoles: ["heavy_isometric"], isCompound: true, isLoadable: true }),
    ];
    const picks = pickAccessoriesForSession({
      profile: ISO_ONLY,
      weekDeloadScale: 1.0,
      catalog,
      weekContext: PRESATISFIED_CONTEXT,
      filters: EMPTY_FILTERS,
      perMuscleTargets: {},
      maxItems: 1,
    });
    expect(picks[0]?.slug).toBe("wall-sit");
  });
});
