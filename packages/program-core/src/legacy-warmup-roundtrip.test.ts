/**
 * The legacy warm-up recovery in `@hta/domain` rebuilds a rung the writer
 * clamped to zero by REPLAYING the writer. This is the round trip that proves
 * the replay matches the real writer rather than a description of it — it lives
 * here because `packages/domain` must not depend on `packages/program-core`.
 *
 * DC-K4: the engine's number and the lifter's number are the same number.
 */
import { describe, expect, it } from "vitest";
import {
  repairLegacySystemLoadWarmups,
  type LegacyWarmupItem,
} from "@hta/domain";
import { buildSystemLoadWarmupItems } from "./index";

/** Everything a stored legacy block plus its working set looked like on disk. */
function storedPlan(args: {
  topWorkingKg: number;
  bodyweightKg: number;
  percents: number[];
}): { items: LegacyWarmupItem[]; warmupCount: number } {
  const written = buildSystemLoadWarmupItems({
    name: "Forward lunge",
    movementId: "lunge",
    workingSystemLoadKg: args.topWorkingKg,
    bodyweightKg: args.bodyweightKg,
    roundingKg: 2.5,
    ramp: {
      percents: args.percents,
      reps: args.percents.map(() => 5),
      anchor: "top_set",
    },
  });
  return {
    warmupCount: written.length,
    items: [
      ...written.map((item) => ({
        movementId: "lunge",
        kind: "warmup",
        targetWeightKg: item.weightKg ?? 0,
        systemLoad: true,
        ...(item.note != null ? { note: item.note } : {}),
      })),
      { movementId: "lunge", kind: "main", percentTm: 100 },
    ],
  };
}

describe("legacy system-load warm-ups round-trip through the real writer (DC-K4)", () => {
  const cases: Array<{ name: string; percents: number[]; expected: number[] }> = [
    {
      // Both sub-bodyweight rungs collapse; the writer keeps the FIRST, so the
      // surviving clamped slot is 40% — aligning to the ladder's tail would
      // call it 60% and hand the lifter 66 kg instead of 44 kg.
      name: "the shared 40/60/80 ladder, whose first two rungs collapse",
      percents: [0.4, 0.6, 0.8],
      expected: [44, 88],
    },
    {
      name: "a 50/75/100 ladder, where only the lightest rung clamps",
      percents: [0.5, 0.75, 1],
      expected: [55, 82.5, 110],
    },
    {
      name: "a long ladder whose first three rungs collapse into one",
      percents: [0.3, 0.5, 0.7, 0.75, 0.9, 1],
      // 0.5 and 0.7 both clamp to the 0 that 0.3 already wrote, so only four
      // slots were ever stored: rungs 0, 3, 4 and 5.
      expected: [33, 82.5, 99, 110],
    },
  ];

  for (const testCase of cases) {
    it(`recovers ${testCase.name}`, () => {
      const topWorkingKg = 110;
      const bodyweightKg = 80;
      const { items, warmupCount } = storedPlan({
        topWorkingKg,
        bodyweightKg,
        percents: testCase.percents,
      });

      const repaired = repairLegacySystemLoadWarmups(items, {
        isSystemLoadMovement: () => false,
        bodyweightKg,
        trainingMaxKg: () => topWorkingKg,
        rampFractions: testCase.percents,
      });

      const recovered = repaired
        .slice(0, warmupCount)
        .map((item) => item.targetWeightKg);
      expect(recovered).toEqual(testCase.expected);
      // Every rung is now a real external load, not the bodyweight-subtracted
      // remainder that was on disk.
      expect(recovered.every((kg) => (kg ?? 0) > 0)).toBe(true);
      // The marker is gone, so nothing subtracts bodyweight a second time.
      expect(repaired.slice(0, warmupCount).every((i) => i.systemLoad == null)).toBe(
        true,
      );
      // No rung still claims to be bodyweight-only while carrying a load.
      expect(repaired.slice(0, warmupCount).every((i) => i.note !== "bodyweight")).toBe(
        true,
      );
    });
  }

  it("declines the clamped rung when the ladder is not the one that wrote the block", () => {
    const bodyweightKg = 80;
    const { items, warmupCount } = storedPlan({
      topWorkingKg: 110,
      bodyweightKg,
      percents: [0.5, 0.75, 1],
    });

    const repaired = repairLegacySystemLoadWarmups(items, {
      isSystemLoadMovement: () => false,
      bodyweightKg,
      trainingMaxKg: () => 110,
      // A four-rung ladder cannot replay a block the three-rung one wrote.
      rampFractions: [0.4, 0.55, 0.7, 0.85],
    });

    const recovered = repaired
      .slice(0, warmupCount)
      .map((item) => item.targetWeightKg);
    // Exact inversions still stand; the lost rung is not invented.
    expect(recovered).toEqual([0, 82.5, 110]);
  });

  it("declines when the lifter's bodyweight is no longer the one that wrote the block", () => {
    const { items, warmupCount } = storedPlan({
      topWorkingKg: 110,
      bodyweightKg: 80,
      percents: [0.5, 0.75, 1],
    });

    const repaired = repairLegacySystemLoadWarmups(items, {
      isSystemLoadMovement: () => false,
      // Bodyweight moved after the plan was written, so the replay cannot
      // reproduce the block and the clamped rung stays unrecovered.
      bodyweightKg: 85,
      trainingMaxKg: () => 110,
      rampFractions: [0.5, 0.75, 1],
    });

    expect(repaired.slice(0, warmupCount)[0]!.targetWeightKg).toBe(0);
  });
});
