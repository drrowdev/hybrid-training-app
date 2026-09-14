import { describe, expect, it } from "vitest";
import { swimRepeatGroups, swimRepeatProgress } from "./swim-workout-progress";
import type { SwimWorkout } from "./swimming";

const workout: SwimWorkout = {
  kind: "swim_workout", focus: "endurance", totalLengths: 12, estimatedMs: null,
  budget: { minutes: 30, accountedMs: 0 },
  snapshot: {
    course: { numerator: 25, denominator: 1, unit: "m" }, strokes: ["freestyle"], equipment: [],
    calibration: null, protocol: null, versions: { model: "one", generator: "one", assessment: null },
  },
  sections: [{
    kind: "main", label: "Main set", rounds: 2,
    items: [{ repeats: 3, lengths: 2, stroke: "freestyle", effort: "steady", equipment: [], optional: false }],
  }],
};

describe("DC-SW3 compact sets retain individual repeat progress", () => {
  it("groups by structural identity without changing round order or saved repeat IDs", () => {
    const groups = swimRepeatGroups(workout);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.round)).toEqual([1, 2]);
    expect(groups[0]!.repeatIds).toEqual(["0:0:0:0", "0:0:0:1", "0:0:0:2"]);
    expect(groups[1]!.repeatIds).toEqual(["0:1:0:0", "0:1:0:1", "0:1:0:2"]);
    expect(swimRepeatGroups({ ...workout, sections: [{ ...workout.sections[0]!, label: "Renamed" }] })
      .map((group) => group.repeatIds)).toEqual(groups.map((group) => group.repeatIds));
  });

  it("counts each checked repeat once and ignores other groups", () => {
    expect(swimRepeatProgress(["one", "two", "three"], ["two", "elsewhere", "two", "one"])).toEqual({
      completed: 2, total: 3, nextId: "three", undoId: "one",
    });
  });

  it("supports completing and undoing the final repeat", () => {
    const ids = ["one", "two"];
    const checked = ["one"];
    const next = swimRepeatProgress(ids, checked).nextId!;
    const completed = [...checked, next];
    expect(swimRepeatProgress(ids, completed)).toEqual({ completed: 2, total: 2, nextId: null, undoId: "two" });
    expect(swimRepeatProgress(ids, completed.filter((id) => id !== "two")).nextId).toBe("two");
  });
});
