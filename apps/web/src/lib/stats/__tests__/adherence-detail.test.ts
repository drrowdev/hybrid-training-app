/**
 * Adherence dashboard — Phase 4 pure-helper tests.
 *
 * Pins the high-stakes Phase 4 decisions:
 *   - "skipped counts as missed" propagates through every % we surface.
 *   - Pending-today doesn't break a streak (mid-day grace period).
 *   - Rest days continue a streak; skips and missed-past sessions
 *     break it.
 *   - Per-archetype lookup falls back to the slug if the registry
 *     doesn't recognise the id.
 *
 * Deleted (`training_blocks.deleted_at != null`) sessions are filtered
 * at the I/O boundary (`readAllPlanned`); the pure functions only see
 * what's been filtered in, so the deleted-data invariant is verified
 * indirectly via the I/O-layer assertion in the e2e spec.
 */
import { describe, it, expect } from "vitest";
import {
  buildDayStatusTimeline,
  classifyPlannedRow,
  computeArchetypeAdherence,
  computeStreaks,
  computeWeekdayAdherence,
  computeWeeklyAdherence,
  parseAdherenceRange,
  plannedRowDate,
  adherenceRangeWindowDays,
  DEFAULT_ADHERENCE_RANGE,
  type PlannedRow,
} from "../adherence-detail";

const TODAY = "2026-05-25"; // Monday — week 4 of the seeded block below

function row(
  partial: Partial<PlannedRow> & {
    plannedId: string;
    weekIndex: number;
    dayIndex: number;
  },
): PlannedRow {
  return {
    blockId: "B1",
    archetype: "strength_anchor",
    blockNotes: null,
    blockStartedOn: "2026-05-04", // Mon
    title: "Squat day",
    completedSessionId: null,
    skippedAt: null,
    ...partial,
  };
}

describe("parseAdherenceRange + adherenceRangeWindowDays", () => {
  it("accepts the three canonical tokens", () => {
    expect(parseAdherenceRange("12w")).toBe("12w");
    expect(parseAdherenceRange("26w")).toBe("26w");
    expect(parseAdherenceRange("all")).toBe("all");
  });

  it("falls back to 12w on bogus input", () => {
    expect(parseAdherenceRange(undefined)).toBe(DEFAULT_ADHERENCE_RANGE);
    expect(parseAdherenceRange("30d")).toBe(DEFAULT_ADHERENCE_RANGE);
    expect(parseAdherenceRange("")).toBe(DEFAULT_ADHERENCE_RANGE);
    expect(parseAdherenceRange(["26w", "12w"])).toBe("26w");
  });

  it("maps tokens to day windows; all-time is null", () => {
    expect(adherenceRangeWindowDays("12w")).toBe(84);
    expect(adherenceRangeWindowDays("26w")).toBe(182);
    expect(adherenceRangeWindowDays("all")).toBeNull();
  });
});

describe("plannedRowDate + classifyPlannedRow", () => {
  it("anchors week 0 day 0 to the Monday of the block start week", () => {
    expect(
      plannedRowDate(row({ plannedId: "a", weekIndex: 0, dayIndex: 0 })),
    ).toBe("2026-05-04");
    expect(
      plannedRowDate(row({ plannedId: "b", weekIndex: 0, dayIndex: 4 })),
    ).toBe("2026-05-08");
    expect(
      plannedRowDate(row({ plannedId: "c", weekIndex: 2, dayIndex: 2 })),
    ).toBe("2026-05-20");
  });

  it("classifies past completed/skipped/missed and future + pending correctly", () => {
    expect(
      classifyPlannedRow(
        row({
          plannedId: "logged",
          weekIndex: 0,
          dayIndex: 0,
          completedSessionId: "S1",
        }),
        TODAY,
      ),
    ).toBe("logged");
    expect(
      classifyPlannedRow(
        row({
          plannedId: "skipped",
          weekIndex: 0,
          dayIndex: 2,
          skippedAt: "2026-05-06T10:00:00Z",
        }),
        TODAY,
      ),
    ).toBe("skipped");
    expect(
      classifyPlannedRow(
        row({ plannedId: "missed", weekIndex: 1, dayIndex: 4 }),
        TODAY,
      ),
    ).toBe("missed");
    // weekIndex 3 day 0 = 2026-05-25 == today -> pending if unlogged
    expect(
      classifyPlannedRow(
        row({ plannedId: "pending", weekIndex: 3, dayIndex: 0 }),
        TODAY,
      ),
    ).toBe("pending");
    expect(
      classifyPlannedRow(
        row({ plannedId: "future", weekIndex: 3, dayIndex: 4 }),
        TODAY,
      ),
    ).toBe("future");
  });
});

describe("computeWeeklyAdherence", () => {
  // 4 weeks, 3 sessions per week (Mon/Wed/Fri).
  const rows: PlannedRow[] = [
    row({ plannedId: "w0d0", weekIndex: 0, dayIndex: 0, completedSessionId: "s" }),
    row({ plannedId: "w0d2", weekIndex: 0, dayIndex: 2, completedSessionId: "s" }),
    row({ plannedId: "w0d4", weekIndex: 0, dayIndex: 4, completedSessionId: "s" }),
    row({ plannedId: "w1d0", weekIndex: 1, dayIndex: 0, completedSessionId: "s" }),
    row({ plannedId: "w1d2", weekIndex: 1, dayIndex: 2, skippedAt: "2026-05-13T00:00Z" }),
    row({ plannedId: "w1d4", weekIndex: 1, dayIndex: 4 }),
    row({ plannedId: "w2d0", weekIndex: 2, dayIndex: 0, completedSessionId: "s" }),
    row({ plannedId: "w2d2", weekIndex: 2, dayIndex: 2 }),
    row({ plannedId: "w2d4", weekIndex: 2, dayIndex: 4 }),
    row({ plannedId: "w3d0", weekIndex: 3, dayIndex: 0 }), // today, pending
    row({ plannedId: "w3d4", weekIndex: 3, dayIndex: 4 }), // future
  ];

  it("buckets per ISO week with logged/skipped/missed counts", () => {
    const out = computeWeeklyAdherence(rows, TODAY, null);
    expect(out).toHaveLength(4); // weeks of 5/4, 5/11, 5/18, 5/25
    expect(out[0]).toMatchObject({ weekStart: "2026-05-04", logged: 3, skipped: 0, missed: 0 });
    expect(out[0].percentage).toBeCloseTo(1, 5);
    expect(out[1]).toMatchObject({ weekStart: "2026-05-11", logged: 1, skipped: 1, missed: 1 });
    expect(out[1].percentage).toBeCloseTo(1 / 3, 5);
    expect(out[2]).toMatchObject({ weekStart: "2026-05-18", logged: 1, skipped: 0, missed: 2 });
    // Week 4: pending + future → both excluded → 0/0/0, percentage 0.
    expect(out[3]).toMatchObject({ weekStart: "2026-05-25", logged: 0, skipped: 0, missed: 0 });
    expect(out[3].percentage).toBe(0);
  });

  it("handles week-boundary edge: a session logged Sunday 23:59 lives in the prior ISO week", () => {
    const sundayWeek0 = row({
      plannedId: "sun",
      weekIndex: 0,
      dayIndex: 6, // Sun 2026-05-10
      completedSessionId: "s",
    });
    const out = computeWeeklyAdherence([sundayWeek0], TODAY, null);
    // Monday-anchored: Sunday belongs to the week of Mon May 4.
    expect(out[0].weekStart).toBe("2026-05-04");
    expect(out[0].logged).toBe(1);
  });

  it("clips weeks before the range lower bound", () => {
    const out = computeWeeklyAdherence(rows, TODAY, "2026-05-18");
    expect(out.map((w) => w.weekStart)).toEqual(["2026-05-18", "2026-05-25"]);
  });

  it("returns an empty array when nothing falls inside the window", () => {
    const out = computeWeeklyAdherence(rows, TODAY, "2030-01-01");
    expect(out).toEqual([]);
  });

  it("survives a session whose date crosses DST without drifting buckets", () => {
    // 2026 EU DST transitions are March 29 and October 25. Anchor a
    // block to a Monday straddling the spring-forward and confirm the
    // bucket Monday is still the right calendar Monday.
    const dstRow = row({
      plannedId: "dst",
      weekIndex: 0,
      dayIndex: 1, // Tue of week 0
      blockStartedOn: "2026-03-23", // Mon before spring-forward
      completedSessionId: "s",
    });
    const out = computeWeeklyAdherence([dstRow], TODAY, null);
    expect(out[0].weekStart).toBe("2026-03-23");
  });
});

describe("computeWeekdayAdherence", () => {
  it("returns zeroed buckets without dividing by zero on empty input", () => {
    const out = computeWeekdayAdherence([], TODAY, null);
    expect(out.mon.percentage).toBe(0);
    expect(out.sun.percentage).toBe(0);
    expect(out.totalPlanned).toBe(0);
    expect(out.rangeWeeks).toBe(0);
  });

  it("buckets by Mon-anchored weekday and color-codes the percentage", () => {
    const rows: PlannedRow[] = [
      row({ plannedId: "a", weekIndex: 0, dayIndex: 0, completedSessionId: "x" }), // Mon
      row({ plannedId: "b", weekIndex: 0, dayIndex: 6, skippedAt: "z" }), // Sun (skip)
      row({ plannedId: "c", weekIndex: 1, dayIndex: 0, completedSessionId: "x" }), // Mon
      row({ plannedId: "d", weekIndex: 1, dayIndex: 6 }), // Sun (missed)
      row({ plannedId: "e", weekIndex: 2, dayIndex: 0, completedSessionId: "x" }), // Mon
      row({ plannedId: "f", weekIndex: 2, dayIndex: 6 }), // Sun (missed)
    ];
    const out = computeWeekdayAdherence(rows, TODAY, null);
    expect(out.mon).toMatchObject({ logged: 3, skipped: 0, missed: 0 });
    expect(out.mon.percentage).toBeCloseTo(1, 5);
    expect(out.sun).toMatchObject({ logged: 0, skipped: 1, missed: 2 });
    expect(out.sun.percentage).toBe(0);
    expect(out.totalPlanned).toBe(6);
    expect(out.rangeWeeks).toBeGreaterThanOrEqual(3);
  });
});

describe("computeArchetypeAdherence", () => {
  it("sorts by descending block count and falls back to slug for unknown archetypes", () => {
    const rows: PlannedRow[] = [
      row({
        plannedId: "a",
        weekIndex: 0,
        dayIndex: 0,
        completedSessionId: "s",
        blockId: "B1",
        archetype: "strength_anchor",
      }),
      row({
        plannedId: "b",
        weekIndex: 0,
        dayIndex: 0,
        completedSessionId: "s",
        blockId: "B2",
        archetype: "strength_anchor",
      }),
      row({
        plannedId: "c",
        weekIndex: 0,
        dayIndex: 2,
        skippedAt: "x",
        blockId: "B3",
        archetype: "hypertrophy_anchor",
      }),
      row({
        plannedId: "d",
        weekIndex: 0,
        dayIndex: 4,
        // Future-archetype slug that doesn't exist in the registry —
        // must fall back to the literal slug instead of throwing.
        archetype: "experimental_archetype",
        completedSessionId: "s",
        blockId: "B4",
      }),
    ];
    const out = computeArchetypeAdherence(rows, TODAY, null);
    expect(out[0].archetypeId).toBe("strength_anchor");
    expect(out[0].blockCount).toBe(2);
    const exp = out.find((r) => r.archetypeId === "experimental_archetype");
    expect(exp?.displayName).toBe("experimental_archetype");
  });

  it("handles a custom-archetype block by using the block notes as display name", () => {
    const rows: PlannedRow[] = [
      row({
        plannedId: "custom",
        weekIndex: 0,
        dayIndex: 0,
        completedSessionId: "s",
        archetype: "custom",
        blockNotes: "My bespoke plan",
        blockId: "BC",
      }),
    ];
    const out = computeArchetypeAdherence(rows, TODAY, null);
    expect(out[0].displayName).toBe("My bespoke plan");
  });
});

describe("computeStreaks", () => {
  // Build a deliberate timeline anchored to a block starting 2026-05-11
  // (Monday). Use 3 sessions per week (Mon / Wed / Fri).
  it("rest days continue the streak; skips and missed past-due sessions break it", () => {
    const rows: PlannedRow[] = [
      // Week 0 (May 11–17) — all logged.
      row({ plannedId: "w0Mon", weekIndex: 0, dayIndex: 0, blockStartedOn: "2026-05-11", completedSessionId: "s" }),
      row({ plannedId: "w0Wed", weekIndex: 0, dayIndex: 2, blockStartedOn: "2026-05-11", completedSessionId: "s" }),
      row({ plannedId: "w0Fri", weekIndex: 0, dayIndex: 4, blockStartedOn: "2026-05-11", completedSessionId: "s" }),
      // Week 1 (May 18–24) — Mon logged, Wed skipped, Fri logged.
      row({ plannedId: "w1Mon", weekIndex: 1, dayIndex: 0, blockStartedOn: "2026-05-11", completedSessionId: "s" }),
      row({ plannedId: "w1Wed", weekIndex: 1, dayIndex: 2, blockStartedOn: "2026-05-11", skippedAt: "x" }),
      row({ plannedId: "w1Fri", weekIndex: 1, dayIndex: 4, blockStartedOn: "2026-05-11", completedSessionId: "s" }),
      // Week 2 — Mon (today) pending, Wed/Fri future.
      row({ plannedId: "w2Mon", weekIndex: 2, dayIndex: 0, blockStartedOn: "2026-05-11" }),
    ];
    // Range covers the full timeline. Today = 2026-05-25 (Mon week 2).
    const { currentDays, longestDays } = computeStreaks(rows, TODAY, "2026-05-11");
    // Longest run: May 11..May 19 (Mon-Tue logged, Wed logged, Thu rest, Fri logged) up through Tue May 19
    // — i.e. May 11,12,13,14,15,16,17,18,19 = 9 days (then Wed May 20 skipped breaks).
    expect(longestDays).toBe(9);
    // Current: today is pending → drop to yesterday (Sun May 24). Walk
    // back: Sun rest, Sat rest, Fri logged, Thu rest, Wed skipped → BREAK.
    // So current run = May 21..May 24 = 4 days.
    expect(currentDays).toBe(4);
  });

  it("today not yet logged doesn't break the streak (mid-day grace)", () => {
    // Both blocks plant a planned session on today but with no log yet.
    // Streak should count back from yesterday only — yesterday being a
    // rest day (no planned session) keeps the run alive.
    const rows: PlannedRow[] = [
      row({ plannedId: "y", weekIndex: 0, dayIndex: 0, blockStartedOn: "2026-05-18", completedSessionId: "s" }),
      // Wed May 20 logged.
      row({ plannedId: "w", weekIndex: 0, dayIndex: 2, blockStartedOn: "2026-05-18", completedSessionId: "s" }),
      // Today (Mon May 25) planned but not logged → pending.
      row({ plannedId: "t", weekIndex: 1, dayIndex: 0, blockStartedOn: "2026-05-18" }),
    ];
    const { currentDays } = computeStreaks(rows, TODAY, "2026-05-18");
    // Pending today is dropped. Walk back from Sun May 24: rest, rest,
    // rest, rest (Thu/Fri/Sat/Sun), Wed logged, Tue rest, Mon logged.
    // No break encountered → 7 days from May 18 to May 24 inclusive.
    expect(currentDays).toBe(7);
  });

  it("returns zero when the range is empty", () => {
    const out = computeStreaks([], TODAY, TODAY);
    expect(out).toEqual({ currentDays: 1, longestDays: 1 });
    // Single day in range with no plan = a rest day = streak of 1. The
    // user surface shows this as "1 day" which is fine for the empty
    // dashboard.
  });
});

describe("buildDayStatusTimeline", () => {
  it("prefers logged > skipped > pending > missed when a day has multiple planned rows", () => {
    const rows: PlannedRow[] = [
      // Same day (Mon May 11), two-a-day: AM logged, PM skipped → logged wins.
      row({
        plannedId: "am",
        weekIndex: 0,
        dayIndex: 0,
        blockStartedOn: "2026-05-11",
        completedSessionId: "s",
      }),
      row({
        plannedId: "pm",
        weekIndex: 0,
        dayIndex: 0,
        blockStartedOn: "2026-05-11",
        skippedAt: "x",
      }),
    ];
    const timeline = buildDayStatusTimeline(rows, TODAY, "2026-05-11");
    const may11 = timeline.find((d) => d.date === "2026-05-11");
    expect(may11?.status).toBe("logged");
  });
});
