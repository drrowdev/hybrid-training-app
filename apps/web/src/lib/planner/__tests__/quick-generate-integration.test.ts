/**
 * Integration coverage for `assembleQuickStrengthItems` — drives the freshness
 * mask + duration trim through the REAL prescription assembler (not a mock), so
 * the wiring (week selection, mask threading, accessory trim) is pinned.
 */
import { describe, it, expect } from "vitest";
import { STRENGTH_ANCHOR, type StrengthDay } from "../archetypes";
import type { CatalogMovement } from "../accessory-picker";
import {
  assembleQuickStrengthItems,
  type QuickAssembleParams,
} from "../quick-generate";
import type { MuscleGroup } from "@/lib/muscle/muscle-groups";
import type { MuscleFreshnessBand } from "@/lib/muscle/muscle-freshness";

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
  mv({ id: "sl1", slug: "bulgarian-split-squat", functionalRoles: ["single_leg"], primaryRegion: "knee", primaryMuscles: ["quads", "glutes"] }),
  mv({ id: "lr1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "lr2", slug: "cable-lateral-raise", isSupported: true, primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "tri1", slug: "rope-pushdown", isSupported: true, primaryMuscles: ["triceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "rd1", slug: "rear-delt-fly", primaryMuscles: ["rear_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "lat1", slug: "lat-pulldown", isSupported: true, primaryMuscles: ["lats"], primaryRegion: "shoulder_scapular" }),
];

const MAIN = { id: "mv-squat", slug: "back-squat-high-bar", displayName: "Back Squat" };

const squatDay = (): StrengthDay =>
  STRENGTH_ANCHOR.days.find(
    (d): d is StrengthDay => d.kind === "strength" && d.role === "squat",
  )!;

function bands(
  entries: Partial<Record<MuscleGroup, MuscleFreshnessBand>>,
): Map<MuscleGroup, MuscleFreshnessBand> {
  return new Map(Object.entries(entries) as [MuscleGroup, MuscleFreshnessBand][]);
}

function baseParams(
  over: Partial<QuickAssembleParams> = {},
): QuickAssembleParams {
  return {
    archetype: STRENGTH_ANCHOR,
    day: squatDay(),
    movement: MAIN,
    movementBySlug: new Map([
      [MAIN.slug, { id: MAIN.id, slug: MAIN.slug, display_name: MAIN.displayName }],
    ]),
    catalog: CATALOG,
    omitMainStrength: false,
    experience: null,
    freshnessByGroup: bands({}),
    length: "normal",
    ...over,
  };
}

describe("assembleQuickStrengthItems — integration", () => {
  it("builds a main lift on the chosen pattern with a %TM target", () => {
    const items = assembleQuickStrengthItems(baseParams());
    const main = items.find((i) => i.kind === "main");
    expect(main).toBeDefined();
    expect(main!.movementId).toBe(MAIN.id);
    expect(typeof main!.percentTm).toBe("number");
  });

  it("a short session never has more items than a normal one (duration trim)", () => {
    const normal = assembleQuickStrengthItems(baseParams({ length: "normal" }));
    const short = assembleQuickStrengthItems(baseParams({ length: "short" }));
    expect(short.length).toBeLessThanOrEqual(normal.length);
    // Both keep the main lift.
    expect(short.some((i) => i.kind === "main")).toBe(true);
    expect(normal.some((i) => i.kind === "main")).toBe(true);
  });

  it("omitMainStrength drops the main lift but still returns accessories", () => {
    const items = assembleQuickStrengthItems(
      baseParams({ omitMainStrength: true }),
    );
    expect(items.some((i) => i.kind === "main")).toBe(false);
    expect(items.some((i) => i.kind === "accessory")).toBe(true);
  });

  it("never throws when every aesthetic muscle is freshness-masked to loaded", () => {
    const items = assembleQuickStrengthItems(
      baseParams({
        freshnessByGroup: bands({
          shoulders: "loaded",
          biceps: "loaded",
          triceps: "loaded",
          lats: "loaded",
          back: "loaded",
        }),
      }),
    );
    // The main lift still lands; the mask only biases the accessory gap-fill.
    expect(items.some((i) => i.kind === "main")).toBe(true);
  });

  it("every item carries a movement id and name", () => {
    const items = assembleQuickStrengthItems(baseParams());
    for (const it of items) {
      expect(it.movementId).toBeTruthy();
      expect(it.movementName).toBeTruthy();
    }
  });
});
