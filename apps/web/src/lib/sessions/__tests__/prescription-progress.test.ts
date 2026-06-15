import { describe, expect, it } from "vitest";
import type { Prescription } from "@hta/db";
import {
  matchPrescriptionItems,
  countStrengthPrescriptionItems,
  countProgrammedWorkingSets,
} from "../prescription-progress";

function makePrescription(items: Prescription["items"]): Prescription {
  return { items };
}

describe("matchPrescriptionItems", () => {
  it("returns an empty set when the prescription is null", () => {
    const out = matchPrescriptionItems(null, [
      { movementId: "m1", setKind: "main", prescriptionItemIndex: 0 },
    ]);
    expect(out.size).toBe(0);
  });

  it("uses the explicit prescription_item_index link when present", () => {
    const p = makePrescription([
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
      { movementId: "bench", kind: "main", sets: 1, reps: 5 },
    ]);
    const out = matchPrescriptionItems(p, [
      { movementId: "squat", setKind: "main", prescriptionItemIndex: 1 },
    ]);
    // The index says item 1, even though the movement matches item 0.
    expect([...out]).toEqual([1]);
  });

  it("falls back to first-match-by-movement when no explicit link", () => {
    const p = makePrescription([
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
      { movementId: "squat", kind: "back_off", sets: 3, reps: 8 },
      { movementId: "bench", kind: "main", sets: 1, reps: 5 },
    ]);
    const out = matchPrescriptionItems(p, [
      { movementId: "squat", setKind: "main", prescriptionItemIndex: null },
      { movementId: "squat", setKind: "back_off", prescriptionItemIndex: null },
    ]);
    expect([...out].sort()).toEqual([0, 1]);
  });

  it("ignores warmup sets when doing fallback matching", () => {
    const p = makePrescription([
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
    ]);
    const out = matchPrescriptionItems(p, [
      { movementId: "squat", setKind: "warmup", prescriptionItemIndex: null },
    ]);
    expect(out.size).toBe(0);
  });

  it("does not double-count when more logged sets than prescribed items", () => {
    const p = makePrescription([
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
    ]);
    const out = matchPrescriptionItems(p, [
      { movementId: "squat", setKind: "main", prescriptionItemIndex: null },
      { movementId: "squat", setKind: "main", prescriptionItemIndex: null },
      { movementId: "squat", setKind: "main", prescriptionItemIndex: null },
    ]);
    expect([...out]).toEqual([0]);
  });

  it("treats an out-of-bounds index as no link and falls back", () => {
    const p = makePrescription([
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
    ]);
    const out = matchPrescriptionItems(p, [
      { movementId: "squat", setKind: "main", prescriptionItemIndex: 42 },
    ]);
    expect([...out]).toEqual([0]);
  });

  it("skips cardio items in fallback matching", () => {
    const p = makePrescription([
      { movementId: "run", kind: "cardio_z2", durationMin: 30 },
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
    ]);
    const out = matchPrescriptionItems(p, [
      { movementId: "squat", setKind: "main", prescriptionItemIndex: null },
    ]);
    expect([...out]).toEqual([1]);
  });
});

describe("countStrengthPrescriptionItems", () => {
  it("returns 0 when prescription is null or empty", () => {
    expect(countStrengthPrescriptionItems(null)).toBe(0);
    expect(countStrengthPrescriptionItems(makePrescription([]))).toBe(0);
  });

  it("counts every strength item including warmup, tendon, power_potentiation", () => {
    const p = makePrescription([
      { movementId: "a", kind: "warmup", sets: 1, reps: 5 },
      { movementId: "a", kind: "main", sets: 1, reps: 5 },
      { movementId: "a", kind: "back_off", sets: 3, reps: 8 },
      { movementId: "a", kind: "accessory", sets: 3, reps: 10 },
      { movementId: "a", kind: "tendon", sets: 1, reps: 8 },
      { movementId: "a", kind: "power_potentiation", sets: 1, reps: 3 },
    ]);
    expect(countStrengthPrescriptionItems(p)).toBe(6);
  });

  it("excludes cardio items", () => {
    const p = makePrescription([
      { movementId: "a", kind: "main", sets: 1, reps: 5 },
      { movementId: "b", kind: "cardio_z2", durationMin: 30 },
      { movementId: "c", kind: "cardio_vo2", durationMin: 20 },
    ]);
    expect(countStrengthPrescriptionItems(p)).toBe(1);
  });
});

describe("matchPrescriptionItemsDetailed — skipped flagging", () => {
  it("marks skipped indices in both the matched and skipped sets", async () => {
    const { matchPrescriptionItemsDetailed } = await import(
      "../prescription-progress"
    );
    const p = makePrescription([
      { movementId: "squat", kind: "main", sets: 1, reps: 5 },
      { movementId: "squat", kind: "back_off", sets: 1, reps: 8 },
      { movementId: "bench", kind: "main", sets: 1, reps: 5 },
    ]);
    const { matched, skipped } = matchPrescriptionItemsDetailed(p, [
      {
        movementId: "squat",
        setKind: "main",
        prescriptionItemIndex: 0,
        skipped: false,
      },
      {
        movementId: "squat",
        setKind: "back_off",
        prescriptionItemIndex: 1,
        skipped: true,
      },
      {
        movementId: "bench",
        setKind: "main",
        prescriptionItemIndex: null,
        skipped: false,
      },
    ]);
    expect([...matched].sort()).toEqual([0, 1, 2]);
    expect([...skipped]).toEqual([1]);
  });
});



describe("countProgrammedWorkingSets", () => {
  it("returns 0 for a null / empty prescription", () => {
    expect(countProgrammedWorkingSets(null)).toBe(0);
    expect(countProgrammedWorkingSets({ items: [] })).toBe(0);
  });

  it("counts working strength sets and excludes warm-ups + cardio", () => {
    const p = {
      items: [
        { movementId: "sq", kind: "warmup", sets: 1, reps: 5 },
        { movementId: "sq", kind: "warmup", sets: 1, reps: 5 },
        { movementId: "sq", kind: "main", sets: 1, reps: 5 },
        { movementId: "sq", kind: "main", sets: 1, reps: 5 },
        { movementId: "sq", kind: "main", sets: 1, reps: 5 },
        { movementId: "curl", kind: "accessory", sets: 1, reps: 12 },
        { movementId: "", kind: "cardio_external" },
      ],
    } as const;
    // 3 main + 1 accessory = 4 working sets; warm-ups + cardio excluded.
    expect(countProgrammedWorkingSets(p as never)).toBe(4);
  });

  it("respects an item's multi-set count (sets > 1)", () => {
    const p = {
      items: [
        { movementId: "sq", kind: "main", sets: 1, reps: 5 },
        { movementId: "sq", kind: "back_off", sets: 5, reps: 10 },
      ],
    } as const;
    expect(countProgrammedWorkingSets(p as never)).toBe(6);
  });
});
