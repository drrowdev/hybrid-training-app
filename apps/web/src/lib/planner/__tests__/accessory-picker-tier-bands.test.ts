/**
 * PR W2 — accessory picker honours per-movement experience bands.
 *
 * For each tier 0..4, the new band filter (`filterForExperienceTier`,
 * routed through every dispatch path in `pickAccessoriesForSession`)
 * must:
 *
 *   - Include a row with band `(0, 4)` — universal.
 *   - Exclude a row with band `(tier+1, 4)` — out of range below.
 *   - Exclude a row with band `(0, tier-1)` — out of range above.
 *   - Be a no-op for `null` experience (legacy unfiltered behaviour).
 */
import { describe, it, expect } from "vitest";
import {
  filterForExperienceTier,
  type CatalogMovement,
} from "../accessory-picker";

function mv(
  over: Partial<CatalogMovement> & { id: string; slug: string },
): CatalogMovement {
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
    experienceMin: over.experienceMin,
    experienceMax: over.experienceMax,
  };
}

describe("filterForExperienceTier — band gates by tier", () => {
  for (const tier of [0, 1, 2, 3, 4] as const) {
    it(`tier ${tier}: universal band (0, 4) IS included`, () => {
      const universal = mv({ id: `u${tier}`, slug: `u${tier}`, experienceMin: 0, experienceMax: 4 });
      const exp = ["beginner_lt_6m", "novice_6m_2y", "intermediate_2y_5y", "advanced_5y_10y", "highly_advanced_10y_plus"][tier] as Parameters<typeof filterForExperienceTier>[1];
      const out = filterForExperienceTier([universal], exp);
      expect(out.map((m) => m.id)).toContain(`u${tier}`);
    });

    if (tier < 4) {
      it(`tier ${tier}: row with band (${tier + 1}, 4) is excluded`, () => {
        const above = mv({ id: `a${tier}`, slug: `a${tier}`, experienceMin: tier + 1, experienceMax: 4 });
        const exp = ["beginner_lt_6m", "novice_6m_2y", "intermediate_2y_5y", "advanced_5y_10y", "highly_advanced_10y_plus"][tier] as Parameters<typeof filterForExperienceTier>[1];
        const out = filterForExperienceTier([above], exp);
        expect(out.map((m) => m.id)).not.toContain(`a${tier}`);
      });
    }

    if (tier > 0) {
      it(`tier ${tier}: row with band (0, ${tier - 1}) is excluded`, () => {
        const below = mv({ id: `b${tier}`, slug: `b${tier}`, experienceMin: 0, experienceMax: tier - 1 });
        const exp = ["beginner_lt_6m", "novice_6m_2y", "intermediate_2y_5y", "advanced_5y_10y", "highly_advanced_10y_plus"][tier] as Parameters<typeof filterForExperienceTier>[1];
        const out = filterForExperienceTier([below], exp);
        expect(out.map((m) => m.id)).not.toContain(`b${tier}`);
      });
    }
  }

  it("null experience → no filter (legacy unfiltered behaviour preserved)", () => {
    const a = mv({ id: "a", slug: "a", experienceMin: 3, experienceMax: 4 });
    const b = mv({ id: "b", slug: "b", experienceMin: 0, experienceMax: 0 });
    const c = mv({ id: "c", slug: "c", experienceMin: 0, experienceMax: 4 });
    const out = filterForExperienceTier([a, b, c], null);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("rows without bands are treated as universal (0, 4)", () => {
    // Legacy fixture catalogs predate the band column. The resolver
    // reads `m.experienceMin ?? 0` / `m.experienceMax ?? 4` so an
    // absent band lets the row through for every tier.
    const naked = mv({ id: "n", slug: "n" });
    for (const exp of [
      "beginner_lt_6m",
      "novice_6m_2y",
      "intermediate_2y_5y",
      "advanced_5y_10y",
      "highly_advanced_10y_plus",
    ] as const) {
      const out = filterForExperienceTier([naked], exp);
      expect(out.map((m) => m.id)).toContain("n");
    }
  });
});
