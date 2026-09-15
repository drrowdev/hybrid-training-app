import { describe, expect, it } from "vitest";
import {
  planSwimConditioningBindings, planSwimConditioningEdit, remapConditioningChoices, validateConditioningChoices,
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

  describe("coordinated programme edits", () => {
    const workouts = [
      { ...workout, id: "a", plannedSessionId: "pa", date: "2026-09-16", weekIndex: 0, movable: true },
      { ...workout, id: "b", plannedSessionId: "pb", date: "2026-09-18", weekIndex: 0, movable: true },
    ];
    const slots = [
      { ...workout, id: "first", date: "2026-09-17", weekIndex: 0 },
      { ...workout, id: "second", date: "2026-09-19", weekIndex: 0 },
    ];
    it("DC-SW5/SW7 preserves activity order while moving weekday assignments", () => {
      expect(remapConditioningChoices([
        { weekday: 4, activity: "swimming" }, { weekday: 2, activity: "cycling" },
      ], [5, 3])).toEqual({ ok: true, value: [
        { weekday: 3, activity: "cycling" }, { weekday: 5, activity: "swimming" },
      ] });
      expect(remapConditioningChoices([{ weekday: 2, activity: "swimming" }], [3, 5]).ok).toBe(false);
      expect(remapConditioningChoices([{ weekday: 2, activity: "swimming" }], [7]).ok).toBe(false);
    });
    it("DC-SW5/SW7 moves future unstarted swims without replacing either identity or mutating inputs", () => {
      const before = JSON.stringify({ workouts, slots });
      expect(planSwimConditioningEdit({ today, workouts, slots })).toEqual({ ok: true, value: {
        moves: [
          { id: "a", plannedSessionId: "pa", date: "2026-09-17" },
          { id: "b", plannedSessionId: "pb", date: "2026-09-19" },
        ], claimedSlotIds: ["first", "second"],
      } });
      expect(JSON.stringify({ workouts, slots })).toBe(before);
    });
    it("DC-SW7 keeps past/today and settled or claimed work in place without regenerating duplicates", () => {
      const frozen = [{ ...workouts[0]!, date: today }, { ...workouts[1]!, movable: false }];
      expect(planSwimConditioningEdit({ today, workouts: frozen, slots })).toEqual({ ok: true, value: {
        moves: [], claimedSlotIds: ["first", "second"],
      } });
    });
    it("DC-SW5 refuses lost frequency, earlier dates, changed AM/PM slots and retained-work collisions", () => {
      expect(planSwimConditioningEdit({ today, workouts, slots: slots.slice(1) }).ok).toBe(false);
      expect(planSwimConditioningEdit({ today, workouts, slots: [{ ...slots[0]!, date: today }, slots[1]!] }).ok).toBe(false);
      expect(planSwimConditioningEdit({ today, workouts, slots: [{ ...slots[0]!, slot: "am" }, slots[1]!] }).ok).toBe(false);
      expect(planSwimConditioningEdit({ today, workouts: [{ ...workouts[0]!, movable: false }, workouts[1]!],
        slots: [{ ...slots[0]!, date: "2026-09-15" }, { ...slots[1]!, date: workouts[0]!.date }] }).ok).toBe(false);
    });
    it("DC-SW7 has no moves for unchanged placement and ignores wholly historical weeks", () => {
      expect(planSwimConditioningEdit({ today, workouts, slots: workouts }).ok).toBe(true);
      const result = planSwimConditioningEdit({ today: "2026-09-21", workouts, slots: [] });
      expect(result).toEqual({ ok: true, value: { moves: [], claimedSlotIds: [] } });
    });
    it("DC-SW8 refuses duplicate identities and invalid dates", () => {
      expect(planSwimConditioningEdit({ today, workouts: [workouts[0]!, workouts[0]!], slots }).ok).toBe(false);
      expect(planSwimConditioningEdit({ today, workouts, slots: [{ ...slots[0]!, date: "2026-02-30" }, slots[1]!] }).ok).toBe(false);
    });
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
