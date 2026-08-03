import { describe, expect, it } from "vitest";
import type { Prescription } from "@hta/db";
import {
  groupPrescriptionByMovement,
  deriveCardState,
  isMovementComplete,
  autoCursorForGroup,
  effectiveCursor,
  lastMainSlot,
  bucketLabelForKind,
  bucketPositionForSlot,
} from "../movement-grouping";

function p(items: Prescription["items"]): Prescription {
  return { items };
}

describe("groupPrescriptionByMovement", () => {
  it("returns [] when prescription is null or empty", () => {
    expect(groupPrescriptionByMovement(null)).toEqual([]);
    expect(groupPrescriptionByMovement(p([]))).toEqual([]);
  });

  it("groups items by movementId in first-appearance order, preserving item order", () => {
    const pres = p([
      { movementId: "squat", movementName: "Squat", kind: "warmup", sets: 1, reps: 5 },
      { movementId: "squat", movementName: "Squat", kind: "main", sets: 1, reps: 5 },
      { movementId: "bench", movementName: "Bench Press", kind: "main", sets: 1, reps: 5 },
      { movementId: "squat", movementName: "Squat", kind: "back_off", sets: 1, reps: 8 },
    ]);
    const groups = groupPrescriptionByMovement(pres);
    expect(groups.map((g) => g.movementId)).toEqual(["squat", "bench"]);
    expect(groups[0]!.itemIndices).toEqual([0, 1, 3]);
    expect(groups[0]!.items.map((it) => it.kind)).toEqual(["warmup", "main", "back_off"]);
    // Warm-ups are bucketed separately from working sets even though
    // they still live in itemIndices for back-compat.
    expect(groups[0]!.slotBuckets.warmup).toEqual([0]);
    expect(groups[0]!.slotBuckets.working).toEqual([1, 2]);
    expect(groups[0]!.slotBuckets.accessory).toEqual([]);
    expect(groups[1]!.itemIndices).toEqual([2]);
    expect(groups[1]!.slotBuckets.working).toEqual([0]);
  });

  it("falls back to a humanised slug when movementName is missing", () => {
    const pres = p([
      { movementId: "hh-1", movementSlug: "hip_hinge", kind: "main", sets: 1, reps: 5 },
    ]);
    const [g] = groupPrescriptionByMovement(pres);
    expect(g!.movementName).toBe("Hip hinge");
  });

  it("uses 'Movement' when neither name nor slug is available", () => {
    const pres = p([
      { movementId: "mystery", kind: "main", sets: 1, reps: 5 },
    ]);
    const [g] = groupPrescriptionByMovement(pres);
    expect(g!.movementName).toBe("Movement");
  });

  it("buckets accessory and tendon slots together", () => {
    const pres = p([
      { movementId: "lift", kind: "main", sets: 1, reps: 5 },
      { movementId: "lift", kind: "accessory", sets: 1, reps: 10 },
      { movementId: "lift", kind: "tendon", sets: 1, reps: 8 },
    ]);
    const [g] = groupPrescriptionByMovement(pres);
    expect(g!.slotBuckets.working).toEqual([0]);
    expect(g!.slotBuckets.accessory).toEqual([1, 2]);
  });

  it("skips cardio items", () => {
    const pres = p([
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
      { movementId: "run", kind: "cardio_z2", durationMin: 30 },
    ]);
    const groups = groupPrescriptionByMovement(pres);
    expect(groups.map((g) => g.movementId)).toEqual(["squat"]);
  });
});

describe("deriveCardState / isMovementComplete", () => {
  const group = {
    movementId: "squat",
    movementName: "Squat",
    movementSlug: "squat",
    itemIndices: [0, 1, 2],
    items: [],
    slotBuckets: { warmup: [], working: [0, 1, 2], accessory: [] },
  } as ReturnType<typeof groupPrescriptionByMovement>[number];

  it("not_started with no logged items", () => {
    expect(deriveCardState(group, new Set())).toBe("not_started");
    expect(isMovementComplete(group, new Set())).toBe(false);
  });
  it("in_progress with some logged items", () => {
    expect(deriveCardState(group, new Set([0]))).toBe("in_progress");
    expect(isMovementComplete(group, new Set([0, 1]))).toBe(false);
  });
  it("completed when every item is logged", () => {
    expect(deriveCardState(group, new Set([0, 1, 2]))).toBe("completed");
    expect(isMovementComplete(group, new Set([0, 1, 2]))).toBe(true);
  });
  it("treats skipped sets as covered for completion (mixed logged + skipped)", () => {
    // Caller passes the union of logged-and-skipped indices in
    // `loggedItemIndices`. The page-render path builds it that way via
    // matchPrescriptionItemsDetailed.
    const covered = new Set([0, 1, 2]); // 0 logged, 1 skipped, 2 logged
    expect(isMovementComplete(group, covered)).toBe(true);
    expect(deriveCardState(group, covered)).toBe("completed");
  });

  it("completes a 3–5 set prescription after the three required sets", () => {
    const [range] = groupPrescriptionByMovement(
      p([
        { movementId: "squat", kind: "main", sets: 1, reps: 5 },
        { movementId: "squat", kind: "main", sets: 1, reps: 5 },
        { movementId: "squat", kind: "main", sets: 1, reps: 5 },
        { movementId: "squat", kind: "main", sets: 1, reps: 5, optional: true },
        { movementId: "squat", kind: "main", sets: 1, reps: 5, optional: true },
      ]),
    );
    expect(isMovementComplete(range!, new Set([0, 1, 2]))).toBe(true);
    expect(deriveCardState(range!, new Set([0, 1, 2]))).toBe("completed");
    expect(bucketLabelForKind("main", 0, 2, true)).toBe("Optional set · 1 of 2");
  });
});

describe("autoCursorForGroup + effectiveCursor", () => {
  const group = {
    movementId: "squat",
    movementName: "Squat",
    movementSlug: "squat",
    itemIndices: [10, 11, 12, 13],
    items: [],
    slotBuckets: { warmup: [], working: [0, 1, 2, 3], accessory: [] },
  } as ReturnType<typeof groupPrescriptionByMovement>[number];

  it("returns 0 when nothing logged", () => {
    expect(autoCursorForGroup(group, new Set())).toBe(0);
  });
  it("advances to the next pending slot as items get logged", () => {
    expect(autoCursorForGroup(group, new Set([10]))).toBe(1);
    expect(autoCursorForGroup(group, new Set([10, 11]))).toBe(2);
    expect(autoCursorForGroup(group, new Set([10, 12]))).toBe(1); // still first un-logged
  });
  it("clamps to last slot when everything is logged", () => {
    expect(autoCursorForGroup(group, new Set([10, 11, 12, 13]))).toBe(3);
  });
  it("manual cursor wins until cleared", () => {
    expect(effectiveCursor(2, 3)).toBe(3);
    expect(effectiveCursor(2, null)).toBe(2);
    expect(effectiveCursor(2, 0)).toBe(0);
  });
});

describe("lastMainSlot + bucketLabelForKind", () => {
  it("finds the last main-kind slot", () => {
    const group = {
      movementId: "squat",
      movementName: "Squat",
      movementSlug: "squat",
      itemIndices: [0, 1, 2, 3],
      items: [
        { movementId: "squat", kind: "warmup" },
        { movementId: "squat", kind: "main" },
        { movementId: "squat", kind: "main" },
        { movementId: "squat", kind: "back_off" },
      ],
      slotBuckets: { warmup: [0], working: [1, 2, 3], accessory: [] },
    } as ReturnType<typeof groupPrescriptionByMovement>[number];
    expect(lastMainSlot(group)).toBe(2);
  });

  it("formats bucket labels", () => {
    expect(bucketLabelForKind("warmup", 0, 3)).toBe("Warm-up · 1 of 3");
    expect(bucketLabelForKind("main", 1, 5)).toBe("Working set · 2 of 5");
    expect(bucketLabelForKind("back_off", 2, 3)).toBe("Supplemental · 3 of 3");
  });
});

describe("bucketPositionForSlot", () => {
  it("scopes Set X of Y to the active bucket (warm-ups don't inflate working count)", () => {
    const pres = p([
      { movementId: "squat", kind: "warmup", sets: 1, reps: 5 },
      { movementId: "squat", kind: "warmup", sets: 1, reps: 5 },
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
    ]);
    const [g] = groupPrescriptionByMovement(pres);
    // slot 1 = 2nd warm-up → "Warm-up 2 of 2"
    expect(bucketPositionForSlot(g!, 1)).toEqual({ bucket: "warmup", position: 1, total: 2 });
    // slot 2 = 1st working set → "Working 1 of 3" (not "Set 3 of 5")
    expect(bucketPositionForSlot(g!, 2)).toEqual({ bucket: "working", position: 0, total: 3 });
    // slot 4 = 3rd working set
    expect(bucketPositionForSlot(g!, 4)).toEqual({ bucket: "working", position: 2, total: 3 });
  });
});
