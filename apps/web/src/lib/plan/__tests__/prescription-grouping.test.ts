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

import {
  collapseIdenticalSetItems,
  describeRowExternalLoad,
  groupByMovementThenKind,
} from "../prescription-grouping";

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
  it("merges main + back-off into one ordered sets list, with warmups separate", () => {
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
    // Combined list: 3 main + 2 back-off = 5 sets, in source order.
    expect(sec.sets).toHaveLength(5);
    expect(sec.sets.map((r) => r.isBackOff)).toEqual([false, false, false, true, true]);
    // Top set marker only fires on the heaviest %TM main row.
    expect(sec.sets.find((r) => r.isTopSet)?.item.percentTm).toBe(90);
    expect(sec.sets.filter((r) => r.isTopSet).length).toBe(1);
    // Back-off rows are NOT eligible for the top-set chip even when
    // their setNumber sequence restarts inside their own bucket.
    expect(sec.sets.filter((r) => r.isBackOff).every((r) => !r.isTopSet)).toBe(true);
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
      // Accessory targeting the squat movement — pools session-level, NOT
      // back into the squat subsection.
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
    expect(squat.sets).toHaveLength(3);
    expect(squat.sets.every((r) => !r.isBackOff)).toBe(true);
    const pull = out.movements[1]!;
    expect(pull.warmups).toHaveLength(0);
    expect(pull.sets).toHaveLength(2);
    expect(pull.sets.map((r) => r.isBackOff)).toEqual([false, true]);
    // Accessories pool at the session level.
    expect(out.accessories).toHaveLength(1);
    expect(out.accessories[0]!.movementName).toBe("Front squat");
  });

  it("pools all accessories into a single session-level section regardless of movement", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "accessory", movementId: "rdl", movementName: "Romanian deadlift", reps: 12 }),
      item({ kind: "accessory", movementId: "carry", movementName: "Overhead carry", reps: 10 }),
      item({ kind: "accessory", movementId: "wall_sit", movementName: "Wall sit", reps: 14 }),
    ];
    const out = groupByMovementThenKind(items);
    // Accessories must NOT create movement subsections — otherwise the
    // card explodes with 5+ headers, one per accessory.
    expect(out.movements).toHaveLength(0);
    expect(out.accessories).toHaveLength(3);
    expect(out.accessories.map((r) => r.movementName)).toEqual([
      "Romanian deadlift",
      "Overhead carry",
      "Wall sit",
    ]);
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
    expect(out.movements[0]!.sets).toHaveLength(1);
    expect(out.movements[0]!.sets[0]!.isBackOff).toBe(false);
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
    expect(out.movements[0]!.sets).toHaveLength(1);
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

  it("hinge-compensation accessory items pool into the session-level hingeCompensations bucket", () => {
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
    expect(out.movements).toHaveLength(0);
    expect(out.hingeCompensations).toHaveLength(1);
    expect(out.accessories).toHaveLength(0);
  });

  it("tendon items pool into the session-level tendon bucket, not per movement", () => {
    const items: PrescriptionItem[] = [
      item({
        kind: "tendon",
        movementId: "calf",
        movementSlug: "heavy_slow_calf_raise",
        movementName: "Heavy slow calf raise",
        reps: 6,
      }),
    ];
    const out = groupByMovementThenKind(items);
    expect(out.movements).toHaveLength(0);
    expect(out.tendon).toHaveLength(1);
  });
});

describe("collapseIdenticalSetItems", () => {
  it("merges consecutive identical single-set items into one summed-set item", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "accessory", movementSlug: "box_jump", reps: 14, sets: 1 }),
      item({ kind: "accessory", movementSlug: "box_jump", reps: 14, sets: 1 }),
    ];
    const out = collapseIdenticalSetItems(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.sets).toBe(2);
    expect(out[0]!.reps).toBe(14);
  });

  it("keeps structurally-different items separate", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "accessory", movementSlug: "box_jump", reps: 14, sets: 1 }),
      item({ kind: "accessory", movementSlug: "box_jump", reps: 12, sets: 1 }),
    ];
    const out = collapseIdenticalSetItems(items);
    expect(out).toHaveLength(2);
  });

  it("sums existing multi-set counts when items match", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "accessory", movementSlug: "curl", reps: 10, sets: 2 }),
      item({ kind: "accessory", movementSlug: "curl", reps: 10, sets: 1 }),
    ];
    const out = collapseIdenticalSetItems(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.sets).toBe(3);
  });

  it("does not merge non-adjacent identical items separated by a different item", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "accessory", movementSlug: "curl", reps: 10, sets: 1 }),
      item({ kind: "accessory", movementSlug: "curl", reps: 12, sets: 1 }),
      item({ kind: "accessory", movementSlug: "curl", reps: 10, sets: 1 }),
    ];
    const out = collapseIdenticalSetItems(items);
    expect(out).toHaveLength(3);
  });
});

