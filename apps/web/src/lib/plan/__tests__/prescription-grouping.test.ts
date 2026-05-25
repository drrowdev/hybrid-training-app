import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import { groupPrescriptionSections } from "../prescription-grouping";

function item(over: Partial<PrescriptionItem>): PrescriptionItem {
  return {
    movementId: "m1",
    movementSlug: "front_squat",
    movementName: "Front squat",
    kind: "main",
    sets: 1,
    reps: 5,
    ...over,
  };
}

describe("groupPrescriptionSections", () => {
  it("partitions a typical strength session into warmups, main, accessories", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "warmup", percentTm: 36, reps: 5 }),
      item({ kind: "warmup", percentTm: 45, reps: 3 }),
      item({ kind: "main", percentTm: 75, reps: 5 }),
      item({ kind: "main", percentTm: 85, reps: 3 }),
      item({ kind: "main", percentTm: 90, reps: 1 }),
      item({
        kind: "accessory",
        movementId: "bss",
        movementSlug: "bulgarian_split_squat",
        movementName: "Bulgarian split squat",
        reps: 14,
      }),
      item({
        kind: "accessory",
        movementId: "bss",
        movementSlug: "bulgarian_split_squat",
        movementName: "Bulgarian split squat",
        reps: 14,
      }),
    ];
    const out = groupPrescriptionSections(items);
    expect(out.warmups).toHaveLength(2);
    expect(out.main).toHaveLength(3);
    expect(out.main.map((m) => m.setNumber)).toEqual([1, 2, 3]);
    expect(out.accessories).toHaveLength(1);
    expect(out.accessories[0]!.items).toHaveLength(2);
    expect(out.accessories[0]!.movementName).toBe("Bulgarian split squat");
  });

  it("marks the highest-%TM main set as top set (back-off excluded)", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "main", percentTm: 75 }),
      item({ kind: "main", percentTm: 90 }),
      item({ kind: "back_off", percentTm: 95 }), // back-off ignored for top-set
    ];
    const out = groupPrescriptionSections(items);
    expect(out.main.find((m) => m.isTopSet)?.item.percentTm).toBe(90);
    expect(out.main.filter((m) => m.isTopSet)).toHaveLength(1);
  });

  it("breaks out hinge-compensation accessories into their own bucket", () => {
    const items: PrescriptionItem[] = [
      item({
        kind: "accessory",
        movementId: "rdl",
        movementSlug: "romanian_deadlift",
        movementName: "Romanian deadlift",
        meta: { hinge_compensation: true },
      }),
      item({
        kind: "accessory",
        movementId: "row",
        movementSlug: "barbell_row",
        movementName: "Barbell row",
      }),
    ];
    const out = groupPrescriptionSections(items);
    expect(out.accessories).toHaveLength(1);
    expect(out.accessories[0]!.movementName).toBe("Barbell row");
    expect(out.hingeCompensations).toHaveLength(1);
    expect(out.hingeCompensations[0]!.movementName).toBe("Romanian deadlift");
  });

  it("routes cardio_* kinds to the cardio section", () => {
    const items: PrescriptionItem[] = [
      item({
        kind: "cardio_z2",
        movementId: "run",
        movementSlug: "run",
        movementName: "Run",
        durationMin: 45,
      }),
    ];
    const out = groupPrescriptionSections(items);
    expect(out.cardio).toHaveLength(1);
    expect(out.main).toHaveLength(0);
  });

  it("routes tendon items to their own bucket and dedupes by movement", () => {
    const items: PrescriptionItem[] = [
      item({
        kind: "tendon",
        movementId: "patellar",
        movementSlug: "knee_extension",
        movementName: "Knee extension",
        reps: 10,
      }),
      item({
        kind: "tendon",
        movementId: "patellar",
        movementSlug: "knee_extension",
        movementName: "Knee extension",
        reps: 10,
      }),
    ];
    const out = groupPrescriptionSections(items);
    expect(out.tendon).toHaveLength(1);
    expect(out.tendon[0]!.items).toHaveLength(2);
  });

  it("falls back to slug-humanised name when movementName is missing", () => {
    const items: PrescriptionItem[] = [
      {
        movementId: "x",
        movementSlug: "face_pull",
        kind: "accessory",
        reps: 12,
      } as PrescriptionItem,
    ];
    const out = groupPrescriptionSections(items);
    expect(out.accessories[0]!.movementName).toBe("Face pull");
  });
});
