import { describe, expect, it } from "vitest";
import { authoredTestRule, authoredExecutionParts, authoredPartComplete, authoredProgramDates, authoredWorkoutActivities, compileAuthoredWorkout, type AuthoredProgramDefinition, type AuthoredWorkout } from "./authored-program";
import { trainingScheduleAdvice } from "./training-schedule";

const lift = { id: "squat", slug: "back-squat", displayName: "Back squat", pattern: "squat" };
const run = { id: "run", slug: "running", displayName: "Running", pattern: "cardio", modality: "run" };
const workout: AuthoredWorkout = {
  id: "a", name: "Stations and running", weekday: 0, parts: [
    { id: "lift", kind: "movement", movement: {
      id: "m", movementId: lift.id, role: "main", sets: 3, dose: { kind: "reps", reps: 5 },
      weightKg: 0, restSeconds: 90, notes: "",
    } },
    { id: "run", kind: "cardio", movementId: run.id, modality: "run", intensity: "vo2", repeats: 4, notes: "", intervals: [
      { id: "work", label: "Run", target: { kind: "distance", metres: 400 }, effort: "hard" },
      { id: "rest", label: "Recovery", target: { kind: "time", seconds: 90 }, effort: "recovery" },
    ] },
  ],
};

describe("DC-K4/DC-R3 authored programs", () => {
  it("DC-K4: activity filters project mixed work without splitting its identity", () => {
    expect(authoredWorkoutActivities(workout)).toEqual(["strength", "running"]);
    expect(workout.id).toBe("a");
    expect(authoredWorkoutActivities({ ...workout, parts: [workout.parts[1]!] })).toEqual(["running"]);
  });
  it("keeps mixed work in one executable prescription with actual library identities", () => {
    const result = compileAuthoredWorkout(workout, [lift, run]);
    expect(result.items).toHaveLength(4);
    expect(result.items.slice(0, 3).every((item) => item.movementId === lift.id && item.sets === 1 && item.targetWeightKg === 0)).toBe(true);
    expect(result.items[3]).toMatchObject({ movementId: run.id, meta: { repeats: 4, intervals: workout.parts[1]?.kind === "cardio" ? workout.parts[1].intervals : [] } });
    expect(result.items[3]?.durationMin).toBeUndefined();
  });
  it("rejects absent or wrong-modality movement IDs instead of inferring names", () => {
    expect(() => compileAuthoredWorkout(workout, [run])).toThrow("library");
    expect(() => compileAuthoredWorkout(workout, [lift, { ...run, modality: "swim" }])).toThrow("matching");
  });
  it("expands circuit rounds into independently loggable sets with round identity", () => {
    const first = workout.parts[0];
    if (first?.kind !== "movement") throw new Error("fixture");
    const result = compileAuthoredWorkout({ ...workout, parts: [{
      id: "c", kind: "circuit", name: "Circuit", rounds: 3,
      movements: [first.movement, { ...first.movement, id: "hold", dose: { kind: "hold", seconds: 30 } }],
    }] }, [lift]);
    expect(result.items).toHaveLength(6);
    expect(result.items.map((item) => item.circuit?.round)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(result.items[3]?.holdSec).toEqual({ min: 30, max: 30 });
    expect(result.items[3]?.reps).toBeUndefined();
  });
  it("does not backdate the first week when starting midweek", () => {
    const definition: AuthoredProgramDefinition = { version: 1, activity: "hybrid", name: "Week", weeks: 2, workouts: [workout, { ...workout, id: "b", weekday: 4 }] };
    expect(authoredProgramDates(definition, "2026-09-23").map(({ date, weekIndex }) => [date, weekIndex])).toEqual([
      ["2026-09-25", 0], ["2026-09-28", 1], ["2026-10-02", 1], ["2026-10-05", 2],
    ]);
  });
  it("DC-K4 retains ordered mixed part identities and requires every prescribed set or cardio part", () => {
    const parts = authoredExecutionParts(compileAuthoredWorkout(workout, [lift, run]).items);
    expect(parts.map(({ id, kind, itemIndices }) => ({ id, kind, itemIndices }))).toEqual([
      { id: "lift", kind: "movement", itemIndices: [0, 1, 2] },
      { id: "run", kind: "cardio", itemIndices: [3] },
    ]);
    expect(authoredPartComplete(parts[0]!, new Set([0, 1]), new Set([4]))).toBe(false);
    expect(authoredPartComplete(parts[0]!, new Set([0, 1, 2]), new Set())).toBe(true);
    expect(authoredPartComplete(parts[1]!, new Set([3]), new Set([0]))).toBe(false);
    expect(authoredPartComplete(parts[1]!, new Set(), new Set([4]))).toBe(true);
  });
  it("DC-K4 stamps rehab explicitly and refuses invalid date horizons", () => {
    const first = workout.parts[0];
    if (first?.kind !== "movement") throw new Error("fixture");
    const compiled = compileAuthoredWorkout({ ...workout, parts: [{ ...first, movement: { ...first.movement, role: "tendon" } }] }, [lift]);
    expect(compiled.items.every((item) => item.meta.rehab === true && item.meta.restSeconds === 90)).toBe(true);
    const definition: AuthoredProgramDefinition = { version: 1, name: "Week", activity: "strength", weeks: 1, workouts: [workout] };
    expect(() => authoredProgramDates({ ...definition, weeks: 0 }, "2026-09-23")).toThrow();
    expect(() => authoredProgramDates({ ...definition, weeks: 17 }, "2026-09-23")).toThrow();
    expect(() => authoredProgramDates(definition, "2026-02-30")).toThrow();
  });
});

describe("DC-K4/DC-SW7 independent schedule advice", () => {
  it("retains already accepted overlap for in-place edits but reviews new dates and replacement", () => {
    const entries = [
      { id: "a", source: "primary" as const, programId: "p", date: "2026-09-23", title: "Strength", state: "scheduled" as const },
      { id: "b", source: "swim" as const, programId: "s", date: "2026-09-23", title: "Swim", state: "scheduled" as const },
      { id: "c", source: "swim" as const, programId: "s", date: "2026-09-24", title: "Swim", state: "scheduled" as const },
    ];
    const dates = ["2026-09-23", "2026-09-24"];
    expect(trainingScheduleAdvice(entries, dates, { source: "primary", programId: "p", retainExistingOverlaps: true })
      .overlaps.map((entry) => entry.id)).toEqual(["c"]);
    expect(trainingScheduleAdvice(entries, dates, { source: "primary", programId: "p" })
      .overlaps.map((entry) => entry.id)).toEqual(["b", "c"]);
  });
  it("uses exact dates, excludes only the replaced program and distinguishes planned rest", () => {
    expect(trainingScheduleAdvice([
      { id: "a", source: "primary", programId: "p", date: "2026-09-23", title: "Strength", state: "scheduled" },
      { id: "b", source: "swim", programId: "s", date: "2026-09-23", title: "Swim", state: "scheduled" },
      { id: "c", source: "session", programId: null, date: "2026-09-23", title: "Rehab", state: "started" },
      { id: "d", source: "primary", programId: "other", date: "2026-09-24", title: "Rest", state: "rest" },
    ], ["2026-09-23", "2026-09-24"], { source: "primary", programId: "p" })).toMatchObject({
      overlaps: [{ id: "b" }, { id: "c" }], plannedRest: [{ id: "d" }],
    });
  });
});

describe("DC-K4 authored test-week rule", () => {
  const test = (extra: Record<string, unknown> = {}) => ({ type: "Test" as const, sets: "1", reps: "3", pct: 95, ...extra });
  const main = (load?: { kind: "pct"; value: number }): AuthoredWorkout => ({
    id: "t", name: "Test day", weekday: 0, parts: [{ id: "p", kind: "movement", movement: {
      id: "m", movementId: lift.id, role: "main", sets: 1, dose: { kind: "reps", reps: 3 }, weightKg: 0, restSeconds: 180, notes: "",
      ...(load ? { load } : {}),
    } }],
  });
  it("DC-K4: only a Test week with a usable rule yields one", () => {
    expect(authoredTestRule(test({ after: "updateFromLoggedSet" }))).toEqual({ after: "updateFromLoggedSet" });
    expect(authoredTestRule(test({ after: "fixedIncrease", stepKg: 5 }))).toEqual({ after: "fixedIncrease", stepKg: 5 });
    expect(authoredTestRule(test({ after: "fixedIncrease" }))).toBeNull();
    expect(authoredTestRule(test({ after: "keep" }))).toBeNull();
    expect(authoredTestRule(test())).toBeNull();
    expect(authoredTestRule({ ...test({ after: "updateFromLoggedSet" }), type: "Build" })).toBeNull();
    expect(authoredTestRule(undefined)).toBeNull();
  });
  it("DC-K4: marks percentage-loaded main sets of a Test week and nothing else", () => {
    const marked = compileAuthoredWorkout(main({ kind: "pct", value: 95 }), [lift], undefined, test({ after: "updateFromLoggedSet" }));
    expect(marked.items[0]?.meta).toMatchObject({ authoredTest: { after: "updateFromLoggedSet" } });
    expect(compileAuthoredWorkout(main({ kind: "pct", value: 95 }), [lift], undefined, test({ after: "keep" })).items[0]?.meta).not.toHaveProperty("authoredTest");
    expect(compileAuthoredWorkout(main({ kind: "pct", value: 95 }), [lift], undefined, { ...test({ after: "updateFromLoggedSet" }), type: "Build" }).items[0]?.meta).not.toHaveProperty("authoredTest");
    const accessory = main(); const part = accessory.parts[0];
    if (part?.kind !== "movement") throw new Error("fixture");
    part.movement.role = "accessory";
    expect(compileAuthoredWorkout(accessory, [lift], undefined, test({ after: "updateFromLoggedSet" })).items[0]?.meta).not.toHaveProperty("authoredTest");
  });
});