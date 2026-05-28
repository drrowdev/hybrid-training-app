import { describe, it, expect } from "vitest";
import { pickAccessoriesForSession, type CatalogMovement } from "../accessory-picker";
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

const CATALOG: CatalogMovement[] = [
  // Bulletproof items
  mv({ id: "iso1", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "iso2", slug: "spanish-squat-hold", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "hsr1", slug: "tempo-rdl", bulletproofRoles: ["hsr"], primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"] }),
  mv({ id: "hsr2", slug: "tempo-calf", bulletproofRoles: ["hsr"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "plyo1", slug: "pogo-hops", bulletproofRoles: ["plyometric_low"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "carry1", slug: "farmer-carry", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryRegion: "lumbar_trunk", primaryMuscles: ["forearms", "traps", "abs"] }),
  mv({ id: "carry2", slug: "suitcase-carry", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryRegion: "lumbar_trunk", primaryMuscles: ["obliques", "forearms"] }),
  // Functional items
  mv({ id: "sl1", slug: "bulgarian-split-squat", functionalRoles: ["single_leg"], primaryRegion: "knee", primaryMuscles: ["quads", "glutes"] }),
  mv({ id: "sl2", slug: "step-up", functionalRoles: ["single_leg"], isSupported: true, primaryRegion: "knee", primaryMuscles: ["quads", "glutes"] }),
  mv({ id: "pallof", slug: "pallof-press", functionalRoles: ["anti_rotation"], primaryRegion: "lumbar_trunk", primaryMuscles: ["obliques", "abs"] }),
  // Aesthetic-only items
  mv({ id: "lr1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "lr2", slug: "cable-lateral-raise", isSupported: true, primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "tri1", slug: "rope-pushdown", isSupported: true, primaryMuscles: ["triceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
];

const STRENGTH_PROFILE: AccessoryProfile = {
  aesthetic: {
    itemsPerSession: 3,
    setsPerItem: 3,
    repRange: { min: 10, max: 15 },
    biasSupported: false,
  },
  // carry stays in the durability floor (DC-O4 ≥ 2/wk for every archetype),
  // so functional only carries genuinely-functional-only roles.
  functional: { weeklyRoleRequirements: { single_leg: 1 } },
  durability: { extras: [] },
};

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

describe("pickAccessoriesForSession — durability deficit first", () => {
  it("fills durability roles before functional or aesthetic when week is empty", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, triceps: 6 },
      maxItems: 4,
    });
    // DC-O4 floor requires heavy_isometric ≥1, hsr ≥1, plyo ≥1, carry ≥2
    // First 4 picks should all be "durability".
    expect(picks.length).toBe(4);
    expect(picks.every((p) => p.reason === "durability")).toBe(true);
  });

  it("does not duplicate durability picks beyond the floor", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: [
        { movementId: "iso1", bulletproofRoles: ["heavy_isometric"], functionalRoles: [], primaryMuscles: ["quads"] },
        { movementId: "hsr1", bulletproofRoles: ["hsr"], functionalRoles: [], primaryMuscles: ["hamstrings"] },
        { movementId: "plyo1", bulletproofRoles: ["plyometric_low"], functionalRoles: [], primaryMuscles: ["calves"] },
        { movementId: "carry1", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: ["forearms"] },
        { movementId: "carry2", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: ["obliques"] },
      ],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, triceps: 6 },
      maxItems: 4,
    });
    // Floor is satisfied — should pick functional (single_leg) + aesthetic.
    expect(picks.some((p) => p.reason === "durability")).toBe(false);
  });

  it("suppresses plyometric when tendinopathyActive flag is true", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: [],
      filters: { ...EMPTY_FILTERS, tendinopathyActive: true },
      perMuscleTargets: { side_delts: 6 },
      maxItems: 10,
    });
    // Should never pick a plyometric movement.
    expect(picks.some((p) => p.slug === "pogo-hops")).toBe(false);
  });
});

describe("pickAccessoriesForSession — functional deficit second", () => {
  it("fills functional role requirements after durability is met", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: [
        { movementId: "iso1", bulletproofRoles: ["heavy_isometric"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "hsr1", bulletproofRoles: ["hsr"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "plyo1", bulletproofRoles: ["plyometric_low"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "carry1", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
        { movementId: "carry2", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
      ],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6 },
      maxItems: 1,
    });
    expect(picks).toHaveLength(1);
    expect(picks[0]?.reason).toBe("functional");
    expect(["bulgarian-split-squat", "step-up"]).toContain(picks[0]?.slug);
  });
});

describe("pickAccessoriesForSession — aesthetic gap-fill third", () => {
  it("picks the muscle with the largest gap first", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      // Durability + functional already met.
      weekContext: [
        { movementId: "iso1", bulletproofRoles: ["heavy_isometric"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "hsr1", bulletproofRoles: ["hsr"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "plyo1", bulletproofRoles: ["plyometric_low"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "carry1", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
        { movementId: "carry2", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
        { movementId: "sl1", bulletproofRoles: [], functionalRoles: ["single_leg"], primaryMuscles: ["quads"] },
      ],
      filters: EMPTY_FILTERS,
      // Side delts has a bigger gap (6) than triceps (3).
      perMuscleTargets: { side_delts: 6, triceps: 3 },
      maxItems: 1,
    });
    expect(picks).toHaveLength(1);
    expect(picks[0]?.reason).toBe("aesthetic");
    expect(["db-lateral-raise", "cable-lateral-raise"]).toContain(picks[0]?.slug);
  });
});

describe("pickAccessoriesForSession — filters", () => {
  it("excludes movements loading blocked regions", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: [],
      filters: { ...EMPTY_FILTERS, blockedRegions: new Set(["knee"]) },
      perMuscleTargets: { side_delts: 6 },
      maxItems: 10,
    });
    // Wall sit + Spanish squat hold + step-up + Bulgarian load knee — should be excluded.
    const slugs = picks.map((p) => p.slug);
    expect(slugs).not.toContain("wall-sit");
    expect(slugs).not.toContain("spanish-squat-hold");
    expect(slugs).not.toContain("step-up");
    expect(slugs).not.toContain("bulgarian-split-squat");
  });

  it("excludes movements where a blocked muscle appears as primary OR secondary", () => {
    // A movement explicitly carrying `adductors` as a SECONDARY muscle
    // is in the catalog. With `adductors` blocked, that movement
    // should not be picked.
    const catalogPlus: CatalogMovement[] = [
      ...CATALOG,
      mv({
        id: "sec-adductor",
        slug: "back-squat-variant",
        primaryRegion: "knee",
        primaryMuscles: ["quads", "glutes"],
        secondaryMuscles: ["adductors"],
        functionalRoles: ["single_leg"],
      }),
    ];
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: catalogPlus,
      weekContext: [],
      filters: {
        ...EMPTY_FILTERS,
        blockedMuscles: new Set(["adductors"]),
      },
      perMuscleTargets: { side_delts: 6 },
      maxItems: 10,
    });
    expect(picks.map((p) => p.slug)).not.toContain("back-squat-variant");
  });

  it("allows a movement through when its id is in allowedMovementIds", () => {
    // Use a minimal catalog so the only single_leg candidate is the
    // adductor-secondary movement we want to allow-list through —
    // this isolates the filter behaviour from candidate ranking.
    const minimalCatalog: CatalogMovement[] = [
      ...CATALOG.filter((m) =>
        ["iso1", "hsr1", "plyo1", "carry1", "carry2"].includes(m.id),
      ),
      mv({
        id: "sec-adductor",
        slug: "back-squat-variant",
        primaryRegion: "knee",
        primaryMuscles: ["quads", "glutes"],
        secondaryMuscles: ["adductors"],
        functionalRoles: ["single_leg"],
      }),
    ];
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: minimalCatalog,
      weekContext: [
        // Floor met so the functional pass is eligible next.
        { movementId: "iso1", bulletproofRoles: ["heavy_isometric"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "hsr1", bulletproofRoles: ["hsr"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "plyo1", bulletproofRoles: ["plyometric_low"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "carry1", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
        { movementId: "carry2", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
      ],
      filters: {
        ...EMPTY_FILTERS,
        blockedMuscles: new Set(["adductors"]),
        allowedMovementIds: new Set(["sec-adductor"]),
      },
      perMuscleTargets: { side_delts: 6 },
      maxItems: 10,
    });
    expect(picks.map((p) => p.slug)).toContain("back-squat-variant");
  });

  it("prefers supported variants under concurrent stress when biasSupported = true", () => {
    const profile: AccessoryProfile = {
      ...STRENGTH_PROFILE,
      aesthetic: { ...STRENGTH_PROFILE.aesthetic, biasSupported: true },
    };
    const picks = pickAccessoriesForSession({
      profile,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      // Durability+ functional met → next pick is aesthetic for side_delts.
      weekContext: [
        { movementId: "iso1", bulletproofRoles: ["heavy_isometric"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "hsr1", bulletproofRoles: ["hsr"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "plyo1", bulletproofRoles: ["plyometric_low"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "carry1", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
        { movementId: "carry2", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
        { movementId: "sl1", bulletproofRoles: [], functionalRoles: ["single_leg"], primaryMuscles: [] },
      ],
      filters: { ...EMPTY_FILTERS, concurrentStressActive: true },
      perMuscleTargets: { side_delts: 6 },
      maxItems: 1,
    });
    expect(picks[0]?.slug).toBe("cable-lateral-raise"); // supported variant preferred
  });

  it("demotes recently-used movements (variation rotation)", () => {
    // Use a profile that ONLY has the heavy_isometric role unmet to isolate
    // the rotation behaviour. Other deficits would steal the first pick.
    const isoOnly: AccessoryProfile = {
      aesthetic: { itemsPerSession: 0, setsPerItem: 3, repRange: { min: 10, max: 15 }, biasSupported: false },
      functional: { weeklyRoleRequirements: {} },
      // Stack durability extras so this archetype only "needs" heavy_isometric — pre-fill the rest.
      durability: { extras: [] },
    };
    const picks = pickAccessoriesForSession({
      profile: isoOnly,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      // Pre-satisfy hsr, plyo, carry so heavy_isometric is the only remaining deficit.
      weekContext: [
        { movementId: "hsr1", bulletproofRoles: ["hsr"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "plyo1", bulletproofRoles: ["plyometric_low"], functionalRoles: [], primaryMuscles: [] },
        { movementId: "carry1", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
        { movementId: "carry2", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryMuscles: [] },
      ],
      filters: { ...EMPTY_FILTERS, recentlyUsedMovementIds: new Set(["iso1"]) },
      perMuscleTargets: {},
      maxItems: 1,
    });
    // iso1 (wall-sit) is demoted; iso2 (spanish-squat-hold) should win.
    expect(picks[0]?.slug).toBe("spanish-squat-hold");
  });
});

describe("pickAccessoriesForSession — deload scaling", () => {
  it("halves working sets when weekDeloadScale = 0.5", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 0.5,
      catalog: CATALOG,
      weekContext: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: {},
      maxItems: 1,
    });
    // setsPerItem = 3, deload = 0.5 → round(1.5) = 2.
    expect(picks[0]?.sets).toBe(2);
  });

  it("never lets sets fall below 1", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 0.1,
      catalog: CATALOG,
      weekContext: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: {},
      maxItems: 1,
    });
    expect(picks[0]?.sets).toBeGreaterThanOrEqual(1);
  });
});

describe("pickAccessoriesForSession — no hardcoded slugs in archetype config", () => {
  it("STRENGTH_PROFILE contains no movement slug strings (the audit rule)", () => {
    const json = JSON.stringify(STRENGTH_PROFILE);
    // Slug pattern: lowercase letters + digits + dashes, ≥3 chars total.
    // None of these should appear in a serialized AccessoryProfile.
    const candidateSlugs = [
      "bulgarian", "farmer", "suitcase", "wall-sit", "pallof", "lateral-raise",
      "tempo-rdl", "spanish-squat", "pogo", "step-up", "rope-pushdown",
    ];
    for (const slug of candidateSlugs) {
      expect(json.toLowerCase()).not.toContain(slug);
    }
  });
});
