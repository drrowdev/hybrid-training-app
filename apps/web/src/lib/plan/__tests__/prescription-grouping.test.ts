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

import { describeRowExternalLoad, groupByMovementThenKind } from "../prescription-grouping";

describe("describeRowExternalLoad", () => {
  function row(items: PrescriptionItem[]) {
    return {
      rowKey: "k",
      movementId: "m",
      movementName: "Pull-up",
      movementSlug: "pull_up",
      items,
    };
  }

  it("returns null when no item carries bw load metadata", () => {
    expect(describeRowExternalLoad(row([item({ kind: "accessory" })]))).toBeNull();
  });

  it("renders a positive load as `+10 kg vest`", () => {
    const it = item({ kind: "accessory" });
    (it as unknown as { bw: { externalLoadKg: number; loadSource: string } }).bw = {
      externalLoadKg: 10,
      loadSource: "weighted_vest",
    };
    expect(describeRowExternalLoad(row([it]))).toBe("+10 kg vest");
  });

  it("renders a band assist as `−15 kg band`", () => {
    const it = item({ kind: "accessory" });
    (it as unknown as { bw: { externalLoadKg: number; loadSource: string } }).bw = {
      externalLoadKg: -15,
      loadSource: "band_assist",
    };
    expect(describeRowExternalLoad(row([it]))).toBe("−15 kg band");
  });

  it("renders the bare label when readiness state (zero kg)", () => {
    const it = item({ kind: "accessory" });
    (it as unknown as { bw: { externalLoadKg: number; loadSource: string } }).bw = {
      externalLoadKg: 0,
      loadSource: "dip_belt",
    };
    expect(describeRowExternalLoad(row([it]))).toBe("belt");
  });
});

describe("groupByMovementThenKind", () => {
  it("splits a single-movement session into warmups → main → back-off, ordered by appearance", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "warmup", percentTm: 36 }),
      item({ kind: "warmup", percentTm: 45 }),
      item({ kind: "main", percentTm: 75 }),
      item({ kind: "main", percentTm: 85 }),
      item({ kind: "main", percentTm: 90 }),
      item({ kind: "back_off", percentTm: 70, reps: 8 }),
      item({ kind: "back_off", percentTm: 70, reps: 8 }),
    ];
    const out = groupByMovementThenKind(items);
    expect(out.movements).toHaveLength(1);
    const sec = out.movements[0]!;
    expect(sec.movementName).toBe("Front squat");
    expect(sec.warmups).toHaveLength(2);
    expect(sec.main).toHaveLength(3);
    expect(sec.backOff).toHaveLength(2);
    expect(sec.main.find((r) => r.isTopSet)?.item.percentTm).toBe(90);
    // Back-off rows are NOT eligible for the top-set chip even when
    // their setNumber sequence restarts inside their own bucket.
    expect(sec.backOff.every((r) => !r.isTopSet)).toBe(true);
  });

  it("groups multi-movement sessions (bodyweight push + pull + squat) by movementId", () => {
    const items: PrescriptionItem[] = [
      // Squat family: warmup + main + back-off
      item({ kind: "warmup", percentTm: 36, movementId: "fs", movementName: "Front squat" }),
      item({ kind: "main", percentTm: 75, movementId: "fs", movementName: "Front squat" }),
      item({ kind: "main", percentTm: 85, movementId: "fs", movementName: "Front squat" }),
      item({ kind: "main", percentTm: 90, movementId: "fs", movementName: "Front squat" }),
      // Pull family: BW main + back-off, no warmup, no %TM
      item({
        kind: "main",
        percentTm: undefined,
        reps: 15,
        movementId: "wpu",
        movementSlug: "wide_grip_pull_up",
        movementName: "Wide-grip pull-up",
      }),
      item({
        kind: "back_off",
        percentTm: undefined,
        reps: 15,
        movementId: "wpu",
        movementSlug: "wide_grip_pull_up",
        movementName: "Wide-grip pull-up",
      }),
      // Accessory targeting the squat movement
      item({
        kind: "accessory",
        movementId: "fs",
        movementSlug: "front_squat",
        movementName: "Front squat",
        reps: 12,
      }),
    ];
    const out = groupByMovementThenKind(items);
    expect(out.movements).toHaveLength(2);
    expect(out.movements.map((m) => m.movementName)).toEqual([
      "Front squat",
      "Wide-grip pull-up",
    ]);
    const squat = out.movements[0]!;
    expect(squat.warmups).toHaveLength(1);
    expect(squat.main).toHaveLength(3);
    expect(squat.backOff).toHaveLength(0);
    expect(squat.accessories).toHaveLength(1);
    const pull = out.movements[1]!;
    expect(pull.warmups).toHaveLength(0);
    expect(pull.main).toHaveLength(1);
    expect(pull.backOff).toHaveLength(1);
    expect(pull.accessories).toHaveLength(0);
  });

  it("drops contentless items (no reps, percentTm, hold, intensity, notes) instead of rendering blank rows", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "main", percentTm: 75, reps: 5 }),
      // Generator-side malformed item — would have rendered as "Set 2: (empty)"
      {
        movementId: "m",
        movementSlug: "front_squat",
        movementName: "Front squat",
        kind: "back_off",
      } as PrescriptionItem,
    ];
    const out = groupByMovementThenKind(items);
    expect(out.movements[0]!.main).toHaveLength(1);
    expect(out.movements[0]!.backOff).toHaveLength(0);
  });

  it("keeps items whose only renderable content is on the bw payload (isometric holds, rep ranges)", () => {
    const items: PrescriptionItem[] = [
      {
        movementId: "p",
        movementSlug: "plank",
        movementName: "Plank",
        kind: "main",
        bw: {
          prescriptionType: "isometric_hold",
          sets: 1,
          holdSeconds: 30,
          tempoEccentricSec: 0,
          targetRir: 2,
          restSeconds: 90,
          intensityCue: "Brace hard.",
        },
        holdSec: { min: 30, max: 30 },
      } as PrescriptionItem,
    ];
    const out = groupByMovementThenKind(items);
    expect(out.movements).toHaveLength(1);
    expect(out.movements[0]!.main).toHaveLength(1);
  });

  it("routes cardio items into the session-level cardio bucket, not per movement", () => {
    const items: PrescriptionItem[] = [
      item({
        kind: "cardio_z2",
        movementId: "run",
        movementSlug: "run",
        movementName: "Run",
        durationMin: 45,
      }),
    ];
    const out = groupByMovementThenKind(items);
    expect(out.movements).toHaveLength(0);
    expect(out.cardio).toHaveLength(1);
  });

  it("hinge-compensation accessory items are routed into their movement's hingeCompensations bucket", () => {
    const items: PrescriptionItem[] = [
      item({
        kind: "accessory",
        movementId: "rdl",
        movementSlug: "romanian_deadlift",
        movementName: "Romanian deadlift",
        reps: 10,
        meta: { hinge_compensation: true },
      }),
    ];
    const out = groupByMovementThenKind(items);
    expect(out.movements).toHaveLength(1);
    expect(out.movements[0]!.hingeCompensations).toHaveLength(1);
    expect(out.movements[0]!.accessories).toHaveLength(0);
  });
});

