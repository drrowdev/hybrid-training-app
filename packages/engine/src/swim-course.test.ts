import { describe, expect, it } from "vitest";
import { poolCourse, SWIM_COURSE_VERSION, type SwimCourseWorkout } from "@hta/domain";
import { compileSwimCourseWorkout, editableSwimCourseWorkout } from "./swim-course";
import { changeSwimWorkoutPool } from "./swimming";

function source(): SwimCourseWorkout {
  return {
    title: "Synthetic practice", reportedDistanceMetres: 350,
    sections: [
      { kind: "warmup", label: "Warm-up", rounds: 1, items: [
        { repeats: 1, distanceMetres: 50, stroke: "freestyle", effort: "easy", equipment: [] },
      ] },
      { kind: "main", label: "Main", rounds: 1, items: [
        { repeats: 5, distanceMetres: 50, stroke: "freestyle", effort: "steady", equipment: [], restSeconds: 20 },
      ] },
      { kind: "cooldown", label: "Cool-down", rounds: 1, items: [
        { repeats: 1, distanceMetres: 50, stroke: "freestyle", effort: "easy", equipment: [] },
      ] },
    ],
  };
}

describe("DC-SW1/SW2/SW3/SW5 private source prescriptions", () => {
  it("retains every section, repeat, round and rest without generating a replacement", () => {
    const input = source();
    const before = JSON.stringify(input);
    const compiled = compileSwimCourseWorkout(input, poolCourse(50, 1, "m"), 30);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("Synthetic course compilation failed");
    expect(compiled.value).toMatchObject({
      distanceMetres: 350, reportedDistanceMetres: 350, sourceTotalDiffers: false,
      workout: {
        totalLengths: 7, estimatedMs: null, budget: { accountedMs: 80000, minutes: 30 },
        snapshot: { calibration: null, protocol: null, versions: { generator: SWIM_COURSE_VERSION } },
      },
    });
    expect(compiled.value.workout.sections[1]!.items[0]).toMatchObject({ repeats: 5, lengths: 1, restSeconds: 20 });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("reports a contradictory source total rather than adding work or removing a circuit", () => {
    const input = source();
    const compiled = compileSwimCourseWorkout({
      ...input, sections: input.sections.map((section) => section.kind === "main" ? { ...section, rounds: 2 } : section),
    }, poolCourse(50, 1, "m"), 30);
    expect(compiled).toMatchObject({
      ok: true, value: { distanceMetres: 600, reportedDistanceMetres: 350, sourceTotalDiffers: true },
    });
  });

  it("rejects a short rested repeat in a long pool instead of combining repeats", () => {
    const input = source();
    const shortRepeat = {
      ...input, sections: input.sections.map((section) => section.kind === "main"
        ? { ...section, items: section.items.map((item) => ({ ...item, distanceMetres: 25 })) } : section),
    };
    expect(compileSwimCourseWorkout(shortRepeat, poolCourse(50, 1, "m"), 30).ok).toBe(false);
    expect(compileSwimCourseWorkout(shortRepeat, poolCourse(25, 1, "m"), 30)).toMatchObject({
      ok: true, value: { distanceMetres: 225 },
    });
  });

  it("keeps source timing unestimated through a pool edit without adding generator transitions", () => {
    const compiled = compileSwimCourseWorkout(source(), poolCourse(50, 1, "m"), 30);
    if (!compiled.ok) throw new Error("Synthetic course compilation failed");
    expect(changeSwimWorkoutPool(compiled.value.workout, poolCourse(25, 1, "m"))).toMatchObject({
      ok: true, value: { totalLengths: 14, estimatedMs: null, budget: { accountedMs: 80000 } },
    });
  });

  it("does not trim work to fit a budget or manufacture an unsupported pool conversion", () => {
    const input = source();
    const slow = {
      ...input, sections: input.sections.map((section) => section.kind === "main"
        ? { ...section, items: section.items.map((item) => ({ ...item, restSeconds: 900 })) } : section),
    };
    expect(compileSwimCourseWorkout(slow, poolCourse(50, 1, "m"), 30)).toMatchObject({
      ok: false, error: { code: "budget_impossible" },
    });
    expect(compileSwimCourseWorkout(input, poolCourse(25, 1, "yd"), 30).ok).toBe(false);
    expect(compileSwimCourseWorkout(input, poolCourse(50, 1, "m"), 0).ok).toBe(false);
  });

  it("round-trips editable source fields in the issued pool without changing the prescription", () => {
    const compiled = compileSwimCourseWorkout(source(), poolCourse(25, 1, "m"), 30);
    if (!compiled.ok) throw new Error("Synthetic course compilation failed");
    const editable = editableSwimCourseWorkout(source().title, compiled.value.workout);
    expect(compileSwimCourseWorkout(editable, poolCourse(25, 1, "m"), 30)).toMatchObject({
      ok: true, value: { workout: compiled.value.workout },
    });
  });

  it("rejects unavailable strokes and equipment rather than substituting the authored work", () => {
    expect(compileSwimCourseWorkout(source(), poolCourse(50, 1, "m"), 30, {
      knownStrokes: ["breaststroke"], equipment: [],
    }).ok).toBe(false);
    const input = source();
    const equipped = { ...input, sections: input.sections.map((section) => ({
      ...section, items: section.items.map((item) => ({ ...item, equipment: ["fins" as const] })),
    })) };
    expect(compileSwimCourseWorkout(equipped, poolCourse(50, 1, "m"), 30, {
      knownStrokes: ["freestyle"], equipment: [],
    }).ok).toBe(false);
  });

  it.each([-1, 0.5, Number.NaN, 86401])("rejects invalid explicit rest %s at the pure boundary", (restSeconds) => {
    const input = source();
    expect(compileSwimCourseWorkout({ ...input, sections: input.sections.map((section) => ({
      ...section, items: section.items.map((item) => ({ ...item, restSeconds })),
    })) }, poolCourse(50, 1, "m"), 30).ok).toBe(false);
  });
});
