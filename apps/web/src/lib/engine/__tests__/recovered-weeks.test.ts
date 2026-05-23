/**
 * DC-K1 — `aggregateWeeklyRecovery` (pure aggregator) tests.
 *
 * The thin Supabase wrapper in `recovered-weeks.ts` is exercised
 * indirectly by the engine-page e2e spec; here we pin the date /
 * filter math that drives the actual qualification result.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateWeeklyRecovery,
  type PlannedRow,
  type SessionRow,
  type SetRowForWeek,
} from "../recovered-weeks";

const TODAY = "2026-05-08"; // Friday — current week Monday is 2026-05-04.
const MON_THIS = "2026-05-04";
const MON_PREV = "2026-04-27";
const MON_PREV2 = "2026-04-20";

function plan(overrides: Partial<PlannedRow>): PlannedRow {
  return {
    user_id: "u1",
    week_index: 0,
    day_index: 0,
    completed_session_id: "s1",
    skipped_at: null,
    blockStartedOn: MON_THIS,
    ...overrides,
  };
}

describe("DC-K1 aggregateWeeklyRecovery", () => {
  it("emits weeks in desc order by weekStart (most recent first)", () => {
    const rows = aggregateWeeklyRecovery([], [], [], 4, TODAY);
    expect(rows.map((r) => r.weekStart)).toEqual([
      MON_THIS,
      MON_PREV,
      MON_PREV2,
      "2026-04-13",
    ]);
  });

  it("counts logged / skipped / missed-past-due correctly per DC-K1", () => {
    const planned: PlannedRow[] = [
      // Logged on the Monday of this week.
      plan({ week_index: 0, day_index: 0, completed_session_id: "s1" }),
      // Skipped on the Tuesday.
      plan({
        week_index: 0,
        day_index: 1,
        completed_session_id: null,
        skipped_at: "2026-05-05T10:00:00Z",
      }),
      // Past-due (Wednesday before TODAY=Friday), neither logged nor skipped.
      plan({
        week_index: 0,
        day_index: 2,
        completed_session_id: null,
        skipped_at: null,
      }),
      // Future day in the same week (Saturday) — NOT counted as missed.
      plan({
        week_index: 0,
        day_index: 5,
        completed_session_id: null,
        skipped_at: null,
      }),
    ];
    const rows = aggregateWeeklyRecovery(planned, [], [], 4, TODAY);
    const wk = rows.find((r) => r.weekStart === MON_THIS)!;
    expect(wk.plannedSessions).toBe(4);
    expect(wk.loggedSessions).toBe(1);
    expect(wk.skippedSessions).toBe(1);
    expect(wk.missedSessions).toBe(1);
  });

  it("aggregates max sRPE / avg fatigue / avg soreness across the week's sessions", () => {
    const sessions: SessionRow[] = [
      { performedYmd: "2026-05-04", session_rpe: 7, fatigue: 2, soreness: 3 },
      { performedYmd: "2026-05-06", session_rpe: 9.5, fatigue: 4, soreness: 5 },
      { performedYmd: "2026-05-07", session_rpe: 6, fatigue: null, soreness: 2 },
    ];
    const rows = aggregateWeeklyRecovery([], sessions, [], 4, TODAY);
    const wk = rows.find((r) => r.weekStart === MON_THIS)!;
    expect(wk.maxSrpe).toBe(9.5);
    expect(wk.avgFatigue).toBeCloseTo(3, 6); // (2 + 4) / 2 — null ignored
    expect(wk.avgSoreness).toBeCloseTo(10 / 3, 6);
  });

  it("DC-K1: NULL fatigue/soreness aggregates remain null when no session recorded them", () => {
    const sessions: SessionRow[] = [
      { performedYmd: "2026-05-04", session_rpe: null, fatigue: null, soreness: null },
    ];
    const rows = aggregateWeeklyRecovery([], sessions, [], 4, TODAY);
    const wk = rows.find((r) => r.weekStart === MON_THIS)!;
    expect(wk.maxSrpe).toBeNull();
    expect(wk.avgFatigue).toBeNull();
    expect(wk.avgSoreness).toBeNull();
  });

  it("buckets weekly tonnage (Σ weight × reps) per Monday-anchored ISO week", () => {
    const sets: SetRowForWeek[] = [
      { performedYmd: "2026-05-05", weightKg: 100, reps: 5 }, // 500
      { performedYmd: "2026-05-08", weightKg: 80, reps: 8 }, //  640
      { performedYmd: "2026-04-28", weightKg: 90, reps: 6 }, // last week — 540
    ];
    const rows = aggregateWeeklyRecovery([], [], sets, 4, TODAY);
    expect(rows.find((r) => r.weekStart === MON_THIS)!.weeklyTonnageKg).toBe(1140);
    expect(rows.find((r) => r.weekStart === MON_PREV)!.weeklyTonnageKg).toBe(540);
  });

  it("DC-K1 ISO-week math: Helsinki spring-forward DST week (2026-03-29) does not drift", () => {
    // EU DST starts 2026-03-29 (Sun). The ISO week's Monday is
    // 2026-03-23. A session logged at 23:00 local on the Sunday must
    // still bucket into that week, not into 2026-03-30. The aggregator
    // operates on YMD anchors so the result is timezone-free.
    const sets: SetRowForWeek[] = [
      { performedYmd: "2026-03-29", weightKg: 100, reps: 5 }, // 500
    ];
    const rows = aggregateWeeklyRecovery([], [], sets, 12, "2026-04-05");
    const wk = rows.find((r) => r.weekStart === "2026-03-23");
    expect(wk).toBeDefined();
    expect(wk!.weeklyTonnageKg).toBe(500);
  });

  it("rows outside the lookback window are dropped silently", () => {
    const sessions: SessionRow[] = [
      // 6 months ago — well outside a 4-week window.
      { performedYmd: "2025-11-04", session_rpe: 9, fatigue: 3, soreness: 3 },
    ];
    const rows = aggregateWeeklyRecovery([], sessions, [], 4, TODAY);
    for (const r of rows) {
      expect(r.maxSrpe).toBeNull();
      expect(r.avgFatigue).toBeNull();
    }
  });
});
