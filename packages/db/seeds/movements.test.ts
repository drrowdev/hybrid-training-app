/**
 * Seed-shape invariants for the movement catalog (DC-A6 + DC-T1 + DC-J5).
 *
 * These tests guarantee the seed never silently drifts off the design
 * constraints — running them in CI catches any new movement that's
 * missing a primary muscle, a region, or has an impossible combination.
 */
import { describe, expect, it } from "vitest";
import { SEED_MOVEMENTS } from "./movements";

const SEED = SEED_MOVEMENTS;

describe("movement catalog seed", () => {
  it("contains ≥ 250 movements (Phase 1 target)", () => {
    expect(SEED.length).toBeGreaterThanOrEqual(250);
  });

  it("every movement has a unique slug", () => {
    const slugs = new Set<string>();
    for (const m of SEED) {
      expect(slugs.has(m.slug), `duplicate slug: ${m.slug}`).toBe(false);
      slugs.add(m.slug);
    }
  });

  it("every movement has a non-empty display name", () => {
    for (const m of SEED) {
      expect(m.displayName, `${m.slug} missing displayName`).toBeTruthy();
    }
  });

  it("every movement has a region (DC-A6)", () => {
    for (const m of SEED) {
      expect(m.primaryRegion, `${m.slug} missing primaryRegion`).toBeTruthy();
    }
  });

  it("non-carry movements have ≥ 1 primary muscle (DC-T1)", () => {
    for (const m of SEED) {
      // Carries are trunk/grip-stabilisation work; primary "muscle" is fuzzy.
      if (m.pattern === "carry") continue;
      expect(
        m.primaryMuscles.length,
        `${m.slug} missing primary muscles`,
      ).toBeGreaterThan(0);
    }
  });

  it("every userId is null (global seeds only)", () => {
    for (const m of SEED) {
      expect(m.userId, `${m.slug} should be global, got ${m.userId}`).toBeNull();
    }
  });

  it("high_strain_tendon implies a region (DC-J5 refractory key)", () => {
    for (const m of SEED) {
      if (m.highStrainTendon) {
        expect(
          m.primaryRegion,
          `${m.slug} flagged high_strain_tendon needs a region`,
        ).toBeTruthy();
      }
    }
  });

  it("axial_load=high implies isCompound (no isolation lift is heavily axial)", () => {
    for (const m of SEED) {
      if (m.axialLoad === "high") {
        expect(
          m.isCompound,
          `${m.slug} axial_load=high but isCompound=false`,
        ).toBe(true);
      }
    }
  });

  it("Olympic pattern implies isCompound (engine reads pattern for conflict-matrix CNS rules)", () => {
    for (const m of SEED) {
      if (m.pattern === "olympic") expect(m.isCompound).toBe(true);
    }
  });

  it("cardio modalities carry an explicit interference_cost (DC-D4)", () => {
    // Acceptable values per Wilson 2012 modality table: any of the 7 enum
    // values. Sled push is legitimately very_low; cycling Z2 is low.
    // The test only ensures it's set; the value is movement-specific.
    for (const m of SEED) {
      if (m.pattern === "cardio") {
        expect(
          m.interferenceCost,
          `${m.slug} cardio needs interferenceCost`,
        ).toBeTruthy();
      }
    }
  });
});

describe("muscle taxonomy coverage", () => {
  // DC-T1: priorities are shoulders (delts), arms (biceps/triceps),
  // calves, abs, upper_chest, back_detail (lats/mid_back), glutes.
  // Every priority muscle must have ≥ 3 movements primarily working it.
  const priorityMuscles = [
    "front_delts",
    "side_delts",
    "rear_delts",
    "biceps",
    "triceps",
    "calves",
    "abs",
    "upper_chest",
    "lats",
    "mid_back",
    "glutes",
    "quads",
    "hamstrings",
    "chest",
  ] as const;

  for (const muscle of priorityMuscles) {
    it(`has ≥ 3 movements primarily working ${muscle}`, () => {
      const count = SEED.filter((m) =>
        m.primaryMuscles.includes(muscle as never),
      ).length;
      expect(count, `${muscle}: only ${count} movements`).toBeGreaterThanOrEqual(3);
    });
  }
});
