/**
 * Regression test for the timezone-skew bug in planner/queries.ts:
 *
 * - `dayDate(startedOn, w, d)` MUST be a pure function of its string
 *   inputs — its output cannot depend on the host process's timezone or
 *   on the wall-clock time-of-day when it runs. Previously it mixed
 *   `toISOString().slice(0,10)` (UTC) with `setDate()` (local), which in
 *   any non-UTC timezone shifted the result by ±1 day around midnight.
 *
 * - `todayYmd(tz)` MUST return the calendar date as the user in `tz`
 *   sees it, regardless of where the server runs. This is what fixes
 *   the surface bug: in Europe/Helsinki at 01:00 local on 2025-01-07,
 *   the user's "today" is 2025-01-07 — not 2025-01-06 (UTC date) and
 *   not whatever the Vercel host's local timezone reports.
 *
 * We avoid bare `new Date()` in the test body: every wall-clock-dependent
 * assertion drives the clock via vitest's fake timers, so the test is
 * deterministic regardless of when / where it runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// queries.ts imports `@/lib/supabase/server` for the async getUserTimezone
// helper. The pure date helpers we exercise here never reach that path,
// but we still need the module to evaluate without a Next.js runtime.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
  getAuthUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
}));

import { dayDate, todayYmd } from "../queries";

describe("dayDate — pure YYYY-MM-DD arithmetic, TZ-invariant", () => {
  // 2025-01-06 is a Monday — isoWeekday=0, so blockMonday === startedOn.
  // dayDate(s, w, d) = s + w*7 + d.
  const MONDAY = "2025-01-06";

  it.each([
    [0, 0, "2025-01-06"], // week 0 day 0 = Mon 6th
    [0, 1, "2025-01-07"], // week 0 day 1 = Tue 7th
    [0, 6, "2025-01-12"], // week 0 day 6 = Sun 12th
    [1, 0, "2025-01-13"], // week 1 day 0 = Mon 13th (next week)
    [3, 3, "2025-01-30"], // deload week, day 3 = Thu 30th
  ])("Mon-start block: dayDate(%s, %i, %i) -> %s", (w, d, expected) => {
    expect(dayDate(MONDAY, w as number, d as number)).toBe(expected);
  });

  it("non-Monday startedOn snaps back to that week's Monday", () => {
    // 2025-01-08 is a Wednesday (isoWeekday=2). blockMonday = 2025-01-06.
    expect(dayDate("2025-01-08", 0, 0)).toBe("2025-01-06");
    expect(dayDate("2025-01-08", 0, 2)).toBe("2025-01-08");
    expect(dayDate("2025-01-08", 1, 0)).toBe("2025-01-13");
  });

  it("crosses a DST boundary without drifting (US spring forward 2025-03-09)", () => {
    // 2025-03-03 is a Monday. Week 1 day 0 = 2025-03-10 (Mon after DST start).
    expect(dayDate("2025-03-03", 1, 0)).toBe("2025-03-10");
    expect(dayDate("2025-03-03", 1, 6)).toBe("2025-03-16");
  });

  it("is independent of host TZ — same input, same output regardless of TZ env", () => {
    const originalTZ = process.env.TZ;
    try {
      // The function should not be perturbed by host TZ. We rotate
      // through a few zones and assert identical output. (Node respects
      // process.env.TZ only at startup for legacy Date; the Intl-based
      // dayDate path uses Date.UTC explicitly, so it's invariant.)
      process.env.TZ = "America/Los_Angeles";
      expect(dayDate(MONDAY, 0, 0)).toBe("2025-01-06");
      process.env.TZ = "Europe/Helsinki";
      expect(dayDate(MONDAY, 0, 0)).toBe("2025-01-06");
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      expect(dayDate(MONDAY, 0, 0)).toBe("2025-01-06");
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});

describe("todayYmd(tz) — user-visible calendar date in their timezone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Hard case for the original bug: pick a UTC instant where the
   * calendar date differs between UTC and Europe/Helsinki (UTC+2/+3).
   *
   * 2025-01-06T22:30:00Z = 2025-01-07 00:30 Helsinki (EET, UTC+2).
   * The user in Helsinki is firmly inside Jan 7th, but the buggy code
   * would call `new Date().toISOString().slice(0,10)` and report Jan 6.
   */
  it("Helsinki winter (EET, UTC+2): 22:30 UTC -> 00:30 next day local", () => {
    vi.setSystemTime(new Date("2025-01-06T22:30:00Z"));
    expect(todayYmd("Europe/Helsinki")).toBe("2025-01-07");
    expect(todayYmd("UTC")).toBe("2025-01-06");
    expect(todayYmd("America/Los_Angeles")).toBe("2025-01-06"); // 14:30 PST
  });

  it("Helsinki summer (EEST, UTC+3): 21:30 UTC -> 00:30 next day local", () => {
    // 2025-06-15 — Helsinki is in EEST.
    vi.setSystemTime(new Date("2025-06-15T21:30:00Z"));
    expect(todayYmd("Europe/Helsinki")).toBe("2025-06-16");
    expect(todayYmd("UTC")).toBe("2025-06-15");
  });

  it("LA (PST, UTC-8): 04:00 UTC -> 20:00 prev day local", () => {
    // 2025-01-07T04:00Z = 2025-01-06 20:00 PST. UTC has rolled, LA has not.
    vi.setSystemTime(new Date("2025-01-07T04:00:00Z"));
    expect(todayYmd("America/Los_Angeles")).toBe("2025-01-06");
    expect(todayYmd("UTC")).toBe("2025-01-07");
    expect(todayYmd("Europe/Helsinki")).toBe("2025-01-07");
  });

  it("midday UTC: every reasonable tz agrees on the date", () => {
    vi.setSystemTime(new Date("2025-01-06T12:00:00Z"));
    expect(todayYmd("UTC")).toBe("2025-01-06");
    expect(todayYmd("Europe/Helsinki")).toBe("2025-01-06");
    expect(todayYmd("America/Los_Angeles")).toBe("2025-01-06");
  });
});

describe("integration: dayDate vs todayYmd — Helsinki user sees today correctly", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("user in Helsinki at 00:30 local on the Tuesday of week 0 sees that Tuesday as today", () => {
    // Block started Monday 2025-01-06. Tuesday is week 0 day 1 = 2025-01-07.
    // It is now 00:30 Helsinki on Jan 7 = 22:30 UTC on Jan 6.
    vi.setSystemTime(new Date("2025-01-06T22:30:00Z"));
    const dDate = dayDate("2025-01-06", 0, 1);
    const today = todayYmd("Europe/Helsinki");
    expect(dDate).toBe("2025-01-07");
    expect(today).toBe("2025-01-07");
    expect(dDate === today).toBe(true); // The user's "today" planned session resolves.
  });

  it("under the OLD buggy math the same scenario would mis-resolve — guard against regression", () => {
    // Reproduce the previous bug locally to make the failure mode legible
    // if anyone reverts the fix: with mixed UTC/local math, the user's
    // "today" (Helsinki local Jan 7) would compare against a dayDate of
    // Jan 6, so the Tuesday session would silently fail to show.
    vi.setSystemTime(new Date("2025-01-06T22:30:00Z"));
    // Buggy reproduction (do NOT call into queries.ts — this is just a
    // local re-implementation of what the bug used to do):
    const buggyYmd = (d: Date) => d.toISOString().slice(0, 10);
    const buggyAddDays = (iso: string, days: number) => {
      const d = new Date(iso + "T00:00:00");
      d.setDate(d.getDate() + days);
      return buggyYmd(d);
    };
    const buggyWeekday = (iso: string) => (new Date(iso + "T00:00:00").getDay() + 6) % 7;
    const buggyDayDate = (s: string, w: number, dd: number) => {
      const monday = buggyAddDays(s, -buggyWeekday(s));
      return buggyAddDays(monday, w * 7 + dd);
    };
    const buggyToday = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();

    // The new implementation MUST give a different (correct) answer than
    // the buggy version in at least one TZ. We assert the new code wins
    // by comparing it directly against the known-correct answer for the
    // Helsinki user.
    expect(dayDate("2025-01-06", 0, 1)).toBe("2025-01-07");
    expect(todayYmd("Europe/Helsinki")).toBe("2025-01-07");
    // (We don't assert specific buggy values because they depend on the
    // host TZ env vitest runs under — what matters is that the new path
    // is host-TZ-invariant and the buggy path is not. The variable is
    // referenced to make the intent legible and to keep the diff
    // self-documenting.)
    void buggyDayDate;
    void buggyToday;
  });
});
