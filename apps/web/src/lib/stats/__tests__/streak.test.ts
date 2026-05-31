import { describe, it, expect } from "vitest";
import { computeStreak } from "../streak";

const CURRENT_MONDAY = "2026-04-20";

describe("computeStreak — pure streak walker", () => {
  it("returns 0 streak when target is 0 or negative (no active block)", () => {
    const m = new Map<string, number>([[CURRENT_MONDAY, 5]]);
    const r = computeStreak(m, CURRENT_MONDAY, 0);
    expect(r.currentStreakWeeks).toBe(0);
    expect(r.thisWeekCompleted).toBe(5);
  });

  it("clean streak — 5 consecutive completed weeks at or above target", () => {
    const m = new Map<string, number>([
      [CURRENT_MONDAY, 1], // in-progress current week
      ["2026-04-13", 4],
      ["2026-04-06", 5],
      ["2026-03-30", 4],
      ["2026-03-23", 4],
      ["2026-03-16", 4],
      ["2026-03-09", 2], // breaker
    ]);
    const r = computeStreak(m, CURRENT_MONDAY, 4);
    expect(r.currentStreakWeeks).toBe(5);
    expect(r.thisWeekCompleted).toBe(1);
  });

  it("broken streak — last completed week missed target", () => {
    const m = new Map<string, number>([
      [CURRENT_MONDAY, 3],
      ["2026-04-13", 3], // missed
      ["2026-04-06", 4],
      ["2026-03-30", 4],
    ]);
    const r = computeStreak(m, CURRENT_MONDAY, 4);
    expect(r.currentStreakWeeks).toBe(0);
    expect(r.thisWeekCompleted).toBe(3);
  });

  it("partial current week does NOT break the streak (current week excluded from walk)", () => {
    // User has logged 2 of 4 this week (a Wednesday say) — streak still
    // counts the previous completed weeks.
    const m = new Map<string, number>([
      [CURRENT_MONDAY, 2],
      ["2026-04-13", 4],
      ["2026-04-06", 4],
      ["2026-03-30", 4],
      ["2026-03-23", 1], // breaker
    ]);
    const r = computeStreak(m, CURRENT_MONDAY, 4);
    expect(r.currentStreakWeeks).toBe(3);
    expect(r.thisWeekCompleted).toBe(2);
  });

  it("exact-target weeks count (>= target, not >)", () => {
    const m = new Map<string, number>([
      ["2026-04-13", 4], // exactly the target
      ["2026-04-06", 4],
    ]);
    const r = computeStreak(m, CURRENT_MONDAY, 4);
    expect(r.currentStreakWeeks).toBe(2);
  });

  it("missing past week counts as 0 → breaks the streak immediately", () => {
    const m = new Map<string, number>([
      ["2026-04-13", 4],
      // 2026-04-06 absent → 0 → breaker
      ["2026-03-30", 4],
    ]);
    const r = computeStreak(m, CURRENT_MONDAY, 4);
    expect(r.currentStreakWeeks).toBe(1);
  });

  it("thisWeekCompleted reports the in-progress count even when streak is 0", () => {
    const m = new Map<string, number>([[CURRENT_MONDAY, 7]]);
    const r = computeStreak(m, CURRENT_MONDAY, 4);
    expect(r.thisWeekCompleted).toBe(7);
    expect(r.currentStreakWeeks).toBe(0);
  });

  it("caps the walk at 52 weeks (never infinite-loops on a fully-populated history)", () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      // Manually compute Monday i*7 days before CURRENT_MONDAY
      const d = new Date("2026-04-20T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i * 7);
      m.set(d.toISOString().slice(0, 10), 5);
    }
    const r = computeStreak(m, CURRENT_MONDAY, 4);
    expect(r.currentStreakWeeks).toBe(52);
  });
});
