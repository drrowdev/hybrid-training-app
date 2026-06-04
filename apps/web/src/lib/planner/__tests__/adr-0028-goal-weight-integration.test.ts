import { describe, it, expect } from "vitest";
import { pickAccessoriesForSession, type CatalogMovement } from "../accessory-picker";
import type { AccessoryProfile } from "../accessory-roles";
import { computeWeeklyCompoundCredit } from "../synergist-credit";
import { applyGoalWeightToTargets } from "../aesthetic-goal-weight";
import { STRENGTH_ANCHOR } from "../archetypes";

/**
 * ADR 0028 — integration proof. The goal-weight lowers the physique
 * triad's per-muscle aesthetic target; this test verifies the PICKER
 * actually responds — redirecting gap-fill slots off the triad and onto
 * performance/postural muscles — rather than the constant being inert.
 *
 * Uses an aesthetic-rich catalog (one isolation per target muscle) so the
 * picker has a real choice for every muscle. Durability/functional floors
 * are empty here so every slot is an aesthetic fill.
 */

function mv(over: Partial<CatalogMovement> & { id: string; slug: string }): CatalogMovement {
  return {
    id: over.id, slug: over.slug, displayName: over.displayName ?? over.slug,
    primaryMuscles: over.primaryMuscles ?? [], secondaryMuscles: over.secondaryMuscles ?? [],
    primaryRegion: over.primaryRegion ?? "lumbar_trunk", secondaryRegions: over.secondaryRegions ?? [],
    bulletproofRoles: over.bulletproofRoles ?? [], functionalRoles: over.functionalRoles ?? [],
    isSupported: over.isSupported ?? false, isCompound: over.isCompound ?? false,
    eccentricLoadScore: over.eccentricLoadScore ?? null, stimToFatigueScore: over.stimToFatigueScore ?? null,
    highStrainTendon: over.highStrainTendon ?? false,
  };
}

const CATALOG: CatalogMovement[] = [
  mv({ id: "lr1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "rd1", slug: "rear-delt-fly", primaryMuscles: ["rear_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "tri1", slug: "rope-pushdown", primaryMuscles: ["triceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "cf1", slug: "calf-raise", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf" }),
  mv({ id: "ab1", slug: "cable-crunch", primaryMuscles: ["abs"], primaryRegion: "lumbar_trunk" }),
  mv({ id: "uc1", slug: "incline-fly", primaryMuscles: ["upper_chest"], primaryRegion: "chest" }),
  mv({ id: "lt1", slug: "straight-arm-pulldown", primaryMuscles: ["lats"], primaryRegion: "lat_thoracic" }),
  mv({ id: "mb1", slug: "face-pull", primaryMuscles: ["mid_back"], primaryRegion: "lat_thoracic" }),
  mv({ id: "ham1", slug: "leg-curl", primaryMuscles: ["hamstrings"], primaryRegion: "hamstring_posterior" }),
  mv({ id: "fa1", slug: "wrist-curl", primaryMuscles: ["forearms"], primaryRegion: "elbow_forearm" }),
];

const TRIAD = new Set(["side_delts", "biceps", "calves"]);
const ALL_AESTHETIC = [
  "side_delts", "rear_delts", "biceps", "triceps", "calves",
  "abs", "upper_chest", "lats", "mid_back", "hamstrings", "forearms",
];

function aestheticAllocation(targets: Record<string, number>, maxItems: number) {
  const profile: AccessoryProfile = {
    aesthetic: { itemsPerSession: maxItems, setsPerItem: 3, repRange: { min: 10, max: 15 }, biasSupported: false },
    functional: { weeklyRoleRequirements: {} },
    durability: { extras: [] },
  };
  const picks = pickAccessoriesForSession({
    profile, weekDeloadScale: 1.0, catalog: CATALOG, weekAccessoryHistory: [],
    filters: { blockedRegions: new Set(), concurrentStressActive: false, recentlyUsedMovementIds: new Set(), tendinopathyActive: false },
    perMuscleTargets: targets, maxItems,
    compoundCoverageCredit: computeWeeklyCompoundCredit(STRENGTH_ANCHOR),
  });
  const aesthetic = picks.filter((p) => p.reason === "aesthetic");
  const muscleOf = (mid: string) => CATALOG.find((c) => c.id === mid)?.primaryMuscles[0] ?? "?";
  const muscles = aesthetic.map((p) => muscleOf(p.movementId));
  return { triadCount: muscles.filter((m) => TRIAD.has(m)).length, total: aesthetic.length };
}

const uniform = Object.fromEntries(ALL_AESTHETIC.map((m) => [m, 6]));

describe("ADR 0028 — picker redirects off the triad (integration)", () => {
  for (const budget of [2, 4, 6]) {
    it(`strength_anchor budget ${budget}: goal-weight strictly reduces triad fills, same slot count`, () => {
      const weighted = applyGoalWeightToTargets(uniform, {
        archetypeId: "strength_anchor",
        secondaryMuscleHonored: false,
      });
      const base = aestheticAllocation(uniform, budget);
      const gw = aestheticAllocation(weighted, budget);
      // Redirect, not cut: the same number of aesthetic slots are filled
      // (catalog is deeper than the budget), but fewer land on the triad.
      expect(gw.total).toBe(base.total);
      expect(gw.triadCount).toBeLessThan(base.triadCount);
    });
  }

  it("hypertrophy_anchor: no down-weight, allocation identical to uniform", () => {
    const weighted = applyGoalWeightToTargets(uniform, {
      archetypeId: "hypertrophy_anchor",
      secondaryMuscleHonored: false,
    });
    const base = aestheticAllocation(uniform, 4);
    const gw = aestheticAllocation(weighted, 4);
    expect(gw.triadCount).toBe(base.triadCount);
  });
});
