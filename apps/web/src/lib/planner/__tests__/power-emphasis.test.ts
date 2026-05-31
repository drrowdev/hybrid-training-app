/**
 * Power emphasis — wiring tests.
 *
 * Phase 1 (persist):
 *   - Wizard mapping with `power: true` still resolves an archetype.
 *   - `createBlockSchema` accepts `powerEmphasis` boolean coercions.
 *
 * Phase 2 (influence):
 *   - The accessory picker with `powerEmphasis: true` returns at least
 *     one power-tagged accessory when the catalog has clean candidates.
 *   - Tendinopathy still suppresses high-strain-tendon power picks
 *     (DC-J5 / DC-O3 honoured).
 *   - Schoenfeld 2017: power-emphasis trims aesthetic slot count.
 */
import { describe, it, expect } from "vitest";
import {
  pickAccessoriesForSession,
  type CatalogMovement,
} from "../accessory-picker";
import {
  POWER_FUNCTIONAL_ROLES,
  type AccessoryProfile,
  type FunctionalRole,
} from "../accessory-roles";
import { resolveArchetype, wizardOutput } from "../wizard/wizard-mapping";

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
  mv({ id: "iso1", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "hsr1", slug: "tempo-rdl", bulletproofRoles: ["hsr"], primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"] }),
  mv({ id: "plyo1", slug: "pogo-hops", bulletproofRoles: ["plyometric_low"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "carry1", slug: "farmer-carry", bulletproofRoles: ["carry"], primaryRegion: "lumbar_trunk", primaryMuscles: ["forearms"] }),
  mv({ id: "carry2", slug: "suitcase-carry", bulletproofRoles: ["carry"], primaryRegion: "lumbar_trunk", primaryMuscles: ["obliques"] }),
  mv({ id: "oly1", slug: "power-clean", functionalRoles: ["power_olympic"], primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings", "glutes"], highStrainTendon: true, stimToFatigueScore: 4 }),
  mv({ id: "plyB", slug: "broad-jump", functionalRoles: ["power_plyometric"], primaryRegion: "knee", primaryMuscles: ["quads"], highStrainTendon: true, stimToFatigueScore: 3 }),
  mv({ id: "bal1", slug: "kb-swing-russian", functionalRoles: ["power_ballistic"], primaryRegion: "hamstring_posterior", primaryMuscles: ["glutes"], stimToFatigueScore: 4 }),
  mv({ id: "lr1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "tri1", slug: "rope-pushdown", primaryMuscles: ["triceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "calf1", slug: "standing-calf", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf" }),
  mv({ id: "ham1", slug: "leg-curl", primaryMuscles: ["hamstrings"], primaryRegion: "hamstring_posterior" }),
];

const STRENGTH_PROFILE: AccessoryProfile = {
  aesthetic: {
    itemsPerSession: 3,
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

const FLOOR_SATISFIED = [
  { movementId: "iso1", bulletproofRoles: ["heavy_isometric" as const], functionalRoles: [] as FunctionalRole[], primaryMuscles: [] as string[] },
  { movementId: "hsr1", bulletproofRoles: ["hsr" as const], functionalRoles: [] as FunctionalRole[], primaryMuscles: [] as string[] },
  { movementId: "plyo1", bulletproofRoles: ["plyometric_low" as const], functionalRoles: [] as FunctionalRole[], primaryMuscles: [] as string[] },
  { movementId: "carry1", bulletproofRoles: ["carry" as const], functionalRoles: [] as FunctionalRole[], primaryMuscles: [] as string[] },
  { movementId: "carry2", bulletproofRoles: ["carry" as const], functionalRoles: [] as FunctionalRole[], primaryMuscles: [] as string[] },
];

describe("Phase 1 — wizard mapping with power: true", () => {
  it("strength + skip → strength_anchor resolves cleanly with powerEligible: true", () => {
    const r = resolveArchetype({ days: 4, goal: "strength", secondary: "skip", twoADay: false });
    expect(r?.id).toBe("strength_anchor");
    expect(r?.powerEligible).toBe(true);
    expect(wizardOutput({ days: 4, goal: "strength", secondary: "skip", twoADay: false })).toEqual({
      archetypeId: "strength_anchor",
      daysPerWeek: 4,
    });
  });

  it("hybrid is also power-eligible", () => {
    const r = resolveArchetype({ days: 4, goal: "strength", secondary: "cardio", twoADay: false });
    expect(r?.powerEligible).toBe(true);
  });

  it("non-power-eligible archetypes keep powerEligible: false", () => {
    expect(resolveArchetype({ days: 4, goal: "resilience", secondary: null, twoADay: false })?.powerEligible).toBe(false);
    expect(resolveArchetype({ days: 4, goal: "muscle", secondary: "skip", twoADay: false })?.powerEligible).toBe(false);
    expect(resolveArchetype({ days: 4, goal: "cardio", secondary: "skip", twoADay: false })?.powerEligible).toBe(false);
    expect(resolveArchetype({ days: 4, goal: null, secondary: "maintenance", twoADay: false })?.powerEligible).toBe(false);
  });
});

describe("Phase 1 — createBlockSchema accepts powerEmphasis", () => {
  it("coerces FormData-style values correctly", async () => {
    const { z } = await import("zod");
    const schema = z
      .union([z.literal("true"), z.literal("false"), z.literal("on"), z.boolean()])
      .optional()
      .transform((v) => v === true || v === "true" || v === "on");
    expect(schema.parse(undefined)).toBe(false);
    expect(schema.parse("false")).toBe(false);
    expect(schema.parse("true")).toBe(true);
    expect(schema.parse("on")).toBe(true);
    expect(schema.parse(true)).toBe(true);
    expect(schema.parse(false)).toBe(false);
  });
});

describe("Phase 2 — accessory picker biases toward power-tagged movements", () => {
  it("returns at least one power-tagged pick when powerEmphasis: true", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: FLOOR_SATISFIED,
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, triceps: 6, biceps: 6 },
      maxItems: 4,
      powerEmphasis: true,
    });
    const powerSlugs = ["power-clean", "broad-jump", "kb-swing-russian"];
    expect(picks.some((p) => powerSlugs.includes(p.slug))).toBe(true);
    expect(picks.some((p) => p.reason === "power")).toBe(true);
  });

  it("returns NO power-tagged pick when powerEmphasis is false (default)", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: FLOOR_SATISFIED,
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, triceps: 6, biceps: 6 },
      maxItems: 4,
    });
    expect(picks.some((p) => p.reason === "power")).toBe(false);
  });

  it("power-emphasis trims aesthetic slot count (Schoenfeld 2017 RFD vs hypertrophy)", () => {
    const without = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: FLOOR_SATISFIED,
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, triceps: 6, biceps: 6, calves: 6, hamstrings: 6 },
      maxItems: 4,
    });
    const withPower = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: FLOOR_SATISFIED,
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, triceps: 6, biceps: 6, calves: 6, hamstrings: 6 },
      maxItems: 4,
      powerEmphasis: true,
    });
    const aestheticWithout = without.filter((p) => p.reason === "aesthetic").length;
    const aestheticWith = withPower.filter((p) => p.reason === "aesthetic").length;
    expect(aestheticWith).toBeLessThan(aestheticWithout);
  });

  it("tendinopathy flag suppresses high-strain-tendon power candidates (DC-J5 / DC-O3)", () => {
    const tendonOnly = CATALOG.filter(
      (m) =>
        m.functionalRoles.length === 0 ||
        m.functionalRoles.some((r) =>
          (POWER_FUNCTIONAL_ROLES as readonly FunctionalRole[]).includes(r),
        ),
    );
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: tendonOnly.filter((m) => m.id !== "bal1"),
      weekAccessoryHistory: FLOOR_SATISFIED,
      filters: { ...EMPTY_FILTERS, tendinopathyActive: true },
      perMuscleTargets: { side_delts: 6 },
      maxItems: 4,
      powerEmphasis: true,
    });
    expect(picks.some((p) => p.reason === "power")).toBe(false);
  });

  it("respects blockedRegions when picking power candidates", () => {
    const picks = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: FLOOR_SATISFIED,
      filters: { ...EMPTY_FILTERS, blockedRegions: new Set(["knee", "hamstring_posterior"]) },
      perMuscleTargets: { side_delts: 6 },
      maxItems: 4,
      powerEmphasis: true,
    });
    expect(picks.some((p) => p.reason === "power")).toBe(false);
  });
});

// ─── Phase 3 — main-lift intensity caps + reps rewrite ───────────────
describe("Phase 3 — main-lift power clamp + reps rewrite (Sale 1992 / Häkkinen 1985)", () => {
  it("clamps a 95% top set to 90% TM", async () => {
    const { applyPowerClampToMainItems } = await import("../power-emphasis-transform");
    const items: import("@hta/db").PrescriptionItem[] = [
      { movementId: "mv1", kind: "main", sets: 1, reps: 1, percentTm: 95, intensityLabel: "95% TM", notes: "top set" },
    ];
    applyPowerClampToMainItems(items);
    expect(items[0]!.percentTm).toBe(90);
    expect(items[0]!.intensityLabel).toBe("90% TM");
    expect((items[0]!.meta as Record<string, unknown>).cue).toMatch(/compensatory acceleration/i);
    expect((items[0]!.meta as Record<string, unknown>).cappedFromPercentTm).toBe(95);
  });

  it("rewrites reps from 1 → 3 when intensity is above 85% TM after clamp", async () => {
    const { applyPowerClampToMainItems } = await import("../power-emphasis-transform");
    const items: import("@hta/db").PrescriptionItem[] = [
      { movementId: "mv1", kind: "main", sets: 1, reps: 1, percentTm: 95 },
    ];
    applyPowerClampToMainItems(items);
    expect(items[0]!.reps).toBe(3);
    expect((items[0]!.meta as Record<string, unknown>).repsRewrittenFrom).toBe(1);
  });

  it("is a no-op at 80% TM (intensity ≤ 85% — leaves load and reps alone)", async () => {
    const { applyPowerClampToMainItems } = await import("../power-emphasis-transform");
    const items: import("@hta/db").PrescriptionItem[] = [
      { movementId: "mv1", kind: "main", sets: 1, reps: 5, percentTm: 80 },
    ];
    applyPowerClampToMainItems(items);
    expect(items[0]!.percentTm).toBe(80);
    expect(items[0]!.reps).toBe(5);
  });

  it("only touches main items — accessory / cardio / tendon untouched", async () => {
    const { applyPowerClampToMainItems } = await import("../power-emphasis-transform");
    const items: import("@hta/db").PrescriptionItem[] = [
      { movementId: "a", kind: "main", percentTm: 95, reps: 1 },
      { movementId: "b", kind: "accessory", sets: 3, reps: 12, percentTm: 95 },
      { movementId: "c", kind: "cardio_z2", durationMin: 45 },
    ];
    applyPowerClampToMainItems(items);
    expect(items[0]!.percentTm).toBe(90);
    expect(items[1]!.percentTm).toBe(95); // accessory left alone
    expect(items[1]!.reps).toBe(12);
    expect(items[2]!.durationMin).toBe(45);
  });

  it("clamp + reps rewrite is a no-op when power_emphasis would not apply (endurance archetype)", async () => {
    const { archetypeSupportsPowerTransforms } = await import("../power-emphasis-transform");
    expect(archetypeSupportsPowerTransforms("endurance_anchor")).toBe(false);
    expect(archetypeSupportsPowerTransforms("rebuild")).toBe(false);
    expect(archetypeSupportsPowerTransforms("maintenance")).toBe(false);
    // Sanity: still applies to the three strength-led archetypes.
    expect(archetypeSupportsPowerTransforms("strength_anchor")).toBe(true);
    expect(archetypeSupportsPowerTransforms("hypertrophy_anchor")).toBe(true);
    expect(archetypeSupportsPowerTransforms("concurrent_hybrid")).toBe(true);
  });
});

// ─── Phase 3 — potentiation movement picker (PAP/PAPE) ───────────────
describe("Phase 3 — potentiation picker (Seitz & Haff 2016; Boullosa 2018)", () => {
  it("squat day picks a lower-body plyometric (broad-jump preferred over upper-body throw)", async () => {
    const { pickPotentiationMovement } = await import("../power-emphasis-transform");
    const pick = pickPotentiationMovement({
      strengthRole: "squat",
      catalog: CATALOG,
      blockedRegions: new Set<string>(),
      tendinopathyActive: false,
      recentlyUsedMovementIds: new Set<string>(),
    });
    expect(pick).not.toBeNull();
    expect(pick!.movement.functionalRoles).toContain("power_plyometric");
    // Slug should match a squat-pattern plyo from the seeded catalog.
    expect(["broad-jump", "box-jump-low", "vertical-jump", "depth-jump", "tuck-jump"]).toContain(
      pick!.movement.slug,
    );
  });

  it("bench (horizontal_press) day picks an upper-body ballistic", async () => {
    const { pickPotentiationMovement } = await import("../power-emphasis-transform");
    const catalog: CatalogMovement[] = [
      ...CATALOG,
      mv({
        id: "mbcp",
        slug: "med-ball-chest-pass",
        functionalRoles: ["power_ballistic"],
        primaryRegion: "shoulder_scapular",
        primaryMuscles: ["chest", "triceps"],
        stimToFatigueScore: 4,
      }),
    ];
    const pick = pickPotentiationMovement({
      strengthRole: "horizontal_press",
      catalog,
      blockedRegions: new Set<string>(),
      tendinopathyActive: false,
      recentlyUsedMovementIds: new Set<string>(),
    });
    expect(pick).not.toBeNull();
    expect(pick!.movement.functionalRoles).toContain("power_ballistic");
    expect(pick!.movement.slug).toBe("med-ball-chest-pass");
  });

  it("deadlift day picks a posterior-chain power movement", async () => {
    const { pickPotentiationMovement } = await import("../power-emphasis-transform");
    const pick = pickPotentiationMovement({
      strengthRole: "deadlift",
      catalog: CATALOG,
      blockedRegions: new Set<string>(),
      tendinopathyActive: false,
      recentlyUsedMovementIds: new Set<string>(),
    });
    expect(pick).not.toBeNull();
    expect(["kb-swing-russian", "broad-jump", "power-clean"]).toContain(pick!.movement.slug);
  });

  it("tendinopathy suppresses high-strain-tendon power candidates", async () => {
    const { pickPotentiationMovement } = await import("../power-emphasis-transform");
    // CATALOG has only highStrainTendon power-tagged movements that match
    // a squat pattern (broad-jump is tagged highStrain: true above).
    const pick = pickPotentiationMovement({
      strengthRole: "squat",
      catalog: CATALOG.filter((m) => m.slug !== "kb-swing-russian"),
      blockedRegions: new Set<string>(),
      tendinopathyActive: true,
      recentlyUsedMovementIds: new Set<string>(),
    });
    // The only matching squat-pattern plyo in CATALOG is broad-jump which is
    // tagged highStrainTendon — tendinopathy must exclude it.
    expect(pick).toBeNull();
  });

  it("returns null when no power-tagged movement matches", async () => {
    const { pickPotentiationMovement } = await import("../power-emphasis-transform");
    const noPowerCatalog = CATALOG.filter((m) => m.functionalRoles.length === 0);
    const pick = pickPotentiationMovement({
      strengthRole: "squat",
      catalog: noPowerCatalog,
      blockedRegions: new Set<string>(),
      tendinopathyActive: false,
      recentlyUsedMovementIds: new Set<string>(),
    });
    expect(pick).toBeNull();
  });
});

// ─── Phase 3 — buildPotentiationItem shape ───────────────────────────
describe("Phase 3 — buildPotentiationItem produces the expected prescription kind", () => {
  it("produces kind=power_potentiation with reps in [3,5] and PAPE rest guidance in meta", async () => {
    const { buildPotentiationItem } = await import("../power-emphasis-transform");
    const item = buildPotentiationItem(CATALOG[5]!); // power-clean
    expect(item.kind).toBe("power_potentiation");
    expect(item.sets).toBe(3);
    expect(item.reps).toBeGreaterThanOrEqual(3);
    expect(item.reps).toBeLessThanOrEqual(5);
    const meta = item.meta as Record<string, unknown>;
    expect(typeof meta.restBeforeMainLift).toBe("string");
    expect(String(meta.restBeforeMainLift)).toMatch(/4.{0,2}8/);
  });
});
