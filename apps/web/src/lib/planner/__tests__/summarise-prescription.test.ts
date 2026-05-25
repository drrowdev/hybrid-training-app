import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import { summarisePrescription } from "../archetypes";

function item(over: Partial<PrescriptionItem>): PrescriptionItem {
  return {
    movementId: "m",
    movementSlug: "front_squat",
    movementName: "Front squat",
    kind: "main",
    sets: 1,
    reps: 5,
    ...over,
  };
}

describe("summarisePrescription", () => {
  it("TM main + accessories: leads with main lift + working-set count + accessory tail", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "warmup", percentTm: 36 }),
      item({ kind: "main", percentTm: 75 }),
      item({ kind: "main", percentTm: 85 }),
      item({ kind: "main", percentTm: 90 }),
      item({ kind: "main", percentTm: 90 }),
      item({ kind: "main", percentTm: 90 }),
      item({ kind: "main", percentTm: 90 }),
      item({
        kind: "accessory",
        movementId: "bss",
        movementSlug: "bulgarian_split_squat",
        movementName: "Bulgarian split squat",
      }),
      item({
        kind: "accessory",
        movementId: "bss",
        movementSlug: "bulgarian_split_squat",
        movementName: "Bulgarian split squat",
      }),
      item({
        kind: "accessory",
        movementId: "ham",
        movementSlug: "leg_curl",
        movementName: "Leg curl",
      }),
      item({
        kind: "accessory",
        movementId: "rev",
        movementSlug: "reverse_lunge",
        movementName: "Reverse lunge",
      }),
      item({
        kind: "accessory",
        movementId: "ad",
        movementSlug: "dead_bug",
        movementName: "Dead bug",
      }),
      item({
        kind: "accessory",
        movementId: "ag",
        movementSlug: "glute_bridge",
        movementName: "Glute bridge",
      }),
    ];
    expect(summarisePrescription(items)).toBe(
      "Front squat — 6 working sets + 5 accessories",
    );
  });

  it("main lift with no accessories drops the accessory tail", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "main", percentTm: 75 }),
      item({ kind: "main", percentTm: 85 }),
      item({ kind: "main", percentTm: 90 }),
    ];
    expect(summarisePrescription(items)).toBe("Front squat — 3 working sets");
  });

  it("singular accessory uses 'accessory' not 'accessories'", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "main", percentTm: 75 }),
      item({
        kind: "accessory",
        movementId: "bss",
        movementSlug: "bulgarian_split_squat",
        movementName: "Bulgarian split squat",
      }),
    ];
    expect(summarisePrescription(items)).toBe(
      "Front squat — 1 working set + 1 accessory",
    );
  });

  it("bodyweight main lift (no TM) still leads with the movement name", () => {
    const items: PrescriptionItem[] = [
      item({
        kind: "main",
        percentTm: undefined,
        movementId: "pu",
        movementSlug: "push_up",
        movementName: "Push-up",
      }),
      item({
        kind: "main",
        percentTm: undefined,
        movementId: "pu",
        movementSlug: "push_up",
        movementName: "Push-up",
      }),
      item({
        kind: "main",
        percentTm: undefined,
        movementId: "pu",
        movementSlug: "push_up",
        movementName: "Push-up",
      }),
      item({
        kind: "main",
        percentTm: undefined,
        movementId: "pu",
        movementSlug: "push_up",
        movementName: "Push-up",
      }),
      item({
        kind: "main",
        percentTm: undefined,
        movementId: "pu",
        movementSlug: "push_up",
        movementName: "Push-up",
      }),
      item({
        kind: "accessory",
        movementId: "row",
        movementSlug: "barbell_row",
        movementName: "Barbell row",
      }),
    ];
    expect(summarisePrescription(items)).toBe(
      "Push-up — 5 working sets + 1 accessory",
    );
  });

  it("pure cardio session shows duration + intensity label", () => {
    const items: PrescriptionItem[] = [
      {
        movementId: "run",
        movementSlug: "run",
        movementName: "Run",
        kind: "cardio_z2",
        durationMin: 45,
        intensityLabel: "Easy Z2",
      },
    ];
    expect(summarisePrescription(items)).toBe("Easy Z2 — 45 min");
  });

  it("tendon-only session reports movement count", () => {
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
      item({
        kind: "tendon",
        movementId: "patellar",
        movementSlug: "knee_extension",
        movementName: "Knee extension",
        reps: 10,
      }),
      item({
        kind: "tendon",
        movementId: "achilles",
        movementSlug: "heel_raise",
        movementName: "Heel raise",
        reps: 10,
      }),
    ];
    expect(summarisePrescription(items)).toBe("Tendon work — 2 movements");
  });

  it("pure accessory session reports movement count", () => {
    const items: PrescriptionItem[] = [
      item({
        kind: "accessory",
        movementId: "bss",
        movementSlug: "bulgarian_split_squat",
        movementName: "Bulgarian split squat",
      }),
      item({
        kind: "accessory",
        movementId: "row",
        movementSlug: "barbell_row",
        movementName: "Barbell row",
      }),
      item({
        kind: "accessory",
        movementId: "fp",
        movementSlug: "face_pull",
        movementName: "Face pull",
      }),
    ];
    expect(summarisePrescription(items)).toBe(
      "Accessory circuit — 3 movements",
    );
  });

  it("empty prescription returns empty string", () => {
    expect(summarisePrescription([])).toBe("");
  });
});
