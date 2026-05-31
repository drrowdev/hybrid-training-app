/**
 * Golden-master pin for `assemblePrescriptionItems` — the day-level
 * prescription assembler extracted from the `"use server"` planner actions.
 *
 * Before this file the assembler had ZERO direct test coverage: the only
 * paths that exercised it (`createBlock` / `createCustomBlock`) need a live
 * Supabase client, so the orchestration of main lifts + warmups + power
 * primer + accessories was effectively untested. This snapshots the full
 * ordered `PrescriptionItem[]` across a matrix of realistic inputs so any
 * future change to the assembler — or to a leaf it calls (buildPrescription,
 * the accessory picker, warmups, power transforms) — has to consciously
 * re-bless the diff.
 *
 * The inputs mirror exactly what `createBlock` passes (see actions.ts:877+):
 *   - weekDeloadScale = weekProfile.strengthVolumeScale ?? 1.0
 *   - weekAccessoryHistory is a fresh [] per week, mutated in place by the assembler
 *   - catalog/weekAccessoryHistory present => dynamic picker; absent => legacy pools
 *
 * This is a behavioural pin, NOT an assertion of desired behaviour. If a
 * change is intentional, regenerate with `-u` and review the snapshot diff.
 */
import { describe, it, expect } from "vitest";
import {
  STRENGTH_ANCHOR,
  ENDURANCE_ANCHOR,
  REBUILD,
  HYPERTROPHY_ANCHOR,
  CONCURRENT_HYBRID,
  MAINTENANCE,
  type Archetype,
  type DayTemplate,
  type StrengthDay,
} from "../archetypes";
import { assemblePrescriptionItems } from "../assemble-prescription";
import { ACCESSORY_POOLS } from "../accessories";
import type { CatalogMovement, WeekAccessoryHistoryItem } from "../accessory-picker";
import type { DeclaredExperience } from "@hta/engine";

type Mv = { id: string; slug: string; displayName: string };

const PRIMARY: Mv = {
  id: "mv-primary",
  slug: "back-squat-high-bar",
  displayName: "Back Squat (High Bar)",
};
const SECONDARY: Mv = {
  id: "mv-secondary",
  slug: "overhead-press",
  displayName: "Overhead Press",
};

// ─── Synthetic accessory catalog (mirrors the shape loadPickerCatalog
// returns; reused from accessory-picker.test.ts so the dynamic picker has
// real candidates to choose from across all role buckets). ───
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
  };
}

const CATALOG: CatalogMovement[] = [
  mv({ id: "iso1", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "iso2", slug: "spanish-squat-hold", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "hsr1", slug: "tempo-rdl", bulletproofRoles: ["hsr"], primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"] }),
  mv({ id: "hsr2", slug: "tempo-calf", bulletproofRoles: ["hsr"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "plyo1", slug: "pogo-hops", bulletproofRoles: ["plyometric_low"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "carry1", slug: "farmer-carry", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryRegion: "lumbar_trunk", primaryMuscles: ["forearms", "traps", "abs"] }),
  mv({ id: "carry2", slug: "suitcase-carry", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryRegion: "lumbar_trunk", primaryMuscles: ["obliques", "forearms"] }),
  mv({ id: "sl1", slug: "bulgarian-split-squat", functionalRoles: ["single_leg"], primaryRegion: "knee", primaryMuscles: ["quads", "glutes"] }),
  mv({ id: "sl2", slug: "step-up", functionalRoles: ["single_leg"], isSupported: true, primaryRegion: "knee", primaryMuscles: ["quads", "glutes"] }),
  mv({ id: "pallof", slug: "pallof-press", functionalRoles: ["anti_rotation"], primaryRegion: "lumbar_trunk", primaryMuscles: ["obliques", "abs"] }),
  mv({ id: "lr1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "lr2", slug: "cable-lateral-raise", isSupported: true, primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "tri1", slug: "rope-pushdown", isSupported: true, primaryMuscles: ["triceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
];

// Power scenario only: a plyometric power movement that matches the squat
// role's PATTERN_HINTS so `pickPotentiationMovement` returns a PAPE primer.
// Kept separate from CATALOG so the non-power snapshots are unaffected.
const POWER_CATALOG: CatalogMovement[] = [
  ...CATALOG,
  mv({
    id: "pwr1",
    slug: "box-jump",
    functionalRoles: ["power_plyometric"],
    primaryRegion: "knee",
    primaryMuscles: ["quads", "glutes"],
  }),
];

// Legacy-pool path needs a slug -> movement-row resolver. Build one that
// covers every slug in every static pool so the fallback loop actually
// emits items.
function legacyMovementBySlug(): Map<
  string,
  { id: string; slug: string; display_name: string }
> {
  const map = new Map<string, { id: string; slug: string; display_name: string }>();
  for (const pool of Object.values(ACCESSORY_POOLS)) {
    for (const a of pool as ReadonlyArray<{ slug: string }>) {
      if (!map.has(a.slug)) {
        map.set(a.slug, { id: `leg-${a.slug}`, slug: a.slug, display_name: a.slug });
      }
    }
  }
  return map;
}

function firstStrengthDay(a: Archetype): StrengthDay {
  return a.days.find((d): d is StrengthDay => d.kind === "strength")!;
}

function firstNonStrengthDay(a: Archetype): DayTemplate {
  return a.days.find((d) => d.kind !== "strength")! as DayTemplate;
}

function deloadWeekIndex(a: Archetype): number {
  return (
    a.weekProfiles.find((w) => w.intensityLabel === "Deload")?.weekIndex ??
    a.weeks - 1
  );
}

function deloadScaleFor(a: Archetype, week: number): number {
  return a.weekProfiles.find((w) => w.weekIndex === week)?.strengthVolumeScale ?? 1.0;
}

/** Thin wrapper that maps named options to the assembler's positional
 *  signature so each scenario reads clearly and uses the same defaults the
 *  real caller does. */
function assemble(o: {
  archetype: Archetype;
  weekIndex: number;
  day: DayTemplate;
  movement?: Mv;
  finisher?: Mv;
  movementBySlug?: Map<string, { id: string; slug: string; display_name: string }>;
  catalog?: CatalogMovement[];
  weekAccessoryHistory?: WeekAccessoryHistoryItem[];
  weekDeloadScale?: number;
  powerEmphasis?: boolean;
  omitMainStrength?: boolean;
  experience?: DeclaredExperience | null;
  secondaryMovement?: Mv;
}) {
  return assemblePrescriptionItems(
    o.archetype,
    o.weekIndex,
    o.day,
    o.movement ?? PRIMARY,
    o.finisher,
    o.movementBySlug ?? new Map(),
    o.catalog,
    o.weekAccessoryHistory,
    o.weekDeloadScale ?? 1.0,
    o.powerEmphasis ?? false,
    undefined, // warmupScheme -> DEFAULT_WARMUP_SCHEME
    undefined, // equipment
    o.omitMainStrength ?? false,
    o.experience ?? null,
    undefined, // limitationsContext -> no-limitations default
    o.secondaryMovement,
    [], // focusMuscles
    1.0, // elbowForearmAtlRatio
    new Set(), // recentlyUsedAccessoryIds
  );
}

describe("assemblePrescriptionItems — golden master", () => {
  it("strength_anchor: week 0, dynamic picker", () => {
    expect(
      assemble({
        archetype: STRENGTH_ANCHOR,
        weekIndex: 0,
        day: firstStrengthDay(STRENGTH_ANCHOR),
        catalog: CATALOG,
        weekAccessoryHistory: [],
      }),
    ).toMatchSnapshot();
  });

  it("strength_anchor: week 2 (heavy peak), power emphasis on (clamp + PAP primer)", () => {
    expect(
      assemble({
        archetype: STRENGTH_ANCHOR,
        weekIndex: 2,
        day: firstStrengthDay(STRENGTH_ANCHOR),
        catalog: POWER_CATALOG,
        weekAccessoryHistory: [],
        powerEmphasis: true,
      }),
    ).toMatchSnapshot();
  });

  it("strength_anchor: deload week, dynamic picker", () => {
    const w = deloadWeekIndex(STRENGTH_ANCHOR);
    expect(
      assemble({
        archetype: STRENGTH_ANCHOR,
        weekIndex: w,
        day: firstStrengthDay(STRENGTH_ANCHOR),
        catalog: CATALOG,
        weekAccessoryHistory: [],
        weekDeloadScale: deloadScaleFor(STRENGTH_ANCHOR, w),
      }),
    ).toMatchSnapshot();
  });

  it("strength_anchor: legacy static-pool fallback (no catalog/weekAccessoryHistory)", () => {
    expect(
      assemble({
        archetype: STRENGTH_ANCHOR,
        weekIndex: 0,
        day: firstStrengthDay(STRENGTH_ANCHOR),
        movementBySlug: legacyMovementBySlug(),
      }),
    ).toMatchSnapshot();
  });

  it("strength_anchor: omitMainStrength (bodyweight / no-TM path)", () => {
    expect(
      assemble({
        archetype: STRENGTH_ANCHOR,
        weekIndex: 0,
        day: firstStrengthDay(STRENGTH_ANCHOR),
        catalog: CATALOG,
        weekAccessoryHistory: [],
        omitMainStrength: true,
      }),
    ).toMatchSnapshot();
  });

  it("hypertrophy_anchor: week 0, dynamic picker (effort-anchored final set)", () => {
    expect(
      assemble({
        archetype: HYPERTROPHY_ANCHOR,
        weekIndex: 0,
        day: firstStrengthDay(HYPERTROPHY_ANCHOR),
        catalog: CATALOG,
        weekAccessoryHistory: [],
      }),
    ).toMatchSnapshot();
  });

  it("hypertrophy_anchor: week 1, folded dual-main-lift secondary", () => {
    const base = firstStrengthDay(HYPERTROPHY_ANCHOR);
    const dayWithSecondary: StrengthDay = {
      ...base,
      secondaryRole: "vertical_press",
      secondaryMaxSets: HYPERTROPHY_ANCHOR.foldedSecondaryMaxSets ?? 4,
    };
    expect(
      assemble({
        archetype: HYPERTROPHY_ANCHOR,
        weekIndex: 1,
        day: dayWithSecondary,
        catalog: CATALOG,
        weekAccessoryHistory: [],
        secondaryMovement: SECONDARY,
      }),
    ).toMatchSnapshot();
  });

  it("hypertrophy_anchor: week 0, declared beginner (onboarding ramp compresses accessory volume)", () => {
    expect(
      assemble({
        archetype: HYPERTROPHY_ANCHOR,
        weekIndex: 0,
        day: firstStrengthDay(HYPERTROPHY_ANCHOR),
        catalog: CATALOG,
        weekAccessoryHistory: [],
        experience: "beginner_lt_6m",
      }),
    ).toMatchSnapshot();
  });

  it("concurrent_hybrid: week 0, dynamic picker", () => {
    expect(
      assemble({
        archetype: CONCURRENT_HYBRID,
        weekIndex: 0,
        day: firstStrengthDay(CONCURRENT_HYBRID),
        catalog: CATALOG,
        weekAccessoryHistory: [],
      }),
    ).toMatchSnapshot();
  });

  it("rebuild: week 0, dynamic picker", () => {
    expect(
      assemble({
        archetype: REBUILD,
        weekIndex: 0,
        day: firstStrengthDay(REBUILD),
        catalog: CATALOG,
        weekAccessoryHistory: [],
      }),
    ).toMatchSnapshot();
  });

  it("maintenance: week 0, dynamic picker", () => {
    expect(
      assemble({
        archetype: MAINTENANCE,
        weekIndex: 0,
        day: firstStrengthDay(MAINTENANCE),
        catalog: CATALOG,
        weekAccessoryHistory: [],
      }),
    ).toMatchSnapshot();
  });

  it("endurance_anchor: non-strength (cardio) day returns buildPrescription items unchanged", () => {
    expect(
      assemble({
        archetype: ENDURANCE_ANCHOR,
        weekIndex: 0,
        day: firstNonStrengthDay(ENDURANCE_ANCHOR),
        catalog: CATALOG,
        weekAccessoryHistory: [],
      }),
    ).toMatchSnapshot();
  });
});
