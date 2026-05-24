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
    expect(groups[1]!.itemIndices).toEqual([2]);
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
});

describe("autoCursorForGroup + effectiveCursor", () => {
  const group = {
    movementId: "squat",
    movementName: "Squat",
    movementSlug: "squat",
    itemIndices: [10, 11, 12, 13],
    items: [],
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
    } as ReturnType<typeof groupPrescriptionByMovement>[number];
    expect(lastMainSlot(group)).toBe(2);
  });

  it("formats bucket labels", () => {
    expect(bucketLabelForKind("warmup", 0, 3)).toBe("Warm-up · Set 1 of 3");
    expect(bucketLabelForKind("main", 1, 5)).toBe("Working set · Set 2 of 5");
    expect(bucketLabelForKind("back_off", 2, 3)).toBe("Back-off · Set 3 of 3");
  });
});
