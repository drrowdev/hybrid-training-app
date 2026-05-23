/**
 * PRs-this-month dedup logic unit tests.
 *
 * The DB wrapper (`getMonthlyPrs`) walks each in-month session, runs the
 * canonical `detectPrs` against the full prior history, and collects
 * per-(movement × session) hits. `selectTopMonthlyE1RmPrs` is the pure
 * tail: it keeps one row per movement (strongest e1RM-PR hit), sorts
 * desc by hit value, and returns the top N. These tests pin that
 * behaviour so the dashboard never double-counts a movement that hit
 * multiple PRs in the same month.
 */
import { describe, it, expect } from "vitest";
import { selectTopMonthlyE1RmPrs, type MonthlyPr } from "../prs-this-month";

function hit(value: number) {
  return { kind: "e1rm" as const, value, previousBest: null, daysSincePrevious: null };
}

const baseRow: Omit<MonthlyPr, "movementId" | "movementDisplayName" | "movementSlug" | "hit" | "date"> = {
  weight: 100,
  reps: 5,
};

describe("selectTopMonthlyE1RmPrs", () => {
  it("counts unique movements only (one row per movement, keeping the strongest)", () => {
    const hits: MonthlyPr[] = [
      {
        ...baseRow,
        movementId: "squat",
        movementSlug: "back-squat-high-bar",
        movementDisplayName: "Back Squat",
        date: "2026-05-05",
        hit: hit(120),
      },
      {
        ...baseRow,
        movementId: "squat",
        movementSlug: "back-squat-high-bar",
        movementDisplayName: "Back Squat",
        date: "2026-05-12",
        hit: hit(125), // strongest squat hit this month
      },
      {
        ...baseRow,
        movementId: "deadlift",
        movementSlug: "conventional-deadlift",
        movementDisplayName: "Conventional Deadlift",
        date: "2026-05-09",
        hit: hit(180),
      },
    ];
    const r = selectTopMonthlyE1RmPrs(hits);
    expect(r.uniqueMovementCount).toBe(2);
    // Top 3 sorted desc by hit value.
    expect(r.topThree.map((p) => p.movementId)).toEqual(["deadlift", "squat"]);
    expect(r.topThree[1].hit.value).toBe(125);
  });

  it("ignores non-e1RM hits", () => {
    const hits: MonthlyPr[] = [
      {
        ...baseRow,
        movementId: "bench",
        movementSlug: "bench-press-flat",
        movementDisplayName: "Bench Press",
        date: "2026-05-09",
        hit: { kind: "weight", value: 110, previousBest: null, daysSincePrevious: null },
      },
    ];
    const r = selectTopMonthlyE1RmPrs(hits);
    expect(r.uniqueMovementCount).toBe(0);
    expect(r.topThree).toHaveLength(0);
  });

  it("caps the visible list at top 3 by default but counts uniques honestly", () => {
    const hits: MonthlyPr[] = Array.from({ length: 5 }, (_, i) => ({
      ...baseRow,
      movementId: `m${i}`,
      movementSlug: `slug-${i}`,
      movementDisplayName: `Movement ${i}`,
      date: "2026-05-09",
      hit: hit(100 + i),
    }));
    const r = selectTopMonthlyE1RmPrs(hits);
    expect(r.uniqueMovementCount).toBe(5);
    expect(r.topThree).toHaveLength(3);
    expect(r.topThree.map((p) => p.hit.value)).toEqual([104, 103, 102]);
  });
});
