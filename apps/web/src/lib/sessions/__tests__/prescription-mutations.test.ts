import { describe, it, expect } from "vitest";
import {
  applyPrescriptionSwap,
  isSwapped,
  originalMovementName,
  removeMovementFromPrescription,
  swapMovementInPrescription,
  addMovementToPrescription,
  hasUserEditedPrescription,
} from "../prescription-mutations";
import type { Prescription } from "@hta/db";

const base: Prescription = {
  items: [
    {
      movementId: "mov-bench",
      movementSlug: "bench-press-flat",
      movementName: "Bench Press (flat)",
      kind: "main",
      sets: 3,
      reps: 5,
      percentTm: 80,
    },
    {
      movementId: "mov-squat",
      movementSlug: "back-squat-high-bar",
      movementName: "Back Squat (high-bar)",
      kind: "main",
      sets: 3,
      reps: 5,
      percentTm: 80,
    },
  ],
};

describe("applyPrescriptionSwap — Phase 2 A2", () => {
  it("swaps the target item and leaves the others untouched", () => {
    const next = applyPrescriptionSwap(base, {
      itemIndex: 0,
      newMovement: {
        id: "mov-floor",
        slug: "floor-press",
        displayName: "Floor Press",
      },
      swappedAt: "2026-05-23T12:00:00.000Z",
    });
    expect(next.items[0]!.movementId).toBe("mov-floor");
    expect(next.items[0]!.movementSlug).toBe("floor-press");
    expect(next.items[0]!.movementName).toBe("Floor Press");
    // Untouched item still squat.
    expect(next.items[1]!.movementId).toBe("mov-squat");
    // Reps/sets/percentTm preserved on the swapped item.
    expect(next.items[0]!.sets).toBe(3);
    expect(next.items[0]!.reps).toBe(5);
    expect(next.items[0]!.percentTm).toBe(80);
    expect(next.userEdited).toBe(true);
  });

  it("records the original movement under meta.swappedFrom", () => {
    const next = applyPrescriptionSwap(base, {
      itemIndex: 0,
      newMovement: { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
      swappedAt: "2026-05-23T12:00:00.000Z",
    });
    const meta = next.items[0]!.meta as Record<string, unknown>;
    expect(meta.swappedFrom).toEqual({
      movementId: "mov-bench",
      movementName: "Bench Press (flat)",
    });
    expect(meta.swappedAt).toBe("2026-05-23T12:00:00.000Z");
  });

  it("chaining swaps preserves the original-original under swappedFrom", () => {
    const once = applyPrescriptionSwap(base, {
      itemIndex: 0,
      newMovement: { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
      swappedAt: "2026-05-23T12:00:00.000Z",
    });
    const twice = applyPrescriptionSwap(once, {
      itemIndex: 0,
      newMovement: { id: "mov-cgbp", slug: "close-grip-bench", displayName: "Close-grip Bench" },
      swappedAt: "2026-05-23T12:05:00.000Z",
    });
    const meta = twice.items[0]!.meta as Record<string, unknown>;
    // Origin stays the original bench, not the intermediate floor press.
    expect(meta.swappedFrom).toEqual({
      movementId: "mov-bench",
      movementName: "Bench Press (flat)",
    });
    expect(meta.swappedAt).toBe("2026-05-23T12:05:00.000Z");
    expect(twice.items[0]!.movementId).toBe("mov-cgbp");
  });

  it("does not mutate the input prescription (immutability invariant)", () => {
    const next = applyPrescriptionSwap(base, {
      itemIndex: 0,
      newMovement: { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
    });
    expect(base.items[0]!.movementId).toBe("mov-bench");
    expect(next).not.toBe(base);
    expect(next.items).not.toBe(base.items);
  });

  it("throws RangeError on out-of-range index", () => {
    expect(() =>
      applyPrescriptionSwap(base, {
        itemIndex: 5,
        newMovement: { id: "x", slug: "x", displayName: "X" },
      }),
    ).toThrow(RangeError);
  });

  it("isSwapped + originalMovementName helpers", () => {
    expect(isSwapped(base.items[0]!)).toBe(false);
    expect(originalMovementName(base.items[0]!)).toBeNull();

    const next = applyPrescriptionSwap(base, {
      itemIndex: 0,
      newMovement: { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
    });
    expect(isSwapped(next.items[0]!)).toBe(true);
    expect(originalMovementName(next.items[0]!)).toBe("Bench Press (flat)");
  });
});

describe("removeMovementFromPrescription", () => {
  it("drops every item of the movement, keeps the rest", () => {
    const next = removeMovementFromPrescription(base, "mov-bench");
    expect(next.items).toHaveLength(1);
    expect(next.items[0]!.movementId).toBe("mov-squat");
    expect(next.userEdited).toBe(true);
  });
  it("is a no-op when the movement is absent", () => {
    const next = removeMovementFromPrescription(base, "mov-nope");
    expect(next.items).toHaveLength(2);
    expect(next).toBe(base);
    expect(next.userEdited).toBeUndefined();
  });
});

describe("swapMovementInPrescription", () => {
  it("retargets all items of the movement and records lineage", () => {
    const multi: Prescription = {
      items: [
        { movementId: "mov-bench", movementSlug: "bench", movementName: "Bench", kind: "warmup", sets: 1, reps: 5 },
        { movementId: "mov-bench", movementSlug: "bench", movementName: "Bench", kind: "main", sets: 3, reps: 5 },
        { movementId: "mov-squat", movementSlug: "squat", movementName: "Squat", kind: "main", sets: 3, reps: 5 },
      ],
    };
    const next = swapMovementInPrescription(
      multi,
      "mov-bench",
      { id: "mov-floor", slug: "floor-press", displayName: "Floor Press" },
      "2026-05-23T12:00:00.000Z",
    );
    expect(next.items[0]!.movementId).toBe("mov-floor");
    expect(next.items[1]!.movementId).toBe("mov-floor");
    expect(next.items[2]!.movementId).toBe("mov-squat");
    const meta = next.items[1]!.meta as Record<string, unknown>;
    expect(meta.swappedFrom).toEqual({ movementId: "mov-bench", movementName: "Bench" });
    expect(next.userEdited).toBe(true);
  });
});

describe("addMovementToPrescription", () => {
  it("appends a 3x10 accessory tagged userAdded", () => {
    const next = addMovementToPrescription(base, {
      id: "mov-curl",
      slug: "db-biceps-curl",
      displayName: "DB Biceps Curl",
    });
    expect(next.items).toHaveLength(3);
    const added = next.items[2]!;
    expect(added.movementId).toBe("mov-curl");
    expect(added.kind).toBe("accessory");
    expect(added.sets).toBe(3);
    expect(added.reps).toBe(10);
    expect((added.meta as Record<string, unknown>).userAdded).toBe(true);
    expect(next.userEdited).toBe(true);
  });
});

describe("hasUserEditedPrescription", () => {
  it("recognizes explicit and legacy movement-edit markers", () => {
    expect(hasUserEditedPrescription(base)).toBe(false);
    expect(
      hasUserEditedPrescription({ ...base, userEdited: true }),
    ).toBe(true);
    expect(
      hasUserEditedPrescription({
        items: [
          {
            ...base.items[0]!,
            meta: { userAdded: true },
          },
        ],
      }),
    ).toBe(true);
    expect(
      hasUserEditedPrescription({
        items: [
          {
            ...base.items[0]!,
            meta: {
              swappedFrom: {
                movementId: "original",
                movementName: "Original",
              },
            },
          },
        ],
      }),
    ).toBe(true);
  });
});
