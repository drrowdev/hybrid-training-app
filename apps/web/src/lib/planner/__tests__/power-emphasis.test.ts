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
      weekContext: FLOOR_SATISFIED,
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
      weekContext: FLOOR_SATISFIED,
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
      weekContext: FLOOR_SATISFIED,
      filters: EMPTY_FILTERS,
      perMuscleTargets: { side_delts: 6, triceps: 6, biceps: 6, calves: 6, hamstrings: 6 },
      maxItems: 4,
    });
    const withPower = pickAccessoriesForSession({
      profile: STRENGTH_PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekContext: FLOOR_SATISFIED,
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
      weekContext: FLOOR_SATISFIED,
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
      weekContext: FLOOR_SATISFIED,
      filters: { ...EMPTY_FILTERS, blockedRegions: new Set(["knee", "hamstring_posterior"]) },
      perMuscleTargets: { side_delts: 6 },
      maxItems: 4,
      powerEmphasis: true,
    });
    expect(picks.some((p) => p.reason === "power")).toBe(false);
  });
});
