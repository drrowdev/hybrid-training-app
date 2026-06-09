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

  it("groin-loading squat/split variants tag adductors (limitation safety, migration 0099)", () => {
    // The limitation safety filter keys off muscle tags, so any movement that
    // meaningfully loads the adductors must declare them — otherwise it slips
    // past an adductor-injury flag (and was even recommended as a "safe" swap).
    const mustTagAdductors = [
      "spanish-squat",
      "iso-split-squat",
      "split-squat-bb",
      "split-squat-db",
      "bulgarian-split-squat-bb",
      "bulgarian-split-squat-db",
      "atg-split-squat",
      "cossack-squat",
      "cossack-squat-loaded",
      "front-squat",
      "hsr-front-squat",
      "zercher-squat",
      "hsr-leg-press",
      "leg-press-45",
      "leg-press-vertical",
      "wall-sit",
      "iso-wall-sit-heavy",
      "sumo-deadlift",
    ];
    for (const slug of mustTagAdductors) {
      const m = SEED.find((x) => x.slug === slug);
      expect(m, `${slug} missing from seed`).toBeTruthy();
      const muscles = [
        ...((m!.primaryMuscles as string[] | undefined) ?? []),
        ...((m!.secondaryMuscles as string[] | undefined) ?? []),
      ];
      expect(muscles, `${slug} must tag adductors (groin-loading)`).toContain(
        "adductors",
      );
    }
  });

  it("injury-site tagging audit invariants (migration 0100)", () => {
    const musclesOf = (slug: string): string[] => {
      const m = SEED.find((x) => x.slug === slug);
      expect(m, `${slug} missing from seed`).toBeTruthy();
      return [
        ...((m!.primaryMuscles as string[] | undefined) ?? []),
        ...((m!.secondaryMuscles as string[] | undefined) ?? []),
      ];
    };
    const regionsOf = (slug: string): string[] => {
      const m = SEED.find((x) => x.slug === slug)!;
      return [
        m.primaryRegion as string,
        ...((m.secondaryRegions as string[] | undefined) ?? []),
      ];
    };

    // Unsupported spinal loaders must tag lower_back + lumbar_trunk so a
    // lower-back flag avoids them. (Supported rows / hip thrusts are excluded.)
    const spinalLoaders = [
      "bb-row-overhand", "bb-row-underhand", "pendlay-row", "meadows-row", "t-bar-row",
      "ohp-standing", "push-press", "db-shoulder-press-standing", "landmine-press-standing", "z-press",
      "hsr-rdl", "rdl-db", "single-leg-rdl", "kb-swing-american", "hsr-front-squat", "split-jerk",
    ];
    for (const slug of spinalLoaders) {
      expect(musclesOf(slug), `${slug} must tag lower_back`).toContain("lower_back");
      expect(regionsOf(slug), `${slug} must tag lumbar_trunk region`).toContain("lumbar_trunk");
    }

    // Overhand/neutral bent-over + low-cable rows recruit the biceps.
    for (const slug of ["bb-row-overhand", "pendlay-row", "meadows-row", "t-bar-row", "cable-row-low"]) {
      expect(musclesOf(slug), `${slug} must tag biceps`).toContain("biceps");
    }

    // Every Olympic lift grips/pulls a loaded implement → forearms.
    for (const m of SEED) {
      if (m.pattern === "olympic") {
        const mu = [
          ...((m.primaryMuscles as string[] | undefined) ?? []),
          ...((m.secondaryMuscles as string[] | undefined) ?? []),
        ];
        expect(mu, `${m.slug} (olympic) must tag forearms`).toContain("forearms");
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
