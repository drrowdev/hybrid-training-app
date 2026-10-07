import { describe, expect, it } from "vitest";
import { authoredProgramDates, canChangeAuthoredStartDate, reconcileAuthoredStartDate, type AuthoredProgramDefinition } from "./authored-program";

const definition: AuthoredProgramDefinition = {
  version: 2, activity: "strength", name: "Weekly program",
  weeks: [
    { type: "Build", sets: "3", reps: "5", pct: 75 },
    { type: "Deload", sets: "2", reps: "5", pct: 60 },
  ],
  workouts: [0, 2, 4].map((weekday) => ({ id: `day-${weekday}`, name: "Workout", weekday, parts: [] })),
};
const existing = (start: string) => authoredProgramDates(definition, start).map((row, index) => ({
  id: `row-${index}`, programRef: row.ref, date: row.date, slot: "single",
  preserveContent: false, preserveDate: false,
}));

describe("DC-R5/DC-K4 saved authored start dates", () => {
  it("allows only an available, full-program edit with no begun workout", () => {
    for (const available of [false, true]) {
      for (const scope of ["program", "workout", "future"] as const) {
        for (const hasBegunWorkout of [false, true]) {
          expect(canChangeAuthoredStartDate({ available, scope, hasBegunWorkout }))
            .toBe(available && scope === "program" && !hasBegunWorkout);
        }
      }
    }
  });
  it.each(Array.from({ length: 7 }, (_, index) => index + 5))("keeps every authored week identity when moving from October %i to any weekday", (day) => {
    const before = existing(`2026-10-${String(day).padStart(2, "0")}`);
    for (let next = 12; next <= 18; next++) {
      const startedOn = `2026-10-${next}`;
      const proposed = authoredProgramDates(definition, startedOn);
      const result = reconcileAuthoredStartDate({ startedOn, existing: before, proposed });
      expect(result.insertIndices).toEqual([]);
      expect(result.deleteIndices).toEqual([]);
      expect(result.retained).toHaveLength(before.length);
      for (const row of result.retained) {
        const expected = proposed.find((entry) => entry.ref === before[row.existingIndex]!.programRef)!;
        expect(row).toMatchObject({ date: expected.date, weekIndex: expected.weekIndex, dayIndex: expected.dayIndex });
      }
      expect(result.weeks).toBe(Math.max(...proposed.map((row) => row.weekIndex)) + 1);
    }
  });
  it("keeps manually chosen dates while moving annotated or customised workout identities", () => {
    const before = existing("2026-10-05");
    before[0] = { ...before[0]!, date: "2026-10-20", preserveDate: true, preserveContent: true };
    before[1] = { ...before[1]!, preserveContent: true };
    const result = reconcileAuthoredStartDate({
      startedOn: "2026-10-12", existing: before, proposed: authoredProgramDates(definition, "2026-10-12"),
    });
    expect(result.retained[0]).toMatchObject({ existingIndex: 0, date: "2026-10-20", weekIndex: 1, dayIndex: 1 });
    expect(result.retained[1]).toMatchObject({ existingIndex: 1, date: "2026-10-14" });
    expect(result.deleteIndices).toEqual([]);
  });
  it("preserves invested rows removed from the definition and deletes only pristine removed rows", () => {
    const before = existing("2026-10-05");
    before[0] = { ...before[0]!, preserveContent: true };
    const result = reconcileAuthoredStartDate({
      startedOn: "2026-10-05", existing: before,
      proposed: authoredProgramDates({ ...definition, workouts: definition.workouts.slice(1) }, "2026-10-05"),
    });
    expect(result.retained[0]).toMatchObject({ existingIndex: 0, date: "2026-10-05", proposedIndex: undefined });
    expect(result.deleteIndices).toEqual([3]);
    expect(result.insertIndices).toEqual([]);
  });
  it("adds new authored weeks without regenerating retained workout rows", () => {
    const proposed = authoredProgramDates({ ...definition, weeks: [...definition.weeks, definition.weeks[0]!] }, "2026-10-12");
    const result = reconcileAuthoredStartDate({ startedOn: "2026-10-12", existing: existing("2026-10-05"), proposed });
    expect(result.retained).toHaveLength(6);
    expect(result.insertIndices.map((index) => proposed[index]!.authoredWeekIndex)).toEqual([2, 2, 2]);
    expect(result.deleteIndices).toEqual([]);
  });
  it("rejects collisions and impossible preserved dates rather than discarding user state", () => {
    const before = existing("2026-10-05");
    const args = { startedOn: "2026-10-12", existing: before, proposed: authoredProgramDates(definition, "2026-10-12") };
    before[0] = { ...before[0]!, date: "2026-10-14", preserveDate: true };
    expect(() => reconcileAuthoredStartDate(args)).toThrow();
    before[0] = { ...before[0]!, date: "2026-10-05" };
    expect(() => reconcileAuthoredStartDate(args)).toThrow();
    before[0] = { ...before[0]!, date: "2027-10-11" };
    expect(() => reconcileAuthoredStartDate(args)).toThrow();
  });
  it("refuses ambiguous identities and invalid dates", () => {
    const before = existing("2026-10-05");
    const proposed = authoredProgramDates(definition, "2026-10-12");
    expect(() => reconcileAuthoredStartDate({ startedOn: "2026-02-30", existing: before, proposed })).toThrow();
    expect(() => reconcileAuthoredStartDate({ startedOn: "2026-10-12", existing: [...before, before[0]!], proposed })).toThrow();
    expect(() => reconcileAuthoredStartDate({ startedOn: "2026-10-12", existing: before, proposed: [...proposed, proposed[0]!] })).toThrow();
  });
});
