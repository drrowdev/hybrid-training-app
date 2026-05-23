/**
 * Pure-builder tests for `buildHeatmap` — the data fetcher's Supabase
 * call is a mechanical pass-through, so we drive deterministic
 * inputs here and assert the grid layout + state precedence.
 */
import { describe, it, expect } from "vitest";
import { buildHeatmap, type HeatmapCell } from "./training-heatmap-data";
import { addDaysToYmd, mondayOfYmd } from "@/lib/dates";

const TODAY = "2026-05-23"; // Saturday — Monday of this week = 2026-05-18.
const WEEKS = 20;

function findCell(cells: HeatmapCell[], date: string): HeatmapCell {
  const cell = cells.find((c) => c.date === date);
  if (!cell) throw new Error(`no cell for ${date}`);
  return cell;
}

describe("buildHeatmap", () => {
  it("renders an empty 7×N grid when no input is given", () => {
    const cells = buildHeatmap({ today: TODAY, weeks: WEEKS, sessions: [], planned: [] });
    expect(cells.length).toBe(WEEKS * 7);
    expect(cells.every((c) => c.state === "empty")).toBe(true);
    // Leftmost column is the oldest Monday, rightmost is current week.
    const expectedEarliest = addDaysToYmd(mondayOfYmd(TODAY), -(WEEKS - 1) * 7);
    expect(cells[0].date).toBe(expectedEarliest);
    expect(cells[0].weekIndex).toBe(0);
    expect(cells[0].dayIndex).toBe(0);
    // Last row in last column = Sunday of current ISO week.
    const last = cells[cells.length - 1];
    expect(last.weekIndex).toBe(WEEKS - 1);
    expect(last.dayIndex).toBe(6);
    expect(last.date).toBe(addDaysToYmd(mondayOfYmd(TODAY), 6));
  });

  it("collapses a strength session + a cardio session on the same day into 'both'", () => {
    const cells = buildHeatmap({
      today: TODAY,
      weeks: WEEKS,
      sessions: [
        {
          id: "s1",
          performedYmd: TODAY,
          title: "Squat day",
          isStrength: true,
          isCardio: false,
        },
        {
          id: "c1",
          performedYmd: TODAY,
          title: "Z2 ride",
          isStrength: false,
          isCardio: true,
          cardioSummary: "cycling · 45min",
        },
      ],
      planned: [],
    });
    const today = findCell(cells, TODAY);
    expect(today.state).toBe("both");
    expect(today.isToday).toBe(true);
    expect(today.sessionIds).toEqual(["s1", "c1"]);
    expect(today.titles).toContain("Squat day");
    expect(today.titles.some((t) => t.includes("Z2 ride"))).toBe(true);
  });

  it("marks past planned-not-done as 'missed'", () => {
    const missedDate = addDaysToYmd(TODAY, -3);
    const cells = buildHeatmap({
      today: TODAY,
      weeks: WEEKS,
      sessions: [],
      planned: [
        {
          date: missedDate,
          title: "Heavy press",
          completedSessionId: null,
          skippedAt: null,
        },
      ],
    });
    const cell = findCell(cells, missedDate);
    expect(cell.state).toBe("missed");
    expect(cell.titles[0]).toContain("Heavy press");
  });

  it("flags today's date with isToday=true and isFuture=false", () => {
    const cells = buildHeatmap({ today: TODAY, weeks: WEEKS, sessions: [], planned: [] });
    const today = findCell(cells, TODAY);
    expect(today.isToday).toBe(true);
    expect(today.isFuture).toBe(false);
    // Tomorrow lives in the same (current) week column, so it's
    // present in the grid and flagged as future.
    const tomorrow = findCell(cells, addDaysToYmd(TODAY, 1));
    expect(tomorrow.isFuture).toBe(true);
    expect(tomorrow.isToday).toBe(false);
  });

  it("excludes sessions outside the 20-week window", () => {
    const earliest = addDaysToYmd(mondayOfYmd(TODAY), -(WEEKS - 1) * 7);
    const wayBefore = addDaysToYmd(earliest, -7);
    const cells = buildHeatmap({
      today: TODAY,
      weeks: WEEKS,
      sessions: [
        {
          id: "ancient",
          performedYmd: wayBefore,
          title: "Ancient PR",
          isStrength: true,
          isCardio: false,
        },
      ],
      planned: [],
    });
    expect(cells.every((c) => !c.sessionIds.includes("ancient"))).toBe(true);
    expect(cells.every((c) => c.state === "empty")).toBe(true);
  });

  it("paints planned-but-non-trained days inside a block week as 'rest'", () => {
    // Two planned sessions this ISO week → the other days in that week
    // (in the past) should turn into 'rest', not 'empty'.
    const monday = mondayOfYmd(TODAY);
    const tuesday = addDaysToYmd(monday, 1);
    const wednesday = addDaysToYmd(monday, 2); // planned but not today
    const cells = buildHeatmap({
      today: TODAY,
      weeks: WEEKS,
      sessions: [
        {
          id: "s1",
          performedYmd: monday,
          title: "Squat",
          isStrength: true,
          isCardio: false,
        },
      ],
      planned: [
        {
          date: monday,
          title: "Squat",
          completedSessionId: "s1",
          skippedAt: null,
        },
        {
          date: wednesday,
          title: "Bench",
          completedSessionId: null,
          skippedAt: null,
        },
      ],
    });
    // Tuesday is unplanned and in the past → rest (inside the block week).
    expect(findCell(cells, tuesday).state).toBe("rest");
    // Wednesday is planned-not-done in the past → missed (not rest).
    expect(findCell(cells, wednesday).state).toBe("missed");
  });

  it("treats a skipped planned session as missed", () => {
    const skippedDate = addDaysToYmd(TODAY, -2);
    const cells = buildHeatmap({
      today: TODAY,
      weeks: WEEKS,
      sessions: [],
      planned: [
        {
          date: skippedDate,
          title: "Conditioning",
          completedSessionId: null,
          skippedAt: "2026-05-21T12:00:00Z",
        },
      ],
    });
    expect(findCell(cells, skippedDate).state).toBe("missed");
  });
});
