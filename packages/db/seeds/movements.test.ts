/**
 * Seed-shape invariants for the movement catalog (DC-A6 + DC-T1 + DC-J5).
 *
 * These tests guarantee the seed never silently drifts off the design
 * constraints — running them in CI catches any new movement that's
 * missing a primary muscle, a region, or has an impossible combination.
 */
import { describe, expect, it } from "vitest";
import { requiresPrimaryMuscle, SEED_MOVEMENTS } from "./movements";
import { MOVEMENT_INSTRUCTIONS } from "./movement-instructions";

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

  it("taxonomy-representable movements have ≥ 1 primary muscle (DC-T1)", () => {
    for (const m of SEED) {
      if (!requiresPrimaryMuscle(m)) continue;
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
      "forward-lunge",
      "forward-lunge-db",
      "forward-lunge-bb",
      "reverse-lunge",
      "reverse-lunge-db",
      "reverse-lunge-bb",
      "walking-lunge",
      "walking-lunge-db",
      "walking-lunge-bb",
      "step-up",
      "step-up-db",
      "step-up-bb",
      "curtsy-lunge",
      "curtsy-lunge-db",
      "lateral-lunge",
      "lateral-lunge-db",
      "atg-split-squat",
      "cossack-squat",
      "cossack-squat-loaded",
      "front-squat",
      "hsr-front-squat",
      "landmine-squat-to-box",
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

  it("seeds the lunge / step-up family across bodyweight / DB / BB with how-to content", () => {
    const expected = [
      { slug: "forward-lunge", name: "Forward Lunge", equipment: "bodyweight", axialLoad: "low", experienceMin: 0, region: "knee" },
      { slug: "forward-lunge-db", name: "Forward Lunge (DB)", equipment: "dumbbells", axialLoad: "moderate", experienceMin: 0, region: "knee" },
      { slug: "forward-lunge-bb", name: "Forward Lunge (BB)", equipment: "barbell", axialLoad: "high", experienceMin: 2, region: "knee" },
      { slug: "reverse-lunge", name: "Reverse Lunge", equipment: "bodyweight", axialLoad: "low", experienceMin: 0, region: "knee" },
      { slug: "reverse-lunge-db", name: "Reverse Lunge (DB)", equipment: "dumbbells", axialLoad: "moderate", experienceMin: 0, region: "knee" },
      { slug: "reverse-lunge-bb", name: "Reverse Lunge (BB)", equipment: "barbell", axialLoad: "high", experienceMin: 2, region: "knee" },
      { slug: "walking-lunge", name: "Walking Lunge", equipment: "bodyweight", axialLoad: "low", experienceMin: 0, region: "knee" },
      { slug: "walking-lunge-db", name: "Walking Lunge (DB)", equipment: "dumbbells", axialLoad: "moderate", experienceMin: 0, region: "knee" },
      { slug: "walking-lunge-bb", name: "Walking Lunge (BB)", equipment: "barbell", axialLoad: "high", experienceMin: 2, region: "knee" },
      { slug: "step-up", name: "Step-Up", equipment: "bodyweight", axialLoad: "low", experienceMin: 0, region: "knee" },
      { slug: "step-up-db", name: "Step-Up (DB)", equipment: "dumbbells", axialLoad: "moderate", experienceMin: 0, region: "knee" },
      { slug: "step-up-bb", name: "Step-Up (BB)", equipment: "barbell", axialLoad: "high", experienceMin: 2, region: "knee" },
      { slug: "curtsy-lunge", name: "Curtsy Lunge", equipment: "bodyweight", axialLoad: "low", experienceMin: 1, region: "knee" },
      { slug: "curtsy-lunge-db", name: "Curtsy Lunge (DB)", equipment: "dumbbells", axialLoad: "moderate", experienceMin: 1, region: "knee" },
      // Frontal-plane, trailing-leg groin under load — the groin is the primary
      // region, which is what an adductor_groin limitation actually matches on.
      { slug: "lateral-lunge", name: "Lateral Lunge", equipment: "bodyweight", axialLoad: "low", experienceMin: 0, region: "adductor_groin" },
      { slug: "lateral-lunge-db", name: "Lateral Lunge (DB)", equipment: "dumbbells", axialLoad: "moderate", experienceMin: 0, region: "adductor_groin" },
    ];

    for (const entry of expected) {
      const movement = SEED.find((candidate) => candidate.slug === entry.slug);
      expect(movement, `${entry.slug} missing from seed`).toBeTruthy();
      expect(movement).toMatchObject({
        displayName: entry.name,
        pattern: "squat",
        primaryRegion: entry.region,
        equipment: entry.equipment,
        axialLoad: entry.axialLoad,
        experienceMin: entry.experienceMin,
        bilateral: false,
        isCompound: true,
      });
      // Unilateral squat pattern → the picker's single-leg slot (ADR 0035
      // functional roles). Derived, so a helper change can't silently drop it.
      expect(
        movement?.functionalRoles,
        `${entry.slug} must carry the single_leg role`,
      ).toContain("single_leg");

      const instructions = MOVEMENT_INSTRUCTIONS.find(
        (candidate) => candidate.slug === entry.slug,
      );
      expect(instructions, `${entry.slug} missing instructions`).toBeTruthy();
      expect(instructions!.steps.length).toBeGreaterThanOrEqual(3);
      expect(instructions!.cues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("step-ups name the box they need — the equipment inventory can't model one", () => {
    // `equipment` is tagged plainly (bodyweight / dumbbells / barbell) because
    // the inventory has no box field and a `bodyweight-box` tag would read as
    // externally loaded to `carriesExternalLoad`. The setup text is therefore
    // the only place the requirement is communicated.
    for (const slug of ["step-up", "step-up-db", "step-up-bb"]) {
      const instructions = MOVEMENT_INSTRUCTIONS.find(
        (candidate) => candidate.slug === slug,
      );
      expect(instructions?.setup?.toLowerCase(), `${slug} setup must name the box`).toMatch(
        /box|bench/,
      );
    }
  });

  it("carries exactly one Copenhagen entry (migration 0138 dedupe)", () => {
    const copenhagens = SEED.filter((candidate) =>
      candidate.slug.includes("copenhagen"),
    ).map((candidate) => candidate.slug);
    expect(copenhagens).toEqual(["copenhagen-plank"]);
    expect(
      MOVEMENT_INSTRUCTIONS.filter((candidate) =>
        candidate.slug.includes("copenhagen"),
      ).map((candidate) => candidate.slug),
    ).toEqual(["copenhagen-plank"]);
  });

  it("seeds Landmine Squat to Box with compound metadata and how-to content", () => {
    const movement = SEED.find(
      (candidate) => candidate.slug === "landmine-squat-to-box",
    );
    expect(movement).toMatchObject({
      displayName: "Landmine Squat to a Box",
      pattern: "squat",
      equipment: "barbell-box",
      isCompound: true,
      axialLoad: "moderate",
      stability: "supported",
      isSupported: true,
    });
    expect(movement?.secondaryMuscles).toContain("adductors");

    const instructions = MOVEMENT_INSTRUCTIONS.find(
      (candidate) => candidate.slug === "landmine-squat-to-box",
    );
    expect(instructions?.summary).toContain("controlled depth");
    expect(instructions?.steps).toHaveLength(4);
    expect(instructions?.cues).toContain(
      "Use a stance and depth that stay pain-free.",
    );
  });

  it("seeds all four standing banded hip directions with instructions", () => {
    const expected = [
      {
        slug: "standing-banded-hip-flexion",
        region: "adductor_groin",
        primary: null,
      },
      {
        slug: "standing-banded-hip-extension",
        region: "hamstring_posterior",
        primary: "glutes",
      },
      {
        slug: "standing-banded-hip-abduction",
        region: "hamstring_posterior",
        primary: "abductors",
      },
      {
        slug: "standing-banded-hip-adduction",
        region: "adductor_groin",
        primary: "adductors",
      },
    ];

    for (const entry of expected) {
      const movement = SEED.find((candidate) => candidate.slug === entry.slug);
      expect(movement).toMatchObject({
        equipment: "band",
        pattern: "isolation",
        primaryRegion: entry.region,
        bilateral: false,
        stability: "supported",
        isSupported: true,
        eccentricLoadScore: 1,
        stimToFatigueScore: 4,
      });
      if (entry.primary) {
        expect(movement?.primaryMuscles).toContain(entry.primary);
      } else {
        expect(movement?.primaryMuscles).toEqual([]);
        expect(movement?.secondaryMuscles).toEqual([]);
      }
      expect(movement?.metadata).toMatchObject({
        protocol: "banded-four-way-hip",
      });

      const instructions = MOVEMENT_INSTRUCTIONS.find(
        (candidate) => candidate.slug === entry.slug,
      );
      expect(instructions?.steps).toHaveLength(4);
      expect(instructions?.setup).toContain("opposite hand");
      expect(instructions?.cues.length).toBeGreaterThanOrEqual(2);
      expect(instructions?.commonMistakes).toHaveLength(2);
    }
    expect(
      SEED.find(
        (candidate) => candidate.slug === "standing-banded-hip-abduction",
      )?.functionalRoles,
    ).toContain("hip_stabilizer");
    expect(
      SEED.find(
        (candidate) => candidate.slug === "standing-banded-hip-adduction",
      )?.functionalRoles,
    ).toContain("hip_stabilizer");
    expect(
      SEED.find(
        (candidate) => candidate.slug === "standing-banded-hip-extension",
      ),
    ).toMatchObject({
      secondaryRegions: [],
      secondaryMuscles: ["hamstrings"],
    });
  });

  it("seeds distinct bench-supported forearm rehab motions with instructions", () => {
    const expected = [
      {
        slug: "supported-wrist-curl-db",
        name: "Supported Wrist Curl (DB)",
        motion: "wrist flexion",
        position: "forearm-supported-supinated",
      },
      {
        slug: "supported-reverse-wrist-curl-db",
        name: "Supported Reverse Wrist Curl (DB)",
        motion: "wrist extension",
        position: "forearm-supported-pronated",
      },
      {
        slug: "supported-wrist-radial-deviation-db",
        name: "Supported Wrist Radial Deviation (DB)",
        motion: "radial deviation",
        position: "forearm-supported-neutral",
      },
      {
        slug: "supported-pronation-supination-db",
        name: "Supported Pronation / Supination (DB)",
        motion: "pronation and supination",
        position: "forearm-supported-rotation",
      },
    ];

    for (const entry of expected) {
      const movement = SEED.find((candidate) => candidate.slug === entry.slug);
      expect(movement).toMatchObject({
        displayName: entry.name,
        primaryRegion: "elbow_forearm",
        primaryMuscles: ["forearms"],
        equipment: "dumbbell",
        bilateral: false,
        isSupported: true,
        stability: "supported",
      });

      const instructions = MOVEMENT_INSTRUCTIONS.find(
        (candidate) => candidate.slug === entry.slug,
      );
      expect(instructions?.summary.toLowerCase()).toContain(entry.motion);
      expect(instructions?.setup?.toLowerCase()).toContain("bench");
      expect(instructions?.cues.length).toBeGreaterThanOrEqual(2);
      expect(instructions?.commonMistakes).toHaveLength(2);
      expect(movement?.metadata).toMatchObject({
        position: entry.position,
      });
    }

    for (const slug of [
      "wrist-curl-db",
      "wrist-curl-bb",
      "reverse-wrist-curl",
      "db-pronation-supination",
    ]) {
      const movement = SEED.find((candidate) => candidate.slug === slug);
      expect(movement?.isSupported ?? false, `${slug} must remain a general variant`).toBe(
        false,
      );
      expect(movement?.stability).toBe("free");

      const instructions = MOVEMENT_INSTRUCTIONS.find(
        (candidate) => candidate.slug === slug,
      );
      expect(instructions?.summary.toLowerCase()).toContain("general");
      expect(instructions?.setup?.toLowerCase()).not.toContain("bench");
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
