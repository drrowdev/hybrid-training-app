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
  it("single strength movement with accessories: leads with main lift + working-set count, no accessory tail", () => {
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
        movementId: "ham",
        movementSlug: "leg_curl",
        movementName: "Leg curl",
      }),
    ];
    // Accessories naturally belong to their parent movements in the
    // per-movement renderer, so the subtitle no longer duplicates the
    // count in the header — the card surfaces them inline.
    expect(summarisePrescription(items)).toBe("Front squat · 6 working sets");
  });

  it("single strength movement with no accessories", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "main", percentTm: 75 }),
      item({ kind: "main", percentTm: 85 }),
      item({ kind: "main", percentTm: 90 }),
    ];
    expect(summarisePrescription(items)).toBe("Front squat · 3 working sets");
  });

  it("multi-strength (two movements): joins names with + and totals working sets", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "main", reps: 5, percentTm: 90, movementId: "fs", movementName: "Front squat" }),
      item({ kind: "main", reps: 5, percentTm: 90, movementId: "fs", movementName: "Front squat" }),
      item({ kind: "main", reps: 5, percentTm: 90, movementId: "fs", movementName: "Front squat" }),
      item({
        kind: "main",
        reps: 15,
        percentTm: undefined,
        movementId: "pu",
        movementSlug: "wide_grip_pull_up",
        movementName: "Wide-grip pull-up",
      }),
      item({
        kind: "main",
        reps: 15,
        percentTm: undefined,
        movementId: "pu",
        movementSlug: "wide_grip_pull_up",
        movementName: "Wide-grip pull-up",
      }),
      item({
        kind: "main",
        reps: 15,
        percentTm: undefined,
        movementId: "pu",
        movementSlug: "wide_grip_pull_up",
        movementName: "Wide-grip pull-up",
      }),
    ];
    expect(summarisePrescription(items)).toBe(
      "Front squat + Wide-grip pull-up · 6 working sets",
    );
  });

  it("multi-strength (three or more movements): collapses to a movement count + total sets", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "main", movementId: "a", movementName: "Push-up" }),
      item({ kind: "back_off", movementId: "a", movementName: "Push-up" }),
      item({ kind: "main", movementId: "b", movementName: "Pull-up" }),
      item({ kind: "back_off", movementId: "b", movementName: "Pull-up" }),
      item({ kind: "main", movementId: "c", movementName: "Squat" }),
      item({ kind: "back_off", movementId: "c", movementName: "Squat" }),
    ];
    expect(summarisePrescription(items)).toBe(
      "3 strength movements · 6 working sets",
    );
  });

  it("singular working-set count uses 'working set' not 'working sets'", () => {
    const items: PrescriptionItem[] = [
      item({ kind: "main", percentTm: 75 }),
    ];
    expect(summarisePrescription(items)).toBe("Front squat · 1 working set");
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
        kind: "back_off",
        percentTm: undefined,
        movementId: "pu",
        movementSlug: "push_up",
        movementName: "Push-up",
      }),
    ];
    expect(summarisePrescription(items)).toBe("Push-up · 3 working sets");
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
    expect(summarisePrescription(items)).toBe("Easy Z2 · 45 min");
  });

  it("tendon-only session with uniform sets × reps: '3 × 10 · Tendon'", () => {
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
    ];
    expect(summarisePrescription(items)).toBe("3 × 10 · Tendon");
  });

  it("tendon-only session with mixed reps falls back to movement count", () => {
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
        movementId: "achilles",
        movementSlug: "heel_raise",
        movementName: "Heel raise",
        reps: 8,
      }),
    ];
    expect(summarisePrescription(items)).toBe("Tendon work · 2 movements");
  });

  it("pure accessory session reports count without 'Accessory circuit' prefix", () => {
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
    expect(summarisePrescription(items)).toBe("3 accessories");
  });

  it("single-accessory session uses singular 'accessory'", () => {
    const items: PrescriptionItem[] = [
      item({
        kind: "accessory",
        movementId: "fp",
        movementSlug: "face_pull",
        movementName: "Face pull",
      }),
    ];
    expect(summarisePrescription(items)).toBe("1 accessory");
  });

  it("empty prescription returns empty string", () => {
    expect(summarisePrescription([])).toBe("");
  });
});
