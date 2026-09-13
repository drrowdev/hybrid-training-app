import { describe, expect, it } from "vitest";
import { swimCourseWorkoutKey, swimCourseWorkoutTitle } from "./swim-course";
import { poolCourse, validateSwimSetup, type SwimSetup } from "./swimming";

describe("DC-SW3/SW5 private course presentation and setup", () => {
  it("names repeated swims by their immutable source position, not difficulty or dates", () => {
    expect(swimCourseWorkoutTitle("Week 1", swimCourseWorkoutKey(0, 0))).toBe("Week 1 A");
    expect(swimCourseWorkoutTitle("Week 1", swimCourseWorkoutKey(0, 1))).toBe("Week 1 B");
    expect(swimCourseWorkoutTitle("Endurance", swimCourseWorkoutKey(1, 0))).toBe("Week 2 A · Endurance");
    expect(swimCourseWorkoutTitle("Week 16", swimCourseWorkoutKey(15, 6))).toBe("Week 16 G");
  });

  it.each(["swim-2026-09-14", "course-16-0", "course-0-7", "course-0--1"])("rejects an invalid source slot %s", (slot) => {
    expect(() => swimCourseWorkoutTitle("Practice", slot)).toThrow();
  });

  it("accepts an explicit untimed course but still requires budgets for generated plans", () => {
    const setup: SwimSetup<null> = {
      goal: "endurance", experience: "recreational", course: poolCourse(50, 1, "m"),
      knownStrokes: ["freestyle"], equipment: [], recentComfortableLengths: 4, sessionBudgetMinutes: null,
    };
    expect(validateSwimSetup(setup, true)).toEqual([]);
    expect(validateSwimSetup(setup)).toContainEqual(expect.objectContaining({ field: "sessionBudgetMinutes", severity: "blocking" }));
    expect(validateSwimSetup({ ...setup, knownStrokes: [] }, true)).toContainEqual(expect.objectContaining({ field: "knownStrokes", severity: "blocking" }));
  });
});
