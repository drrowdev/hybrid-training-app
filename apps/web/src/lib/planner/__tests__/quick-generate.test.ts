import { describe, it, expect } from "vitest";
import {
  STRENGTH_ROLE_PRIME_MUSCLES,
  FRESHNESS_TARGET_MULTIPLIER,
  freshnessValue,
  scoreRoleFreshness,
  pickFreshestStrengthRole,
  buildAestheticFreshnessMask,
  quickWorkingWeekIndex,
  durationCapMinutes,
  trimToDurationCap,
  SHORT_CAP_MIN,
  NORMAL_CAP_MIN,
} from "../quick-generate";
import { STRENGTH_ANCHOR } from "../archetypes";
import type { MuscleGroup } from "@/lib/muscle/muscle-groups";
import type { MuscleFreshnessBand } from "@/lib/muscle/muscle-freshness";
import type { PrescriptionItem } from "@hta/db";

const bands = (
  entries: Partial<Record<MuscleGroup, MuscleFreshnessBand>>,
): Map<MuscleGroup, MuscleFreshnessBand> =>
  new Map(Object.entries(entries) as [MuscleGroup, MuscleFreshnessBand][]);

describe("quick-generate — freshness band values", () => {
  it("ranks untouched/fresh above ready above loaded", () => {
    expect(freshnessValue("untouched")).toBe(1.0);
    expect(freshnessValue("fresh")).toBe(1.0);
    expect(freshnessValue("ready")).toBeLessThan(freshnessValue("fresh"));
    expect(freshnessValue("loaded")).toBeLessThan(freshnessValue("ready"));
  });
});

describe("quick-generate — role freshness scoring", () => {
  it("scores a role by the mean recovery of its prime movers", () => {
    // squat = quads + glutes
    const m = bands({ quads: "loaded", glutes: "loaded" });
    expect(scoreRoleFreshness("squat", m)).toBeCloseTo(0.2, 5);
  });

  it("treats a missing muscle as fully fresh (never spuriously demoted)", () => {
    expect(scoreRoleFreshness("squat", bands({}))).toBe(1.0);
  });

  it("picks the freshest role; legs smashed → upper press wins", () => {
    const m = bands({
      quads: "loaded",
      glutes: "loaded",
      hamstrings: "loaded",
      chest: "fresh",
      triceps: "fresh",
      shoulders: "fresh",
    });
    const role = pickFreshestStrengthRole(
      ["squat", "horizontal_press", "deadlift", "vertical_press"],
      m,
    );
    // squat/deadlift are loaded; press patterns are fresh.
    expect(role === "horizontal_press" || role === "vertical_press").toBe(true);
  });

  it("is stable: first candidate wins a tie (archetype order)", () => {
    const role = pickFreshestStrengthRole(
      ["deadlift", "squat", "horizontal_press"],
      bands({}), // all fresh → all score 1.0 → first wins
    );
    expect(role).toBe("deadlift");
  });

  it("returns null for an empty candidate list", () => {
    expect(pickFreshestStrengthRole([], bands({}))).toBeNull();
  });

  it("covers every strength role with prime movers", () => {
    for (const role of Object.keys(
      STRENGTH_ROLE_PRIME_MUSCLES,
    ) as (keyof typeof STRENGTH_ROLE_PRIME_MUSCLES)[]) {
      expect(STRENGTH_ROLE_PRIME_MUSCLES[role].length).toBeGreaterThan(0);
    }
  });
});

describe("quick-generate — aesthetic freshness mask", () => {
  it("maps a loaded group to the loaded multiplier on its fine-enum muscles", () => {
    // biceps (group) loaded → fine-enum "biceps" gets the loaded multiplier.
    const mask = buildAestheticFreshnessMask(bands({ biceps: "loaded" }));
    expect(mask.get("biceps")).toBe(FRESHNESS_TARGET_MULTIPLIER.loaded);
  });

  it("collapses fine-enum shoulder heads to the shoulders group band", () => {
    // side_delts + rear_delts both collapse to `shoulders`.
    const mask = buildAestheticFreshnessMask(bands({ shoulders: "ready" }));
    expect(mask.get("side_delts")).toBe(FRESHNESS_TARGET_MULTIPLIER.ready);
    expect(mask.get("rear_delts")).toBe(FRESHNESS_TARGET_MULTIPLIER.ready);
  });

  it("omits muscles whose group is absent from the freshness map", () => {
    const mask = buildAestheticFreshnessMask(bands({}));
    expect(mask.size).toBe(0);
  });

  it("fresh / untouched groups produce a ×1.0 (no-op) multiplier", () => {
    const mask = buildAestheticFreshnessMask(
      bands({ chest: "fresh", lats: "untouched" }),
    );
    expect(mask.get("upper_chest")).toBe(1.0);
    expect(mask.get("lats")).toBe(1.0);
  });
});

describe("quick-generate — working week + length caps", () => {
  it("picks the first non-deload week of the archetype", () => {
    // strength_anchor week 3 is the deload (strengthVolumeScale 0.5).
    const idx = quickWorkingWeekIndex(STRENGTH_ANCHOR);
    expect(idx).toBe(0);
    expect(STRENGTH_ANCHOR.weekProfiles[idx]!.strengthVolumeScale ?? 1).toBeGreaterThanOrEqual(1);
  });

  it("maps length → minute cap", () => {
    expect(durationCapMinutes("short")).toBe(SHORT_CAP_MIN);
    expect(durationCapMinutes("normal")).toBe(NORMAL_CAP_MIN);
    expect(SHORT_CAP_MIN).toBeLessThan(NORMAL_CAP_MIN);
  });
});

describe("quick-generate — duration trim", () => {
  const main = (): PrescriptionItem =>
    ({
      movementId: "m-main",
      movementSlug: "back-squat",
      movementName: "Back squat",
      kind: "main",
      sets: 3,
      reps: 5,
    }) as unknown as PrescriptionItem;
  const accessory = (n: number): PrescriptionItem =>
    ({
      movementId: `m-acc-${n}`,
      movementSlug: `acc-${n}`,
      movementName: `Accessory ${n}`,
      kind: "accessory",
      sets: 3,
      reps: 12,
    }) as unknown as PrescriptionItem;

  it("drops trailing accessories until under the cap, keeping the main", () => {
    const items = [main(), accessory(1), accessory(2), accessory(3), accessory(4)];
    const trimmed = trimToDurationCap(items, 20);
    // Main lift is always retained.
    expect(trimmed.some((i) => i.kind === "main")).toBe(true);
    // Some accessories were dropped to fit 20 min.
    expect(trimmed.filter((i) => i.kind === "accessory").length).toBeLessThan(4);
  });

  it("never trims the main even if it alone exceeds the cap", () => {
    const trimmed = trimToDurationCap([main()], 1);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]!.kind).toBe("main");
  });

  it("is a no-op when already under the cap", () => {
    const items = [main(), accessory(1)];
    expect(trimToDurationCap(items, 120)).toHaveLength(2);
  });
});
