/**
 * ADR 0036 — universal weekly pull floor.
 *
 * No main-lift pattern is a pull, so without a guaranteed pulling accessory a
 * block ships zero back/biceps volume. The picker adds a `pull: 1` weekly
 * functional requirement on EVERY archetype. These tests verify it seats from a
 * catalog that has a pull, and that a catalog WITHOUT a pull simply skips it
 * (soft — no crash, no empty fill).
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

const ROW = mv({ id: "row", slug: "chest-supported-row", pattern: "pull", functionalRoles: ["pull"], primaryMuscles: ["mid_back", "lats", "biceps"], primaryRegion: "shoulder_scapular" });
const HIP = mv({ id: "hip", slug: "hip-abduction", functionalRoles: ["hip_stabilizer"], primaryMuscles: ["glutes"], primaryRegion: "hip_pelvis" });
const LR = mv({ id: "lr", slug: "lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" });

const PROFILE: AccessoryProfile = {
  aesthetic: { itemsPerSession: 1, setsPerItem: 2, repRange: { min: 12, max: 15 }, biasSupported: false },
  functional: { weeklyRoleRequirements: { hip_stabilizer: 1 } },
  durability: { extras: [] },
};

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

function run(catalog: CatalogMovement[], history: Parameters<typeof pickAccessoriesForSession>[0]["weekAccessoryHistory"] = []) {
  return pickAccessoriesForSession({
    profile: PROFILE,
    weekDeloadScale: 1.0,
    catalog,
    weekAccessoryHistory: history,
    filters: EMPTY_FILTERS,
    perMuscleTargets: defaultMuscleTargets().targetsByMuscle,
    maxItems: 6,
  });
}

const hasPull = (picks: ReturnType<typeof pickAccessoriesForSession>) =>
  picks.some((p) => p.slug === "chest-supported-row");

describe("universal pull floor (ADR 0036)", () => {
  it("seats a pull on every archetype-shaped session when the catalog has one", () => {
    const picks = run([ROW, HIP, LR]);
    expect(hasPull(picks)).toBe(true);
  });

  it("is additive — the existing functional floor (hip) still seats alongside the pull", () => {
    const picks = run([ROW, HIP, LR]);
    expect(picks.some((p) => p.slug === "hip-abduction")).toBe(true);
    expect(hasPull(picks)).toBe(true);
  });

  it("does not add a second FUNCTIONAL pull once the week already has one (history credit)", () => {
    const history: Parameters<typeof pickAccessoriesForSession>[0]["weekAccessoryHistory"] = [
      { movementId: "row", bulletproofRoles: [], functionalRoles: ["pull"], primaryMuscles: ["mid_back", "lats", "biceps"], sets: 2 },
    ];
    const picks = run([ROW, HIP, LR], history);
    // The functional pull requirement is satisfied by history, so the FUNCTIONAL
    // pass adds none. (A pull may still appear via the aesthetic gap-fill for a
    // back muscle gap — that's desirable, not a duplicate floor pick.)
    const functionalPulls = picks.filter(
      (p) => p.reason === "functional" && p.slug === "chest-supported-row",
    );
    expect(functionalPulls).toHaveLength(0);
  });

  it("soft-skips when no pull movement is available (no crash, no empty fill)", () => {
    const picks = run([HIP, LR]);
    expect(hasPull(picks)).toBe(false);
    // The rest of the session still assembles.
    expect(picks.length).toBeGreaterThan(0);
  });
});
