/**
 * Adherence — pure aggregator unit tests.
 *
 * Pins the high-stakes Phase 1 decision: SKIPPED sessions count as
 * MISSED for the 30-day adherence metric (denominator includes them,
 * numerator does not). See `lib/stats/adherence.ts` for the long-form
 * reasoning. If we ever flip this, the failing test name is the
 * documentation.
 */
import { describe, it, expect } from "vitest";
import { computeAdherence } from "../adherence";

const TODAY = "2026-05-23"; // Saturday

describe("computeAdherence (30-day window)", () => {
  it("returns zero when no planned sessions fall inside the window", () => {
    const r = computeAdherence({
      today: TODAY,
      planned: [
        {
          weekIndex: 0,
          dayIndex: 0,
          completedSessionId: null,
          skippedAt: null,
          blockStartedOn: "2025-01-01", // way outside the window
        },
      ],
    });
    expect(r).toEqual({
      completed: 0,
      scheduled: 0,
      skipped: 0,
      missed: 0,
      ratio: 0,
    });
  });

  it("only counts planned sessions whose date is in [today-30, today]", () => {
    const r = computeAdherence({
      today: TODAY,
      planned: [
        // Day -40 — before the window.
        {
          weekIndex: 0,
          dayIndex: 0,
          completedSessionId: "s1",
          skippedAt: null,
          blockStartedOn: "2026-04-13",
        },
        // Day -10 — inside, completed.
        {
          weekIndex: 4,
          dayIndex: 1,
          completedSessionId: "s2",
          skippedAt: null,
          blockStartedOn: "2026-04-13",
        },
        // Future — not yet due, excluded.
        {
          weekIndex: 7,
          dayIndex: 0,
          completedSessionId: null,
          skippedAt: null,
          blockStartedOn: "2026-04-13",
        },
      ],
    });
    expect(r.scheduled).toBe(1);
    expect(r.completed).toBe(1);
    expect(r.ratio).toBe(1);
  });

  it("treats skipped_at sessions as MISSED (the Phase-1 brief decision)", () => {
    // Block started 14 days ago. Four planned days, two logged, two
    // skipped. Adherence should read 50 % — the skips drag the
    // denominator up but never the numerator.
    const r = computeAdherence({
      today: TODAY,
      planned: [
        {
          weekIndex: 0,
          dayIndex: 0,
          completedSessionId: "s1",
          skippedAt: null,
          blockStartedOn: "2026-05-09",
        },
        {
          weekIndex: 0,
          dayIndex: 2,
          completedSessionId: "s2",
          skippedAt: null,
          blockStartedOn: "2026-05-09",
        },
        {
          weekIndex: 0,
          dayIndex: 4,
          completedSessionId: null,
          skippedAt: "2026-05-15T09:00:00Z",
          blockStartedOn: "2026-05-09",
        },
        {
          weekIndex: 1,
          dayIndex: 1,
          completedSessionId: null,
          skippedAt: "2026-05-20T09:00:00Z",
          blockStartedOn: "2026-05-09",
        },
      ],
    });
    expect(r.scheduled).toBe(4);
    expect(r.completed).toBe(2);
    expect(r.skipped).toBe(2);
    expect(r.missed).toBe(2);
    expect(r.ratio).toBeCloseTo(0.5, 5);
  });

  it("respects custom window length", () => {
    // today = 2026-05-23. With windowDays=7 the earliest is 2026-05-16.
    // Row 1: started_on Monday 2026-05-18, week 0 day 4 → 2026-05-22 → in.
    // Row 2: started_on Monday 2026-04-13, week 0 day 0 → 2026-04-13 → out.
    const r = computeAdherence({
      today: TODAY,
      windowDays: 7,
      planned: [
        {
          weekIndex: 0,
          dayIndex: 4,
          completedSessionId: "s-inside",
          skippedAt: null,
          blockStartedOn: "2026-05-18",
        },
        {
          weekIndex: 0,
          dayIndex: 0,
          completedSessionId: "s-outside",
          skippedAt: null,
          blockStartedOn: "2026-04-13",
        },
      ],
    });
    expect(r.scheduled).toBe(1);
    expect(r.completed).toBe(1);
  });
});
