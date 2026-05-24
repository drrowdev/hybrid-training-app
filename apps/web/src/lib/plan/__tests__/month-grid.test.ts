/**
 * Pure-builder tests for `monthGridCells`.
 *
 * Spec-driven: the 7×6 grid always has exactly 42 cells, anchored
 * Monday→Sunday, with leading/trailing days from neighbouring months
 * filling the gaps.
 */
import { describe, it, expect } from "vitest";
import { monthGridCells, monthShift, parseMonthAnchor } from "../month-grid";

describe("monthGridCells", () => {
  it("always returns exactly 42 cells", () => {
    expect(monthGridCells(2026, 1).length).toBe(42);
    expect(monthGridCells(2026, 2).length).toBe(42);
    expect(monthGridCells(2026, 12).length).toBe(42);
    expect(monthGridCells(2024, 2).length).toBe(42); // leap year
  });

  it("May 2026 starts on Friday → pads with 4 days of April", () => {
    const cells = monthGridCells(2026, 5);
    // First cell should be Mon Apr 27 2026 (the Monday on/before May 1).
    expect(cells[0].date).toBe("2026-04-27");
    expect(cells[0].inMonth).toBe(false);
    expect(cells[1].date).toBe("2026-04-28");
    expect(cells[2].date).toBe("2026-04-29");
    expect(cells[3].date).toBe("2026-04-30");
    expect(cells[4].date).toBe("2026-05-01");
    expect(cells[4].inMonth).toBe(true);
    // 31 days in May → last in-month cell is at index 4+30 = 34.
    expect(cells[34].date).toBe("2026-05-31");
    expect(cells[34].inMonth).toBe(true);
    // Trailing pad continues into June.
    expect(cells[35].date).toBe("2026-06-01");
    expect(cells[35].inMonth).toBe(false);
    // Final cell is exactly 41 days after the start.
    expect(cells[41].date).toBe("2026-06-07");
  });

  it("Feb 2026 starts on Sunday → pads with 6 days of January", () => {
    const cells = monthGridCells(2026, 2);
    // Feb 1 2026 = Sunday → leading week is Jan 26 (Mon) … Feb 1 (Sun).
    expect(cells[0].date).toBe("2026-01-26");
    expect(cells[6].date).toBe("2026-02-01");
    expect(cells[6].inMonth).toBe(true);
  });

  it("flags only days inside (year, month) as inMonth: true", () => {
    const cells = monthGridCells(2026, 5);
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth.length).toBe(31);
    expect(inMonth[0].date).toBe("2026-05-01");
    expect(inMonth[inMonth.length - 1].date).toBe("2026-05-31");
  });
});

describe("monthShift", () => {
  it("rolls forward + backward across year boundaries", () => {
    expect(monthShift(2026, 1, -1)).toBe("2025-12-01");
    expect(monthShift(2026, 12, 1)).toBe("2027-01-01");
    expect(monthShift(2026, 5, 1)).toBe("2026-06-01");
  });
});

describe("parseMonthAnchor", () => {
  it("returns the date's year/month or the fallback", () => {
    expect(parseMonthAnchor("2026-05-15", "2026-01-01")).toEqual({ year: 2026, month: 5 });
    expect(parseMonthAnchor(undefined, "2026-01-01")).toEqual({ year: 2026, month: 1 });
    expect(parseMonthAnchor("garbage", "2026-01-01")).toEqual({ year: 2026, month: 1 });
  });
});
