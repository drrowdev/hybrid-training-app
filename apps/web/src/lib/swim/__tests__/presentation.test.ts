import { describe, expect, it } from "vitest";
import type { SwimWorkout } from "@hta/domain";
import { generateSwimPlan } from "@hta/engine";
import { planPreviewPresentation, workoutPresentation } from "../presentation";
import { standaloneWeekRequests } from "../model";
import { swimFixture } from "./fixtures";

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

  describe("DC-SW1/DC-SW3 full program preview", () => {
    it("preserves explicit empty weeks, exact native totals and every issued workout without mutation", () => {
      const setup = swimFixture().plan.definition.setup;
      const weeks = standaloneWeekRequests("2026-09-07", 3, [1, 4]);
      const generated = generateSwimPlan({ setup, calibration: null, weeks: weeks.map((week, index) => index === 0 ? { ...week, slots: [] } : week) });
      if (!generated.ok) throw new Error(generated.error.message);
      const before = JSON.stringify(generated.value);
      const preview = planPreviewPresentation(generated.value);
      expect(preview.weeks).toHaveLength(3);
      expect(preview.workoutCount).toBe(4);
      expect(preview.weeks[0]).toMatchObject({ week: 1, startDate: "2026-09-07", total: "0 yd", workouts: [] });
      expect(preview.weeks.flatMap((week) => week.workouts.map((entry) => entry.date))).toEqual([
        "2026-09-14", "2026-09-17", "2026-09-21", "2026-09-24",
      ]);
      expect(preview.weeks[1]!.total).toBe(`${generated.value.weeks[1]!.slots.reduce(
        (lengths, slot) => lengths + (slot.kind === "workout" ? slot.issued.totalLengths : 0), 0,
      ) * 25} yd`);
      expect(JSON.stringify(generated.value)).toBe(before);
    });
    it("does not silently hide unresolved learning guidance", () => {
      const setup = { ...swimFixture().plan.definition.setup, recentComfortableLengths: 0 };
      const generated = generateSwimPlan({ setup, calibration: null, weeks: standaloneWeekRequests("2026-09-07", 2, [1]) });
      if (!generated.ok) throw new Error(generated.error.message);
      expect(() => planPreviewPresentation(generated.value)).toThrow();
    });
  });
  it("does not fabricate pace for an uncalibrated workout", () => {
    expect(workoutPresentation(workout).steps.every((step) => step.pace === undefined)).toBe(true);
    expect(workoutPresentation(workout).steps.every((step) => !!step.guidance)).toBe(true);
  });
  it("DC-SW2/DC-SW5 adds guidance to saved work without changing its calibrated target or snapshot", () => {
    const saved: SwimWorkout = {
      ...workout,
      snapshot: { ...workout.snapshot, calibration: { msPer100: 120000, unit: "yd", protocol: "css_200_400", observedOn: "2026-09-01", heuristic: true, version: "one" } },
      sections: workout.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, targetMsPerRepeat: 60000 })) })),
    };
    const before = JSON.stringify(saved);
    const view = workoutPresentation(saved);
    expect(view.steps[0]?.pace).toBe("Target 1:00");
    expect(view.steps[0]?.guidance).toBeTruthy();
    expect(JSON.stringify(saved)).toBe(before);
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
