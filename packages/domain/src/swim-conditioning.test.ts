import { describe, expect, it } from "vitest";
import {
  planSwimConditioningBindings, validateConditioningChoices,
  type SwimConditioningSlot, type SwimConditioningWorkout,
} from "./swim-conditioning";

const today = "2026-09-14";
const slot: SwimConditioningSlot = {
  id: "conditioning-1", date: today, slot: "single", role: "cardio",
  open: true, status: "planned", sessionId: null, swimWorkoutId: null,
};
const workout: SwimConditioningWorkout = { id: "swim-1", date: today, slot: "single" };
const bind = (slots = [slot], workouts = [workout]) =>
  planSwimConditioningBindings({ today, slots, workouts });

describe("conditioning choices", () => {
  it("DC-SW7 keeps programme weekdays and explicit activity choices without changing defaults", () => {
    expect(validateConditioningChoices([2, 5], [])).toEqual({ ok: true, value: [] });
    expect(validateConditioningChoices([2, 5], [
      { weekday: 5, activity: "swimming" }, { weekday: 2, activity: "running" },
    ])).toEqual({ ok: true, value: [
      { weekday: 2, activity: "running" }, { weekday: 5, activity: "swimming" },
    ] });
  });
  it("DC-SW5 refuses removed or duplicate assignments instead of silently dropping them", () => {
    expect(validateConditioningChoices([2], [{ weekday: 5, activity: "swimming" }]).ok).toBe(false);
    expect(validateConditioningChoices([2], [
      { weekday: 2, activity: "swimming" }, { weekday: 2, activity: "cycling" },
    ]).ok).toBe(false);
    expect(validateConditioningChoices([2, 2], []).ok).toBe(false);
    expect(validateConditioningChoices([7], []).ok).toBe(false);
  });
});

describe("primary conditioning swim bindings", () => {
  it("DC-SW5/SW7 binds today's unstarted swim to the existing session identity", () => {
    expect(bind()).toEqual({ ok: true, value: [{
      plannedSessionId: slot.id, swimWorkoutId: workout.id, date: today, slot: "single",
    }] });
    expect(bind([{ ...slot, swimWorkoutId: workout.id }])).toEqual(bind());
  });
  it.each([
    { role: "strength" }, { open: false }, { status: "done" }, { status: "skipped" },
    { sessionId: "started" }, { swimWorkoutId: "another-swim" },
  ])("DC-SW5/SW8 refuses an ineligible slot: %j", (change) => {
    expect(bind([{ ...slot, ...change }]).ok).toBe(false);
  });
  it("DC-SW5 leaves historical work alone", () => {
    expect(bind([{ ...slot, date: "2026-09-13" }], [{ ...workout, date: "2026-09-13" }]).ok).toBe(false);
  });
  it("DC-SW7/SW8 cannot bind a swim twice or use an ambiguous calendar slot", () => {
    expect(bind([slot, slot]).ok).toBe(false);
    expect(bind([slot, { ...slot, id: "other" }]).ok).toBe(false);
    expect(bind([slot], [workout, workout]).ok).toBe(false);
    expect(bind([slot], [workout, { ...workout, id: "other" }]).ok).toBe(false);
  });
  it("DC-SW3/SW5 refuses excess course workouts without returning a truncated plan", () => {
    expect(bind([slot], [workout, { ...workout, id: "later", date: "2026-09-21" }]).ok).toBe(false);
  });
  it("DC-SW7 does not guess between AM and PM", () => {
    expect(bind([{ ...slot, slot: "am" }]).ok).toBe(false);
    expect(bind([{ ...slot, slot: "am" }], [{ ...workout, slot: "am" }]).ok).toBe(true);
  });
  it("DC-SW5 keeps source order and does not mutate either input", () => {
    const later = { ...slot, id: "later-slot", date: "2026-09-16" };
    const laterWorkout = { ...workout, id: "later-swim", date: later.date };
    const slots = [later, slot], workouts = [workout, laterWorkout];
    const before = JSON.stringify({ slots, workouts });
    const result = bind(slots, workouts);
    expect(result.ok && result.value.map((row) => row.swimWorkoutId)).toEqual(["swim-1", "later-swim"]);
    expect(JSON.stringify({ slots, workouts })).toBe(before);
  });
  it("DC-SW5 validates real dates and permits an explicit empty assignment", () => {
    expect(bind([], [])).toEqual({ ok: true, value: [] });
    expect(bind([{ ...slot, date: "2026-02-30" }]).ok).toBe(false);
    expect(bind([slot], [{ ...workout, date: "2026-02-30" }]).ok).toBe(false);
  });
});
