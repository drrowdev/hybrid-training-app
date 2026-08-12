import { describe, it, expect } from "vitest";
import {
  planForwardOnlyRewrite,
  prescriptionsEquivalent,
  type ExistingFutureRow,
  type NewSessionLite,
} from "../forward-rewrite";

function strengthWeek(week: number, days: number[]): NewSessionLite[] {
  return days.map((d) => ({ weekIndex: week, dayIndex: d, slot: "single" }));
}

describe("planForwardOnlyRewrite", () => {
  it("freezes weeks <= currentWeekIndex and only regenerates the future", () => {
    // A 4-week block, currently in week 1. New plan keeps the same shape.
    const newSessions: NewSessionLite[] = [0, 1, 2, 3].flatMap((w) =>
      strengthWeek(w, [0, 2, 4]),
    );
    const existingFuture: ExistingFutureRow[] = [2, 3].flatMap((w) =>
      [0, 2, 4].map((d) => ({ id: `r${w}-${d}`, weekIndex: w, dayIndex: d, slot: "single", touched: false })),
    );

    const plan = planForwardOnlyRewrite({
      currentWeekIndex: 1,
      currentDayIndex: 6,
      writeWeeks: 4,
      existingFuture,
      newSessions,
    });

    describe("prescriptionsEquivalent", () => {
      it("ignores object key order but detects prescription changes", () => {
        const canonical = {
          programRef: "rehab-w1-d0",
          items: [{ movementId: "hip-adduction", sets: 5, reps: 15 }],
        };
        const reordered = {
          items: [{ reps: 15, sets: 5, movementId: "hip-adduction" }],
          programRef: "rehab-w1-d0",
        };
        const removed = {
          programRef: "rehab-w1-d0",
          items: [],
        };

        expect(prescriptionsEquivalent(canonical, reordered)).toBe(true);
        expect(prescriptionsEquivalent(canonical, removed)).toBe(false);
      });
    });

    // Every future row (weeks 2,3) is untouched → deletable; weeks 0,1 untouched.
    expect(plan.deleteIds.sort()).toEqual(existingFuture.map((r) => r.id).sort());
    // Inserts are exactly the new sessions in weeks 2 and 3 (6 of them).
    expect(plan.insertIndices).toHaveLength(6);
    for (const i of plan.insertIndices) expect(newSessions[i]!.weekIndex).toBeGreaterThan(1);
    expect(plan.newWeeks).toBe(4);
  });

  it("adds new cardio days to future weeks without touching strength rows", () => {
    // Strength on Mon/Wed/Fri, adding a Sun cardio day. Current week 0.
    const newSessions: NewSessionLite[] = [0, 1].flatMap((w) => [
      ...strengthWeek(w, [0, 2, 4]),
      { weekIndex: w, dayIndex: 6, slot: "single" }, // cardio
    ]);
    const existingFuture: ExistingFutureRow[] = [1].flatMap((w) =>
      [0, 2, 4].map((d) => ({ id: `s${w}-${d}`, weekIndex: w, dayIndex: d, slot: "single", touched: false })),
    );

    const plan = planForwardOnlyRewrite({
      currentWeekIndex: 0,
      currentDayIndex: 6,
      writeWeeks: 2,
      existingFuture,
      newSessions,
    });

    // Week-1 strength rows are deleted+re-created; the new cardio row is inserted.
    expect(plan.deleteIds).toEqual(["s1-0", "s1-2", "s1-4"]);
    const inserted = plan.insertIndices.map((i) => newSessions[i]!);
    expect(inserted.every((s) => s.weekIndex === 1)).toBe(true);
    expect(inserted.some((s) => s.dayIndex === 6)).toBe(true); // cardio added
    expect(inserted).toHaveLength(4); // 3 strength + 1 cardio
  });

  it("preserves a future row that was started/skipped and never re-inserts its slot", () => {
    const newSessions: NewSessionLite[] = strengthWeek(2, [0, 2, 4]);
    const existingFuture: ExistingFutureRow[] = [
      { id: "logged", weekIndex: 2, dayIndex: 0, slot: "single", touched: true },
      { id: "open", weekIndex: 2, dayIndex: 2, slot: "single", touched: false },
    ];

    const plan = planForwardOnlyRewrite({
      currentWeekIndex: 1,
      currentDayIndex: 6,
      writeWeeks: 3,
      existingFuture,
      newSessions,
    });

    // The touched row is kept (not deleted); only the open row is cleared.
    expect(plan.deleteIds).toEqual(["open"]);
    // The preserved (w2,d0) slot is NOT re-inserted; d2 + d4 are.
    const inserted = plan.insertIndices.map((i) => newSessions[i]!);
    expect(inserted.map((s) => s.dayIndex).sort()).toEqual([2, 4]);
  });

  it("extends newWeeks when the new plan is longer, and never shrinks below the current week", () => {
    expect(
      planForwardOnlyRewrite({ currentWeekIndex: 1, currentDayIndex: 6, writeWeeks: 6, existingFuture: [], newSessions: [] }).newWeeks,
    ).toBe(6);
    // A shorter new plan can't erase elapsed weeks.
    expect(
      planForwardOnlyRewrite({ currentWeekIndex: 5, currentDayIndex: 6, writeWeeks: 3, existingFuture: [], newSessions: [] }).newWeeks,
    ).toBe(6);
  });

  it("regenerates untouched sessions later in the current week", () => {
    const newSessions: NewSessionLite[] = [
      ...strengthWeek(1, [0, 3, 5]),
      ...strengthWeek(2, [0, 3, 5]),
    ];
    const existingFuture: ExistingFutureRow[] = [
      { id: "past", weekIndex: 1, dayIndex: 0, slot: "single", touched: false },
      { id: "today", weekIndex: 1, dayIndex: 2, slot: "single", touched: false },
      { id: "later-a", weekIndex: 1, dayIndex: 4, slot: "single", touched: false },
      { id: "later-b", weekIndex: 1, dayIndex: 6, slot: "single", touched: false },
      { id: "next", weekIndex: 2, dayIndex: 0, slot: "single", touched: false },
    ];

    const plan = planForwardOnlyRewrite({
      currentWeekIndex: 1,
      currentDayIndex: 2,
      writeWeeks: 3,
      existingFuture,
      newSessions,
    });

    expect(plan.deleteIds.sort()).toEqual(["later-a", "later-b", "next"]);
    const inserted = plan.insertIndices.map((index) => newSessions[index]!);
    expect(inserted).toEqual([
      { weekIndex: 1, dayIndex: 3, slot: "single" },
      { weekIndex: 1, dayIndex: 5, slot: "single" },
      { weekIndex: 2, dayIndex: 0, slot: "single" },
      { weekIndex: 2, dayIndex: 3, slot: "single" },
      { weekIndex: 2, dayIndex: 5, slot: "single" },
    ]);
  });

  it("preserves a touched upcoming session in the current week", () => {
    const newSessions = strengthWeek(0, [4, 6]);
    const plan = planForwardOnlyRewrite({
      currentWeekIndex: 0,
      currentDayIndex: 2,
      writeWeeks: 1,
      existingFuture: [
        {
          id: "started-friday",
          weekIndex: 0,
          dayIndex: 4,
          slot: "single",
          touched: true,
        },
        {
          id: "open-sunday",
          weekIndex: 0,
          dayIndex: 6,
          slot: "single",
          touched: false,
        },
      ],
      newSessions,
    });

    expect(plan.deleteIds).toEqual(["open-sunday"]);
    expect(
      plan.insertIndices.map((index) => newSessions[index]!.dayIndex),
    ).toEqual([6]);
  });

  it("removes an untouched legacy rehab slot when it is embedded into today's strength", () => {
    const newSessions: NewSessionLite[] = [
      {
        weekIndex: 1,
        dayIndex: 0,
        slot: "single",
        role: "strength",
      },
    ];
    const plan = planForwardOnlyRewrite({
      currentWeekIndex: 1,
      currentDayIndex: 0,
      writeWeeks: 3,
      existingFuture: [
        {
          id: "today-strength",
          weekIndex: 1,
          dayIndex: 0,
          slot: "single",
          role: "strength",
          touched: false,
        },
        {
          id: "today-rehab",
          weekIndex: 1,
          dayIndex: 0,
          slot: "pm",
          role: "rehab",
          touched: false,
        },
      ],
      newSessions,
    });

    expect(plan.deleteIds).toEqual(["today-rehab"]);
    expect(plan.insertIndices).toEqual([]);
  });

  it("preserves a started rehab slot today", () => {
    const newSessions: NewSessionLite[] = [
      {
        weekIndex: 1,
        dayIndex: 0,
        slot: "pm",
        role: "rehab",
      },
    ];
    const plan = planForwardOnlyRewrite({
      currentWeekIndex: 1,
      currentDayIndex: 0,
      writeWeeks: 3,
      existingFuture: [
        {
          id: "started-rehab",
          weekIndex: 1,
          dayIndex: 0,
          slot: "pm",
          role: "rehab",
          touched: true,
        },
      ],
      newSessions,
    });

    expect(plan.deleteIds).toEqual([]);
    expect(plan.insertIndices).toEqual([]);
  });

  it("rewrites week zero when the block has not started yet", () => {
    const newSessions = strengthWeek(0, [1, 3, 5]);
    const plan = planForwardOnlyRewrite({
      currentWeekIndex: 0,
      currentDayIndex: -1,
      writeWeeks: 1,
      existingFuture: [
        {
          id: "old",
          weekIndex: 0,
          dayIndex: 0,
          slot: "single",
          touched: false,
        },
      ],
      newSessions,
    });
    expect(plan.deleteIds).toEqual(["old"]);
    expect(plan.insertIndices).toEqual([0, 1, 2]);
  });
});
