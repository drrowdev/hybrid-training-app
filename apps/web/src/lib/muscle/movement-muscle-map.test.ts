import { describe, it, expect } from "vitest";
import {
  MOVEMENT_MUSCLE_MAP,
  muscleFanoutFromMovementRow,
  cardioFanout,
  isMuscleGroup,
} from "./movement-muscle-map";
import { ALL_MUSCLE_GROUPS } from "./muscle-groups";

describe("movement-muscle-map — static slug overrides", () => {
  it("squat (low-bar) maps to quads + glutes + erectors with the right weights", () => {
    const f = MOVEMENT_MUSCLE_MAP["back-squat-low-bar"];
    expect(f).toBeDefined();
    const quads = f.find((x) => x.muscle === "quads");
    const glutes = f.find((x) => x.muscle === "glutes");
    const erectors = f.find((x) => x.muscle === "erectors");
    expect(quads?.weight).toBe(1.0);
    expect(glutes?.weight).toBe(1.0);
    expect(erectors?.weight).toBe(0.5);
  });

  it("deadlift fans out across the full posterior chain", () => {
    const f = MOVEMENT_MUSCLE_MAP["conventional-deadlift"];
    const got = new Set(f.map((x) => x.muscle));
    expect(got.has("hamstrings")).toBe(true);
    expect(got.has("glutes")).toBe(true);
    expect(got.has("erectors")).toBe(true);
    expect(got.has("lats")).toBe(true);
    expect(got.has("traps")).toBe(true);
  });

  it("bench-press-flat → chest primary, triceps + shoulders secondary", () => {
    const f = MOVEMENT_MUSCLE_MAP["bench-press-flat"];
    expect(f.find((x) => x.muscle === "chest")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "triceps")?.weight).toBe(0.5);
    expect(f.find((x) => x.muscle === "shoulders")?.weight).toBe(0.5);
  });

  it("ohp-standing → shoulders primary", () => {
    const f = MOVEMENT_MUSCLE_MAP["ohp-standing"];
    expect(f.find((x) => x.muscle === "shoulders")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "triceps")?.weight).toBe(0.5);
  });

  it("pull-up → lats primary, biceps + back secondary", () => {
    const f = MOVEMENT_MUSCLE_MAP["pull-up-overhand"];
    expect(f.find((x) => x.muscle === "lats")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "biceps")?.weight).toBe(0.5);
    expect(f.find((x) => x.muscle === "back")?.weight).toBe(0.5);
  });

  it("hip-thrust → glutes primary", () => {
    expect(MOVEMENT_MUSCLE_MAP["hip-thrust-bb"]?.[0]).toEqual({
      muscle: "glutes",
      weight: 1.0,
    });
  });

  it("calf-raise-standing → calves only", () => {
    expect(MOVEMENT_MUSCLE_MAP["calf-raise-standing"]).toEqual([
      { muscle: "calves", weight: 1.0 },
    ]);
  });

  it("copenhagen-plank → adductors primary, core secondary", () => {
    const f = MOVEMENT_MUSCLE_MAP["copenhagen-plank"];
    expect(f.find((x) => x.muscle === "adductors")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "core")?.weight).toBe(0.5);
  });

  it("side-plank → obliques primary, core secondary", () => {
    expect(MOVEMENT_MUSCLE_MAP["side-plank"]).toEqual([
      { muscle: "obliques", weight: 1.0 },
      { muscle: "core", weight: 0.5 },
    ]);
  });

  it("hanging-leg-raise → core primary", () => {
    expect(MOVEMENT_MUSCLE_MAP["hanging-leg-raise"]?.[0]).toEqual({
      muscle: "core",
      weight: 1.0,
    });
  });

  it("lateral-raise-db → shoulders only", () => {
    expect(MOVEMENT_MUSCLE_MAP["lateral-raise-db"]).toEqual([
      { muscle: "shoulders", weight: 1.0 },
    ]);
  });

  it("face-pull → shoulders + traps", () => {
    const f = MOVEMENT_MUSCLE_MAP["face-pull"];
    expect(f.find((x) => x.muscle === "shoulders")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "traps")?.weight).toBe(0.5);
  });

  it("farmer-carry-db → forearms primary, traps + core secondary", () => {
    const f = MOVEMENT_MUSCLE_MAP["farmer-carry-db"];
    expect(f.find((x) => x.muscle === "forearms")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "traps")?.weight).toBe(0.5);
    expect(f.find((x) => x.muscle === "core")?.weight).toBe(0.5);
  });

  it("every static-map weight is in (0, 1]", () => {
    for (const [slug, fanout] of Object.entries(MOVEMENT_MUSCLE_MAP)) {
      for (const fw of fanout) {
        expect(fw.weight, `${slug}/${fw.muscle}`).toBeGreaterThan(0);
        expect(fw.weight, `${slug}/${fw.muscle}`).toBeLessThanOrEqual(1.0);
      }
    }
  });
});

describe("muscleFanoutFromMovementRow — DB fallback", () => {
  it("static slug takes precedence over DB columns", () => {
    const out = muscleFanoutFromMovementRow({
      slug: "back-squat-low-bar",
      primaryMuscles: ["chest"],
      secondaryMuscles: [],
    });
    // Static map returns quads/glutes/erectors, NOT chest.
    expect(out.find((x) => x.muscle === "quads")).toBeDefined();
    expect(out.find((x) => x.muscle === "chest")).toBeUndefined();
  });

  it("unknown slug falls back to DB columns with primary 1.0 / secondary 0.5", () => {
    const out = muscleFanoutFromMovementRow({
      slug: "made-up-movement",
      primaryMuscles: ["front_delts", "side_delts"],
      secondaryMuscles: ["triceps"],
    });
    const shoulders = out.find((x) => x.muscle === "shoulders");
    const triceps = out.find((x) => x.muscle === "triceps");
    expect(shoulders?.weight).toBe(1.0);
    expect(triceps?.weight).toBe(0.5);
  });

  it("unmapped enum values (abductors, neck) are dropped", () => {
    const out = muscleFanoutFromMovementRow({
      slug: null,
      primaryMuscles: ["abductors", "neck"],
      secondaryMuscles: [],
    });
    expect(out).toEqual([]);
  });

  it("returns [] when nothing is mappable", () => {
    expect(
      muscleFanoutFromMovementRow({ slug: null, primaryMuscles: [], secondaryMuscles: [] }),
    ).toEqual([]);
  });
});

describe("cardioFanout — modality map", () => {
  it("interval_run colours quads + hamstrings + glutes + calves at full weight", () => {
    const f = cardioFanout("interval_run");
    expect(f.find((x) => x.muscle === "quads")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "hamstrings")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "glutes")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "calves")?.weight).toBe(1.0);
  });

  it("row colours lats + back + shoulders", () => {
    const f = cardioFanout("row");
    expect(f.find((x) => x.muscle === "lats")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "back")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "shoulders")?.weight).toBe(0.5);
  });

  it("padel colours shoulders + obliques", () => {
    const f = cardioFanout("padel");
    expect(f.find((x) => x.muscle === "shoulders")?.weight).toBe(1.0);
    expect(f.find((x) => x.muscle === "obliques")?.weight).toBe(1.0);
  });

  it("unknown modality returns []", () => {
    expect(cardioFanout("teleportation")).toEqual([]);
  });

  it("null / undefined modality returns []", () => {
    expect(cardioFanout(null)).toEqual([]);
    expect(cardioFanout(undefined)).toEqual([]);
  });
});

describe("isMuscleGroup type guard", () => {
  it("accepts all 16 muscle groups", () => {
    for (const m of ALL_MUSCLE_GROUPS) {
      expect(isMuscleGroup(m)).toBe(true);
    }
  });

  it("rejects DB enum values that are not display groups", () => {
    expect(isMuscleGroup("abs")).toBe(false);
    expect(isMuscleGroup("front_delts")).toBe(false);
    expect(isMuscleGroup("garbage")).toBe(false);
  });
});
