/**
 * MonthAlternate (PlanRedesign) — prev/next nav + month-label tests.
 *
 * The repo intentionally avoids @testing-library/react, so DOM-level
 * click semantics are exercised via the exported pure helpers
 * (`addMonthsUtc`, `buildMonthGridCells`, `formatMonthLabel`) plus an
 * SSR snapshot that asserts the visible contract (label, prev/next
 * buttons, and the `overflow-x: hidden` style that PR #200 broke).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PlanRedesign,
  addMonthsUtc,
  buildMonthGridCells,
  formatMonthLabel,
  type PlanSessionInput,
} from "./PlanRedesign";

const noop = async () => {};

function session(over: Partial<PlanSessionInput> = {}): PlanSessionInput {
  return {
    id: "s1",
    weekIndex: 0,
    dayIndex: 1,
    date: "2026-05-26",
    title: "Front Squat",
    isCardio: false,
    isStrength: true,
    done: false,
    skipped: false,
    slot: "single",
    items: [],
    estDurationMin: 55,
    notes: null,
    ...over,
  };
}

function renderMonth() {
  return renderToStaticMarkup(
    <PlanRedesign
      archetypeName="Endurance Focus"
      blockNumber={1}
      blockTotal={3}
      startedOn="2026-05-25"
      endedOn="2026-06-21"
      weeks={4}
      today="2026-05-26"
      currentWeekIndex={0}
      sessions={[session()]}
      view="month"
      filter="all"
      logHrefBase="/app/sessions/start"
      moveAction={noop}
      skipAction={noop}
      unskipAction={noop}
      updateNotesAction={async () => ({ ok: true as const })}
      startSessionAction={noop}
    />,
  );
}

describe("addMonthsUtc", () => {
  it("advances to the next month preserving day-of-month", () => {
    const may = new Date(Date.UTC(2026, 4, 15));
    const jun = addMonthsUtc(may, 1);
    expect(jun.getUTCFullYear()).toBe(2026);
    expect(jun.getUTCMonth()).toBe(5);
    expect(jun.getUTCDate()).toBe(15);
  });

  it("goes back to the previous month", () => {
    const may = new Date(Date.UTC(2026, 4, 1));
    const apr = addMonthsUtc(may, -1);
    expect(apr.getUTCFullYear()).toBe(2026);
    expect(apr.getUTCMonth()).toBe(3);
  });

  it("wraps across a year boundary", () => {
    const jan = new Date(Date.UTC(2026, 0, 10));
    const dec = addMonthsUtc(jan, -1);
    expect(dec.getUTCFullYear()).toBe(2025);
    expect(dec.getUTCMonth()).toBe(11);
  });

  it("clamps the day when the target month is shorter", () => {
    // Jan 31 + 1mo → Feb 28 (2026 is not a leap year).
    const jan31 = new Date(Date.UTC(2026, 0, 31));
    const feb = addMonthsUtc(jan31, 1);
    expect(feb.getUTCMonth()).toBe(1);
    expect(feb.getUTCDate()).toBe(28);
  });
});

describe("buildMonthGridCells", () => {
  it("returns 42 cells covering the month's full Monday-first grid", () => {
    const may = new Date(Date.UTC(2026, 4, 1));
    const cells = buildMonthGridCells(may);
    expect(cells).toHaveLength(42);
    // May 1 2026 is a Friday → Monday-first grid starts on Mon Apr 27.
    expect(cells[0]!.date).toBe("2026-04-27");
    expect(cells[0]!.inMonth).toBe(false);
    // First in-month cell is May 1.
    const firstInMonth = cells.find((c) => c.inMonth);
    expect(firstInMonth?.date).toBe("2026-05-01");
  });

  it("flags cells outside the target month", () => {
    const cells = buildMonthGridCells(new Date(Date.UTC(2026, 4, 1)));
    const inMonth = cells.filter((c) => c.inMonth);
    // May has 31 days → exactly 31 in-month cells.
    expect(inMonth).toHaveLength(31);
  });
});

describe("formatMonthLabel", () => {
  it('renders "long month + 4-digit year" for the en-US locale', () => {
    const may = new Date(Date.UTC(2026, 4, 1));
    expect(formatMonthLabel(may, "en-US")).toBe("May 2026");
  });

  it("respects the supplied locale", () => {
    const may = new Date(Date.UTC(2026, 4, 1));
    // Finnish: "toukokuu 2026" (lowercase month name).
    expect(formatMonthLabel(may, "fi-FI").toLowerCase()).toContain("toukokuu");
    expect(formatMonthLabel(may, "fi-FI")).toContain("2026");
  });
});

describe("MonthAlternate — SSR contract", () => {
  it("renders the month label for the current month on first paint", () => {
    const html = renderMonth();
    // today=2026-05-26 → initial viewingMonth is May 2026.
    expect(html).toContain('data-testid="plan-month-label"');
    // Locale-agnostic check: 2026 must appear inside the label container.
    expect(html).toMatch(/data-testid="plan-month-label"[^>]*>[^<]*2026/);
  });

  it("renders prev/next buttons with the expected testids and aria labels", () => {
    const html = renderMonth();
    expect(html).toContain('data-testid="plan-month-prev"');
    expect(html).toContain('data-testid="plan-month-next"');
    expect(html).toContain('aria-label="Previous month"');
    expect(html).toContain('aria-label="Next month"');
  });

  it("declares overflow-x: hidden on the month grid CSS (PR #200 regression guard)", () => {
    const html = renderMonth();
    // The scoped style block lives inline next to the markup.
    expect(html).toMatch(/\.plan-month-grid\s*\{[^}]*overflow-x:\s*hidden/);
  });

  it("uses minmax(0, 1fr) for the 7-column grids so cells can shrink", () => {
    const html = renderMonth();
    // Both the DOW header row and the cell grid get the safe template.
    const matches = html.match(/repeat\(7,\s*minmax\(0,\s*1fr\)\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the TODAY highlight when the initial view is the current month", () => {
    const html = renderMonth();
    expect(html).toContain("TODAY");
  });
});
