import { describe, it, expect } from "vitest";
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import { BODYWEIGHT_ONLY_PRESET } from "@/lib/settings/equipment-presets";
import {
  buildTbAccessoryInjector,
  tbAccessoryPlanForTemplate,
  resolveTbAccessoryMuscles,
  TB_DEFAULT_ACCESSORY_MUSCLES,
} from "../tb-accessories";

function mv(partial: Partial<CatalogMovement> & { id: string; slug: string; pattern: string }): CatalogMovement {
  return {
    displayName: partial.slug,
    primaryMuscles: [],
    secondaryMuscles: [],
    primaryRegion: "",
    secondaryRegions: [],
    bulletproofRoles: [],
    functionalRoles: [],
    isSupported: true,
    isCompound: false,
    isLoadable: false,
    eccentricLoadScore: null,
    stimToFatigueScore: null,
    highStrainTendon: false,
    experienceMin: 0,
    experienceMax: 4,
    equipment: "bodyweight",
    ...partial,
  } as CatalogMovement;
}

describe("tbAccessoryPlanForTemplate — gating + caps (ADR 0048)", () => {
  it("offers accessories on Zulu (cap 3) and Operator/Fighter (cap 2)", () => {
    expect(tbAccessoryPlanForTemplate("zulu")).toEqual({ maxItems: 3, setsPerItem: 3 });
    expect(tbAccessoryPlanForTemplate("zulu-ia")).toEqual({ maxItems: 3, setsPerItem: 3 });
    expect(tbAccessoryPlanForTemplate("operator")).toEqual({ maxItems: 2, setsPerItem: 3 });
    expect(tbAccessoryPlanForTemplate("fighter")).toEqual({ maxItems: 2, setsPerItem: 3 });
  });

  it("disables accessories on the specialist/mass templates", () => {
    for (const t of ["gladiator", "grey-man", "mass", "unknown"]) {
      expect(tbAccessoryPlanForTemplate(t)).toBeNull();
    }
  });
});

describe("resolveTbAccessoryMuscles", () => {
  it("falls back to the default set when none / only invalid are given", () => {
    expect(resolveTbAccessoryMuscles(undefined)).toEqual(TB_DEFAULT_ACCESSORY_MUSCLES);
    expect(resolveTbAccessoryMuscles([])).toEqual(TB_DEFAULT_ACCESSORY_MUSCLES);
    expect(resolveTbAccessoryMuscles(["not_a_muscle"])).toEqual(TB_DEFAULT_ACCESSORY_MUSCLES);
  });

  it("keeps only allowlisted muscles, in the requested order", () => {
    expect(resolveTbAccessoryMuscles(["calves", "biceps", "not_a_muscle"])).toEqual(["calves", "biceps"]);
  });
});

const CATALOG: CatalogMovement[] = [
  mv({ id: "curl1", slug: "barbell-curl", displayName: "Barbell Curl", pattern: "isolation", primaryMuscles: ["biceps"] }),
  mv({ id: "curl2", slug: "db-curl", displayName: "DB Curl", pattern: "isolation", primaryMuscles: ["biceps"] }),
  mv({ id: "tri1", slug: "pushdown", displayName: "Tricep Pushdown", pattern: "isolation", primaryMuscles: ["triceps"] }),
  mv({ id: "calf1", slug: "calf-raise", displayName: "Calf Raise", pattern: "isolation", primaryMuscles: ["calves"] }),
  mv({ id: "ab1", slug: "plank", displayName: "Plank", pattern: "isolation", primaryMuscles: ["abs"] }),
  // must never be selected — conditioning
  mv({ id: "run", slug: "run", displayName: "Run", pattern: "cardio", primaryMuscles: ["quads"] }),
];

const noFilters = { blockedRegions: new Set<string>() };

describe("buildTbAccessoryInjector", () => {
  it("emits up to maxItems accessory items targeting the chosen muscles", () => {
    const inject = buildTbAccessoryInjector({
      catalog: CATALOG,
      filters: noFilters,
      muscles: ["biceps", "triceps", "calves"],
      maxItems: 3,
      setsPerItem: 3,
    });
    const items = inject("b0-w1-s1");
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.kind === "accessory" && i.sets === 3 && i.reps === 12)).toBe(true);
    expect(items.every((i) => i.notes?.includes("8\u201315 reps"))).toBe(true);
    // one per chosen muscle (no duplicate movement)
    expect(new Set(items.map((i) => i.movementId)).size).toBe(3);
  });

  it("respects the per-template cap (fewer items than muscles)", () => {
    const inject = buildTbAccessoryInjector({
      catalog: CATALOG,
      filters: noFilters,
      muscles: ["biceps", "triceps", "calves", "abs"],
      maxItems: 2,
      setsPerItem: 3,
    });
    expect(inject("b0-w1-s1")).toHaveLength(2);
  });

  it("rotates which muscles are hit across sessions when capped", () => {
    const inject = buildTbAccessoryInjector({
      catalog: CATALOG,
      filters: noFilters,
      muscles: ["biceps", "triceps", "calves", "abs"],
      maxItems: 2,
      setsPerItem: 3,
    });
    const muscleSets = ["s1", "s2", "s3", "s4", "s5"].map(
      (r) => new Set(inject(r).map((i) => i.movementSlug)),
    );
    // Not every session resolves to the identical pair.
    const distinct = new Set(muscleSets.map((s) => [...s].sort().join(",")));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("is deterministic for the same session ref", () => {
    const inject = buildTbAccessoryInjector({
      catalog: CATALOG,
      filters: noFilters,
      muscles: ["biceps", "triceps"],
      maxItems: 2,
      setsPerItem: 3,
    });
    expect(inject("ref-A")).toEqual(inject("ref-A"));
  });

  it("never selects a conditioning movement", () => {
    const inject = buildTbAccessoryInjector({
      catalog: CATALOG,
      filters: noFilters,
      muscles: ["biceps", "triceps", "calves", "abs"],
      maxItems: 4,
      setsPerItem: 3,
    });
    expect(inject("r").every((i) => i.movementId !== "run")).toBe(true);
  });

  it("excludes the anchored main lifts", () => {
    const inject = buildTbAccessoryInjector({
      catalog: CATALOG,
      filters: noFilters,
      muscles: ["biceps"],
      maxItems: 1,
      setsPerItem: 3,
      excludeMovementIds: new Set(["curl1", "curl2"]),
    });
    expect(inject("r")).toHaveLength(0);
  });

  it("drops a movement that loads a blocked muscle", () => {
    const inject = buildTbAccessoryInjector({
      catalog: [mv({ id: "curl1", slug: "barbell-curl", pattern: "isolation", primaryMuscles: ["biceps"] })],
      filters: { blockedRegions: new Set(), blockedMuscles: new Set(["biceps"]) },
      muscles: ["biceps"],
      maxItems: 1,
      setsPerItem: 3,
    });
    expect(inject("r")).toHaveLength(0);
  });

  it("respects equipment availability", () => {
    const catalog: CatalogMovement[] = [
      mv({ id: "cab", slug: "cable-pushdown", pattern: "isolation", primaryMuscles: ["triceps"], equipment: "cable" }),
      mv({ id: "bw", slug: "bench-dip", pattern: "isolation", primaryMuscles: ["triceps"], equipment: "bodyweight" }),
    ];
    const inject = buildTbAccessoryInjector({
      catalog,
      equipment: BODYWEIGHT_ONLY_PRESET,
      filters: noFilters,
      muscles: ["triceps"],
      maxItems: 1,
      setsPerItem: 3,
    });
    // only the bodyweight triceps movement survives
    expect(new Set(["a", "b", "c"].map((r) => inject(r)[0]?.movementId))).toEqual(new Set(["bw"]));
  });
});
