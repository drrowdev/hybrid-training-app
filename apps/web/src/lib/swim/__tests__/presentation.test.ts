import { describe, expect, it } from "vitest";
import type { SwimWorkout } from "@hta/domain";
import { workoutPresentation } from "../presentation";

const workout: SwimWorkout = {
  kind: "swim_workout", focus: "technique_base", totalLengths: 8, estimatedMs: null,
  budget: { minutes: 30, accountedMs: 120000 },
  snapshot: {
    course: { numerator: 25, denominator: 1, unit: "yd" }, strokes: ["freestyle"], equipment: ["fins"],
    calibration: null, protocol: null, versions: { model: "one", generator: "one", assessment: null },
  },
  sections: [{ kind: "main", label: "Main", rounds: 2, items: [{
    repeats: 2, lengths: 2, stroke: "freestyle", effort: "easy", equipment: ["fins"], restSeconds: 30, optional: false,
  }] }],
};

describe("ADR0079 poolside ordered workout", () => {
  it("groups repeats while preserving every round and individual progress identity", () => {
    const view = workoutPresentation(workout);
    expect(view.steps).toHaveLength(2);
    expect(new Set(view.steps.map((step) => step.id)).size).toBe(2);
    expect(view.steps.map((step) => step.repeatIds)).toEqual([
      ["0:0:0:0", "0:0:0:1"], ["0:1:0:0", "0:1:0:1"],
    ]);
    expect(view.total).toContain("200");
    expect(view.total).toContain("yd");
    expect(view.steps[0]).toMatchObject({ title: "2 × 50 yd", detail: "Freestyle · Fins", effort: "Easy", rest: "Rest 30 sec" });
  });
  it("does not fabricate pace for an uncalibrated workout", () => {
    expect(workoutPresentation(workout).steps.every((step) => step.pace === undefined)).toBe(true);
  });
  it("uses display labels rather than drill identifiers", () => {
    const drill = { ...workout, sections: workout.sections.map((section) => ({
      ...section, items: section.items.map((item) => ({ ...item, drill: "single_arm" })),
    })) };
    expect(workoutPresentation(drill).steps[0]!.detail).toContain("Single-arm drill");
    expect(workoutPresentation(drill).steps[0]!.detail).not.toContain("single_arm");
  });
  it("does not display a target without an assessment snapshot", () => {
    const partial = { ...workout, sections: workout.sections.map((section) => ({
      ...section, items: section.items.map((item) => ({ ...item, targetMsPerRepeat: 60000 })),
    })) };
    expect(workoutPresentation(partial).steps.every((step) => step.pace === undefined)).toBe(true);
    expect(workoutPresentation({ ...partial, estimatedMs: 240000 }).steps.every((step) => step.pace === undefined)).toBe(true);
  });
});
