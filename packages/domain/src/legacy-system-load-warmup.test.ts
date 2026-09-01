/**
 * DC-K4 — a plan materialised under the old broad `body_weight_loaded` rule
 * must not be silently replanned, and must not show a warm-up ramp that never
 * existed.
 *
 * The shape under test is the one those plans actually stored: a warm-up with a
 * `systemLoad` marker, a bodyweight-SUBTRACTED absolute, and no percentage to
 * fall back on. The lightest rung was clamped to `0` on the way in.
 */
import { describe, expect, it } from "vitest";
import {
  repairLegacySystemLoadWarmups,
  type LegacyWarmupItem,
  type LegacyWarmupRepairContext,
} from "./legacy-system-load-warmup";
import { resolveTargetLoadKg } from "./target-load";

/** 110 kg top set, 80 kg lifter, a 50/75/100 ladder: 55 / 82.5 / 110. */
const LEGACY_FORWARD_LUNGE: LegacyWarmupItem[] = [
  { movementId: "lunge", kind: "warmup", targetWeightKg: 0, systemLoad: true },
  { movementId: "lunge", kind: "warmup", targetWeightKg: 2.5, systemLoad: true },
  { movementId: "lunge", kind: "warmup", targetWeightKg: 30, systemLoad: true },
  { movementId: "lunge", kind: "main", percentTm: 100 },
];

function ctx(
  overrides: Partial<LegacyWarmupRepairContext> = {},
): LegacyWarmupRepairContext {
  return {
    isSystemLoadMovement: () => false,
    bodyweightKg: 80,
    trainingMaxKg: () => 110,
    rampFractions: [0.5, 0.75, 1],
    ...overrides,
  };
}

const targets = (items: readonly LegacyWarmupItem[]) =>
  items
    .filter((item) => item.kind === "warmup")
    .map((item) => resolveTargetLoadKg(item, { bodyweightKg: 80 }));

describe("legacy system-load warm-ups (DC-K4)", () => {
  it("restates a lunge ramp as the totals it always meant", () => {
    const repaired = repairLegacySystemLoadWarmups(LEGACY_FORWARD_LUNGE, ctx());
    expect(repaired.slice(0, 3).map((i) => i.targetWeightKg)).toEqual([
      55, 82.5, 110,
    ]);
  });

  it("resolves through the shared resolver on every surface", () => {
    // Preview, logger and fill all end at `resolveTargetLoadKg`. Repairing the
    // items first is what makes those three agree.
    expect(targets(LEGACY_FORWARD_LUNGE)).toEqual([null, 2.5, 30]);
    expect(targets(repairLegacySystemLoadWarmups(LEGACY_FORWARD_LUNGE, ctx()))).toEqual([
      55, 82.5, 110,
    ]);
  });

  it("drops the marker so the total is not read as an added load", () => {
    const repaired = repairLegacySystemLoadWarmups(LEGACY_FORWARD_LUNGE, ctx());
    expect(repaired.every((item) => item.systemLoad === undefined)).toBe(true);
  });

  it("keeps every field the lifter was asked to perform", () => {
    const withWork = LEGACY_FORWARD_LUNGE.map((item, index) =>
      index === 1 ? ({ ...item, sets: 1, reps: 5, notes: "keep" } as LegacyWarmupItem) : item,
    );
    const repaired = repairLegacySystemLoadWarmups(withWork, ctx());
    expect(repaired[1]).toMatchObject({ sets: 1, reps: 5, notes: "keep", targetWeightKg: 82.5 });
  });

  it("clears the stale bodyweight cue on a rung that now carries load", () => {
    // The persisted item calls it `notes`; the engine item calls it `note`.
    const cued = LEGACY_FORWARD_LUNGE.map((item, index) =>
      index === 0
        ? ({ ...item, notes: "bodyweight", note: "bodyweight" } as LegacyWarmupItem)
        : item,
    );
    const repaired = repairLegacySystemLoadWarmups(cued, ctx());
    expect(repaired[0]?.targetWeightKg).toBe(55);
    expect(repaired[0]?.notes).toBeUndefined();
    expect(repaired[0]?.note).toBeUndefined();
  });

  it("is idempotent", () => {
    const once = repairLegacySystemLoadWarmups(LEGACY_FORWARD_LUNGE, ctx());
    expect(repairLegacySystemLoadWarmups(once, ctx())).toEqual(once);
  });

  it("recovers the shared 40/60/80 ladder after its collapsed rungs", () => {
    // 110 kg top set, 80 kg lifter: 44 and 66 both clamp to 0, and the writer
    // keeps the FIRST of a repeated load and drops the second. So the surviving
    // clamped slot is the 40% rung, not the 60% one — replaying the writer is
    // what tells them apart, because two slots could align to either end.
    const items: LegacyWarmupItem[] = [
      { movementId: "lunge", kind: "warmup", targetWeightKg: 0, systemLoad: true },
      { movementId: "lunge", kind: "warmup", targetWeightKg: 7.5, systemLoad: true },
      { movementId: "lunge", kind: "main", percentTm: 100 },
    ];
    const repaired = repairLegacySystemLoadWarmups(
      items,
      ctx({ rampFractions: [0.4, 0.6, 0.8] }),
    );
    expect(repaired.slice(0, 2).map((i) => i.targetWeightKg)).toEqual([44, 88]);
  });
});

describe("legacy warm-up recovery fails closed", () => {
  it("leaves a genuine weighted pull-up alone", () => {
    const items: LegacyWarmupItem[] = [
      { movementId: "pullup", kind: "warmup", targetWeightKg: 0, systemLoad: true },
      { movementId: "pullup", kind: "main", percentTm: 100 },
    ];
    expect(
      repairLegacySystemLoadWarmups(items, ctx({ isSystemLoadMovement: () => true })),
    ).toBe(items);
  });

  it("does nothing when the catalog cannot answer", () => {
    expect(
      repairLegacySystemLoadWarmups(
        LEGACY_FORWARD_LUNGE,
        ctx({ isSystemLoadMovement: () => undefined }),
      ),
    ).toBe(LEGACY_FORWARD_LUNGE);
  });

  it("does nothing without a bodyweight on file", () => {
    expect(
      repairLegacySystemLoadWarmups(LEGACY_FORWARD_LUNGE, ctx({ bodyweightKg: null })),
    ).toBe(LEGACY_FORWARD_LUNGE);
  });

  it("leaves an unmarked absolute warm-up untouched", () => {
    // A hand-entered technique load on the same movement. It never carried the
    // marker, so it is the lifter's own number.
    const items: LegacyWarmupItem[] = [
      { movementId: "lunge", kind: "warmup", targetWeightKg: 20 },
      { movementId: "lunge", kind: "main", percentTm: 100 },
    ];
    expect(repairLegacySystemLoadWarmups(items, ctx())).toBe(items);
  });

  it("leaves rehab and external-cardio loads untouched", () => {
    const items: LegacyWarmupItem[] = [
      { movementId: "lunge", kind: "rehab", targetWeightKg: 5, systemLoad: true },
      { movementId: "lunge", kind: "cardio_external", targetWeightKg: 12, systemLoad: true },
    ];
    expect(repairLegacySystemLoadWarmups(items, ctx())).toBe(items);
  });

  it("leaves the block alone when the ladder disagrees", () => {
    const repaired = repairLegacySystemLoadWarmups(
      LEGACY_FORWARD_LUNGE,
      ctx({ rampFractions: [0.4, 0.6, 0.8] }),
    );
    expect(repaired.slice(0, 3).map((i) => i.targetWeightKg)).toEqual([0, 2.5, 30]);
  });

  it("will not rebuild a lone clamped rung that nothing corroborates", () => {
    const items: LegacyWarmupItem[] = [
      { movementId: "lunge", kind: "warmup", targetWeightKg: 0, systemLoad: true },
      { movementId: "lunge", kind: "main", percentTm: 100 },
    ];
    expect(repairLegacySystemLoadWarmups(items, ctx())).toBe(items);
  });

  it("leaves the block alone when there is no training max to replay against", () => {
    const repaired = repairLegacySystemLoadWarmups(
      LEGACY_FORWARD_LUNGE,
      ctx({ trainingMaxKg: () => null }),
    );
    expect(repaired).toBe(LEGACY_FORWARD_LUNGE);
  });

  it("leaves the block alone when the main set has no percentage anchor", () => {
    const items: LegacyWarmupItem[] = [
      ...LEGACY_FORWARD_LUNGE.slice(0, 3),
      { movementId: "lunge", kind: "main" },
    ];
    expect(repairLegacySystemLoadWarmups(items, ctx())).toBe(items);
  });

  it("will not restate a positive rung off a bodyweight that has since changed", () => {
    // Written at 80 kg, so 2.5 meant 82.5. Adding today's 85 kg would call it
    // 87.5 — heavier than the lifter was ever asked for. The replay no longer
    // reproduces the block, so nothing moves.
    const repaired = repairLegacySystemLoadWarmups(
      LEGACY_FORWARD_LUNGE,
      ctx({ bodyweightKg: 85 }),
    );
    expect(repaired).toBe(LEGACY_FORWARD_LUNGE);
  });

  it("rebuilds two blocks of one movement off their own anchors", () => {
    // Second block ramps to 104.5 (95% of 110). Its 50% and 75% rungs both
    // clamped to 0 and collapsed into the FIRST of the two, and the top rung
    // floored to 22.5 on the way in.
    const items: LegacyWarmupItem[] = [
      ...LEGACY_FORWARD_LUNGE,
      { movementId: "lunge", kind: "warmup", targetWeightKg: 0, systemLoad: true },
      { movementId: "lunge", kind: "warmup", targetWeightKg: 22.5, systemLoad: true },
      { movementId: "lunge", kind: "main", percentTm: 95 },
    ];
    const repaired = repairLegacySystemLoadWarmups(items, ctx());
    expect(repaired[0]!.targetWeightKg).toBe(55);
    // Off 104.5, not off the first block's larger 110 anchor.
    expect(repaired[4]!.targetWeightKg).toBe(52.25);
    expect(repaired[5]!.targetWeightKg).toBe(104.5);
  });
});
