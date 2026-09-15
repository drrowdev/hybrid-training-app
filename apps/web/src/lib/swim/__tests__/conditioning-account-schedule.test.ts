import { describe, expect, it } from "vitest";
import { planSwimConditioningBindings, planSwimConditioningEdit } from "@hta/domain";
import { conditioningFixtureSchedule } from "../../../../scripts/swim-conditioning-account-flow-fixture";
import { planConditioningCourse } from "../conditioning-input";
import { syntheticCourse } from "./course-fixtures";

describe("DC-SW3/SW5 account journey uses real, fitting dates", () => {
  it.each(Array.from({ length: 7 }, (_, day) => `2026-09-${14 + day}`))(
    "creates and edits the full fixture on %s without past starts or week overflow", (today) => {
      const schedule = conditioningFixtureSchedule(today);
      const { swimDays, todayDay, editFrom, editTo } = schedule;
      const workout = syntheticCourse().weeks[0]!.workouts[0]!;
      const course = planConditioningCourse({
        kind: "course", courseFile: JSON.stringify({ ...syntheticCourse(),
          weeks: Array.from({ length: 6 }, () => ({ workouts: swimDays.map(() => workout) })),
        }), pool: "25m", experience: "regular", comfortableLengths: 4,
        strokes: ["freestyle"], equipment: [], poolChoices: [], reviewed: true, acceptSetTotals: false,
      }, today, swimDays);
      const monday = Date.parse(`${today}T00:00:00Z`) - todayDay * 86_400_000;
      const date = (week: number, day: number) => new Date(monday + (week * 7 + day) * 86_400_000).toISOString().slice(0, 10);
      const slots = Array.from({ length: 6 }, (_, weekIndex) => swimDays.map((day) => ({
        id: `${weekIndex}:${day}`, date: date(weekIndex, day), slot: "single" as const, role: "cardio",
        open: true, status: "planned", sessionId: null, swimWorkoutId: null, weekIndex,
      }))).flat();
      const workouts = course.workouts.map((row, index) => ({
        id: String(index), date: row.scheduled_date, slot: row.slot,
      }));
      expect(course.definition.schedule.startDate).toBe(today);
      expect(workouts).toHaveLength(schedule.workoutCount);
      expect(workouts[0]!.date).toBe(today);
      expect(workouts.every((row) => row.date >= today && row.date <= date(5, 6))).toBe(true);
      const binding = planSwimConditioningBindings({ today, slots, workouts });
      expect(binding.ok).toBe(true);
      if (!binding.ok) throw new Error("fixture_binding");
      const bound = workouts.map((row) => {
        const link = binding.value.find((entry) => entry.swimWorkoutId === row.id)!;
        return { ...row, plannedSessionId: link.plannedSessionId,
          weekIndex: slots.find((slot) => slot.id === link.plannedSessionId)!.weekIndex,
          movable: row.date > today };
      });
      const targets = slots.map((slot) => ({
        ...slot, date: slot.id.endsWith(`:${editFrom}`) ? date(slot.weekIndex, editTo) : slot.date,
      }));
      const edited = planSwimConditioningEdit({ today, workouts: bound, slots: targets });
      expect(edited.ok).toBe(true);
      if (!edited.ok) throw new Error("fixture_edit");
      expect(edited.value.moves.length).toBeGreaterThan(0);
      expect(edited.value.moves.some((move) => move.id === workouts[0]!.id)).toBe(false);
      expect(edited.value.moves.every((move) => move.date > today && move.date <= date(5, 6))).toBe(true);
      expect(schedule.strengthDays).toHaveLength(3);
      expect(schedule.strengthDays.some((day) => swimDays.includes(day) || day === editTo)).toBe(false);
    });
  it.each(["2026-02-30", "not-a-date"])("refuses invalid fixture date %s", (today) => {
    expect(() => conditioningFixtureSchedule(today)).toThrow();
  });
});
