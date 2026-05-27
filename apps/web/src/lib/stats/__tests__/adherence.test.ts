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
      onTime: 0,
      lateLogged: 0,
      accidentallyMissed: 0,
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

describe("computeAdherence — late-logged breakdown", () => {
  it("splits completed into on-time vs late-logged using performedYmd", () => {
    // Block started Monday 2026-05-18.
    // Planned w0d0 = 2026-05-18, performed same day → on-time.
    // Planned w0d1 = 2026-05-19, performed 2026-05-20 → late.
    // Planned w0d2 = 2026-05-20, no performedYmd known → fallback on-time.
    const r = computeAdherence({
      today: TODAY,
      planned: [
        {
          weekIndex: 0,
          dayIndex: 0,
          completedSessionId: "s-ontime",
          skippedAt: null,
          blockStartedOn: "2026-05-18",
          performedYmd: "2026-05-18",
        },
        {
          weekIndex: 0,
          dayIndex: 1,
          completedSessionId: "s-late",
          skippedAt: null,
          blockStartedOn: "2026-05-18",
          performedYmd: "2026-05-20",
        },
        {
          weekIndex: 0,
          dayIndex: 2,
          completedSessionId: "s-no-perf",
          skippedAt: null,
          blockStartedOn: "2026-05-18",
          performedYmd: null,
        },
      ],
    });
    expect(r.completed).toBe(3);
    expect(r.onTime).toBe(2);
    expect(r.lateLogged).toBe(1);
    expect(r.accidentallyMissed).toBe(0);
  });

  it("buckets sum to scheduled: onTime + lateLogged + skipped + accidentallyMissed", () => {
    const r = computeAdherence({
      today: TODAY,
      planned: [
        // On-time completion.
        {
          weekIndex: 0,
          dayIndex: 0,
          completedSessionId: "a",
          skippedAt: null,
          blockStartedOn: "2026-05-18",
          performedYmd: "2026-05-18",
        },
        // Late-logged completion.
        {
          weekIndex: 0,
          dayIndex: 1,
          completedSessionId: "b",
          skippedAt: null,
          blockStartedOn: "2026-05-18",
          performedYmd: "2026-05-21",
        },
        // Skipped.
        {
          weekIndex: 0,
          dayIndex: 2,
          completedSessionId: null,
          skippedAt: "2026-05-20T09:00:00Z",
          blockStartedOn: "2026-05-18",
        },
        // Limbo — not completed, not skipped, past date.
        {
          weekIndex: 0,
          dayIndex: 3,
          completedSessionId: null,
          skippedAt: null,
          blockStartedOn: "2026-05-18",
        },
      ],
    });
    expect(r.scheduled).toBe(4);
    expect(r.onTime + r.lateLogged + r.skipped + r.accidentallyMissed).toBe(r.scheduled);
    expect(r.onTime).toBe(1);
    expect(r.lateLogged).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.accidentallyMissed).toBe(1);
  });

  it("does NOT shift the baseline ratio when late-logged sessions exist", () => {
    // Same setup as the on-time test but the late one used to be
    // missing. The ratio is still completed/scheduled.
    const r = computeAdherence({
      today: TODAY,
      planned: [
        {
          weekIndex: 0,
          dayIndex: 0,
          completedSessionId: "a",
          skippedAt: null,
          blockStartedOn: "2026-05-18",
          performedYmd: "2026-05-21", // late
        },
        {
          weekIndex: 0,
          dayIndex: 1,
          completedSessionId: null,
          skippedAt: null,
          blockStartedOn: "2026-05-18",
        },
      ],
    });
    expect(r.completed).toBe(1);
    expect(r.scheduled).toBe(2);
    expect(r.ratio).toBe(0.5);
    expect(r.lateLogged).toBe(1);
    expect(r.onTime).toBe(0);
  });
});
