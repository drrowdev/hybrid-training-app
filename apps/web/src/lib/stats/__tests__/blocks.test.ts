/**
 * Block-outcomes pure-helper unit tests — Phase 2 deep dive.
 *
 * The blocks module wraps Supabase reads around small pure functions:
 *   - `computeBlockAdherence`  — bucket planned rows + weekday breakdown
 *   - `computeRpeCreep`        — flag rising RPE vs flat prescribed %TM
 *   - `buildE1RmTrend`         — one e1RM point per session for one lift
 *
 * The tests pin those pure functions against fixture data; the I/O
 * wrappers (`getBlockSummary`, `getBlockPowerOutcome`, `compareBlocks`)
 * are exercised by the desktop E2E spec which seeds a real Supabase
 * project.
 */
import { describe, it, expect } from "vitest";
import {
  buildE1RmTrend,
  computeBlockAdherence,
  computeRpeCreep,
} from "../blocks";

describe("computeBlockAdherence", () => {
  // Block started Monday 2026-05-04. 4 weeks, days 0/2/4 each week
  // (Mon/Wed/Fri) → 12 planned rows. Half are logged, two are skipped.
  const startedOn = "2026-05-04"; // Mon
  const today = "2026-05-25"; // Mon of week 4

  const planned = [
    // Week 0 (May 4–10): all logged.
    p("a1", 0, 0, "Squat day", { completed: true }),
    p("a2", 0, 2, "Bench day", { completed: true }),
    p("a3", 0, 4, "Deadlift day", { completed: true }),
    // Week 1 (May 11–17): one logged, one skipped, one missed.
    p("b1", 1, 0, "Squat day", { completed: true }),
    p("b2", 1, 2, "Bench day", { skipped: true }),
    p("b3", 1, 4, "Deadlift day", { skipped: true }),
    // Week 2 (May 18–24): one logged, two not-yet-logged (past today=May 25).
    p("c1", 2, 0, "Squat day", { completed: true }),
    p("c2", 2, 2, "Bench day", {}),
    p("c3", 2, 4, "Deadlift day", {}),
    // Week 3 (May 25–31): all future relative to today.
    p("d1", 3, 0, "Squat day", {}),
    p("d2", 3, 2, "Bench day", {}),
    p("d3", 3, 4, "Deadlift day", {}),
  ];

  it("buckets planned rows past today into scheduled / completed / skipped / not-yet-logged", () => {
    const r = computeBlockAdherence({ today, startedOn, planned });
    // Week 0 + 1 + 2 days 0 (Mon=May 18) are past; week 2 days 2/4 and
    // all of week 3 are future. Today is May 25 (Mon), so week 3 day 0
    // sits exactly on today and counts.
    // Scheduled: week 0 = 3, week 1 = 3, week 2 = 3 (May 18/20/22 all <= May 25),
    // week 3 = 1 (May 25 == today).
    expect(r.scheduled).toBe(10);
    // Completed: a1,a2,a3,b1,c1 = 5.
    expect(r.completed).toBe(5);
    // Skipped: b2,b3 = 2.
    expect(r.skipped).toBe(2);
    // Not yet logged: c2 (May 20), c3 (May 22), d1 (May 25) = 3.
    expect(r.notYetLogged).toBe(3);
    expect(r.skippedDetail.map((s) => s.plannedId)).toEqual(["b2", "b3"]);
  });

  it("weekday breakdown reflects per-Mon/Wed/Fri completion ratios", () => {
    const r = computeBlockAdherence({ today, startedOn, planned });
    // Mon (idx 0): scheduled a1, b1, c1, d1 = 4; completed a1, b1, c1 = 3 → 0.75
    expect(r.weekday[0]).toMatchObject({
      weekdayLabel: "Mon",
      scheduled: 4,
      completed: 3,
    });
    expect(r.weekday[0].ratio).toBeCloseTo(0.75, 5);
    // Wed (idx 2): scheduled a2, b2, c2 = 3; completed a2 only = 1 → 0.333
    expect(r.weekday[2]).toMatchObject({
      weekdayLabel: "Wed",
      scheduled: 3,
      completed: 1,
    });
    expect(r.weekday[2].ratio).toBeCloseTo(1 / 3, 5);
    // Fri (idx 4): scheduled a3, b3, c3 = 3; completed a3 only = 1 → 0.333
    expect(r.weekday[4]).toMatchObject({
      weekdayLabel: "Fri",
      scheduled: 3,
      completed: 1,
    });
    // Untouched weekdays (Tue/Thu/Sat/Sun) read zero.
    expect(r.weekday[1]).toMatchObject({ scheduled: 0, completed: 0, ratio: 0 });
    expect(r.weekday[6]).toMatchObject({ scheduled: 0, completed: 0, ratio: 0 });
  });

  it("ignores planned rows whose date is strictly after today", () => {
    const r = computeBlockAdherence({ today, startedOn, planned });
    // d2 (May 27) and d3 (May 29) are after today → excluded from
    // scheduled. d1 (May 25) is today and counted.
    expect(r.scheduled).toBeLessThan(planned.length);
  });
});

describe("computeRpeCreep", () => {
  it("flags creep when avg RPE rose ≥2 from first to last logged week and %TM stayed flat", () => {
    const weeklyAvgRpe = [7, 7.5, 8.5, 9.2];
    const weeklyPrescribed = [70, 72, 73, 73];
    expect(computeRpeCreep(weeklyAvgRpe, weeklyPrescribed)).toBe(true);
  });

  it("does NOT flag when prescribed intensity also rose >5 points (the engine asked for it)", () => {
    const weeklyAvgRpe = [7, 7.5, 8.5, 9.5];
    const weeklyPrescribed = [70, 78, 82, 88]; // 18 pp rise
    expect(computeRpeCreep(weeklyAvgRpe, weeklyPrescribed)).toBe(false);
  });

  it("does NOT flag when RPE rise is below 2 points", () => {
    const weeklyAvgRpe = [7.5, 8, 8.5, 9];
    const weeklyPrescribed = [70, 70, 70, 70];
    expect(computeRpeCreep(weeklyAvgRpe, weeklyPrescribed)).toBe(false);
  });

  it("handles missing weeks (null entries) by skipping to the first/last logged week", () => {
    const weeklyAvgRpe = [null, 7, null, 9.5];
    const weeklyPrescribed = [null, 70, null, 72];
    expect(computeRpeCreep(weeklyAvgRpe, weeklyPrescribed)).toBe(true);
  });

  it("returns false when only one week has RPE", () => {
    expect(computeRpeCreep([8, null, null, null], [70, null, null, null])).toBe(false);
  });
});

describe("buildE1RmTrend", () => {
  it("returns one point per session sorted oldest-first, ignoring non-main / non-target movements", () => {
    const sets = [
      // Different movement — ignored.
      set("s1", "other", "main", 100, 5, null, "2026-05-04T10:00:00Z"),
      // Warmup — ignored (set_kind !== "main").
      set("s1", "squat", "warmup", 60, 5, null, "2026-05-04T10:00:00Z"),
      // First session, the heavier set should win for this session.
      set("s1", "squat", "main", 100, 5, null, "2026-05-04T10:00:00Z"),
      set("s1", "squat", "main", 105, 5, null, "2026-05-04T10:00:00Z"),
      // Second session — single main set, simpler.
      set("s2", "squat", "main", 115, 5, null, "2026-05-11T10:00:00Z"),
      // Third session — heavier still.
      set("s3", "squat", "main", 120, 5, null, "2026-05-18T10:00:00Z"),
    ];
    const sessionToWeek = new Map([
      ["s1", 0],
      ["s2", 1],
      ["s3", 2],
    ]);
    const trend = buildE1RmTrend(sets, "squat", sessionToWeek);
    expect(trend).toHaveLength(3);
    expect(trend.map((p) => p.weekIndex)).toEqual([0, 1, 2]);
    expect(trend.map((p) => p.sessionDate)).toEqual([
      "2026-05-04",
      "2026-05-11",
      "2026-05-18",
    ]);
    // The chosen first-session set should be the heavier 105×5.
    expect(trend[0].weight).toBe(105);
    // e1RM monotonically increases for this fixture.
    expect(trend[0].e1rm).toBeLessThan(trend[1].e1rm);
    expect(trend[1].e1rm).toBeLessThan(trend[2].e1rm);
  });

  it("returns empty array when no sets match the target movement", () => {
    expect(
      buildE1RmTrend(
        [set("s1", "other", "main", 100, 5, null, "2026-05-04T10:00:00Z")],
        "squat",
        new Map([["s1", 0]]),
      ),
    ).toEqual([]);
  });
});

// ── helpers ───────────────────────────────────────────────────────────

function p(
  id: string,
  weekIndex: number,
  dayIndex: number,
  title: string,
  flags: { completed?: boolean; skipped?: boolean },
) {
  return {
    plannedId: id,
    weekIndex,
    dayIndex,
    title,
    completedSessionId: flags.completed ? `sess-${id}` : null,
    skippedAt: flags.skipped ? "2026-05-15T09:00:00Z" : null,
  };
}

function set(
  sessionId: string,
  movementId: string,
  setKind: string,
  weight: number,
  reps: number,
  rpe: number | null,
  performedAt: string,
) {
  return {
    weight_kg: weight,
    reps,
    rpe,
    set_kind: setKind,
    movement_id: movementId,
    session_id: sessionId,
    performed_at: performedAt,
  };
}
