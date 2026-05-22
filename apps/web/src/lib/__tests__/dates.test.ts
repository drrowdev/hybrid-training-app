/**
 * Unit tests for the centralised tz-aware date helpers in
 * `apps/web/src/lib/dates.ts`. The dayDate / todayYmd integration
 * scenarios live in `lib/planner/__tests__/daydate-tz.test.ts` — this
 * file focuses on the new pure-arithmetic helpers and on the Helsinki
 * DST edge cases the PR description called out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDaysToYmd,
  daysBetweenYmd,
  isoWeekdayYmd,
  mondayOfYmd,
  todayYmd,
  ymdInTimezone,
} from "@/lib/dates";

describe("todayYmd(tz)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("default (no tz) — uses the host clock and formats as YYYY-MM-DD", () => {
    // 12:00 UTC: every reasonable tz agrees on the date, and the no-arg
    // fallback (host local) also lands on the same day for any host TZ
    // that vitest happens to run under.
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
    expect(todayYmd()).toMatch(/^2026-04-1[45]$/);
  });

  it("Europe/Helsinki winter — 22:30 UTC is already next-day local", () => {
    vi.setSystemTime(new Date("2025-01-06T22:30:00Z"));
    expect(todayYmd("Europe/Helsinki")).toBe("2025-01-07");
    expect(todayYmd("UTC")).toBe("2025-01-06");
  });

  it("Europe/Helsinki summer (EEST, UTC+3) — DST shift handled by Intl", () => {
    vi.setSystemTime(new Date("2025-06-15T21:30:00Z"));
    expect(todayYmd("Europe/Helsinki")).toBe("2025-06-16");
  });
});

describe("ymdInTimezone", () => {
  it("formats a given instant in the requested zone", () => {
    const instant = new Date("2025-01-06T22:30:00Z");
    expect(ymdInTimezone(instant, "UTC")).toBe("2025-01-06");
    expect(ymdInTimezone(instant, "Europe/Helsinki")).toBe("2025-01-07");
    expect(ymdInTimezone(instant, "America/Los_Angeles")).toBe("2025-01-06");
  });

  it("respects DST in the target zone", () => {
    // Right before EEST -> EET fall-back (last Sun of October 2025, 03:00 local).
    // 2025-10-26T00:30:00Z = 03:30 EEST or 02:30 EET depending on the clock —
    // either way the calendar date is the 26th.
    const instant = new Date("2025-10-26T00:30:00Z");
    expect(ymdInTimezone(instant, "Europe/Helsinki")).toBe("2025-10-26");
  });
});

describe("addDaysToYmd", () => {
  it("adds positive and negative day counts", () => {
    expect(addDaysToYmd("2025-01-06", 1)).toBe("2025-01-07");
    expect(addDaysToYmd("2025-01-06", 7)).toBe("2025-01-13");
    expect(addDaysToYmd("2025-01-06", -1)).toBe("2025-01-05");
    expect(addDaysToYmd("2025-01-06", 0)).toBe("2025-01-06");
  });

  it("does not drift across DST — Europe/Helsinki spring-forward 2025-03-30", () => {
    // EET -> EEST at 03:00 local on 2025-03-30. A naive setHours-based
    // implementation would drop or duplicate an hour and ±1-day-shift
    // the result. Our UTC-anchored arithmetic gives the exact ISO date.
    expect(addDaysToYmd("2025-03-29", 1)).toBe("2025-03-30");
    expect(addDaysToYmd("2025-03-29", 2)).toBe("2025-03-31");
    expect(addDaysToYmd("2025-03-30", 7)).toBe("2025-04-06");
  });

  it("does not drift across DST — Europe/Helsinki fall-back 2025-10-26", () => {
    expect(addDaysToYmd("2025-10-25", 1)).toBe("2025-10-26");
    expect(addDaysToYmd("2025-10-25", 2)).toBe("2025-10-27");
    expect(addDaysToYmd("2025-10-26", 7)).toBe("2025-11-02");
  });

  it("crosses month and year boundaries", () => {
    expect(addDaysToYmd("2025-01-31", 1)).toBe("2025-02-01");
    expect(addDaysToYmd("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDaysToYmd("2025-03-01", -1)).toBe("2025-02-28");
    expect(addDaysToYmd("2024-03-01", -1)).toBe("2024-02-29"); // leap year
  });
});

describe("daysBetweenYmd", () => {
  it("returns whole-day diffs regardless of host TZ", () => {
    expect(daysBetweenYmd("2025-01-06", "2025-01-06")).toBe(0);
    expect(daysBetweenYmd("2025-01-06", "2025-01-13")).toBe(7);
    expect(daysBetweenYmd("2025-01-13", "2025-01-06")).toBe(-7);
  });

  it("survives DST in Europe/Helsinki (spring forward + fall back)", () => {
    // Spring forward — UTC math would say 6.958 days if we used 24h*60min
    // arithmetic with local-tz Dates. The UTC-anchored helper always
    // returns the exact integer.
    expect(daysBetweenYmd("2025-03-23", "2025-03-30")).toBe(7);
    expect(daysBetweenYmd("2025-03-29", "2025-03-31")).toBe(2);
    // Fall back — same reasoning in the other direction.
    expect(daysBetweenYmd("2025-10-19", "2025-10-26")).toBe(7);
    expect(daysBetweenYmd("2025-10-25", "2025-10-27")).toBe(2);
  });

  it("respects host TZ env var being set to a non-UTC zone", () => {
    const originalTZ = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14, max offset
      expect(daysBetweenYmd("2025-01-06", "2025-01-13")).toBe(7);
      process.env.TZ = "Pacific/Pago_Pago"; // UTC-11
      expect(daysBetweenYmd("2025-01-06", "2025-01-13")).toBe(7);
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});

describe("isoWeekdayYmd", () => {
  it("Mon=0 ... Sun=6", () => {
    expect(isoWeekdayYmd("2025-01-06")).toBe(0); // Mon
    expect(isoWeekdayYmd("2025-01-07")).toBe(1); // Tue
    expect(isoWeekdayYmd("2025-01-12")).toBe(6); // Sun
  });
});

describe("mondayOfYmd", () => {
  it("snaps Mon-Sun ymd values back to that week's Monday", () => {
    expect(mondayOfYmd("2025-01-06")).toBe("2025-01-06"); // Mon
    expect(mondayOfYmd("2025-01-08")).toBe("2025-01-06"); // Wed
    expect(mondayOfYmd("2025-01-12")).toBe("2025-01-06"); // Sun
    expect(mondayOfYmd("2025-01-13")).toBe("2025-01-13"); // next Mon
  });

  it("does not drift on DST boundaries", () => {
    // 2025-03-30 (DST start, Helsinki) is a Sunday. Its Monday is 2025-03-24.
    expect(mondayOfYmd("2025-03-30")).toBe("2025-03-24");
    // 2025-10-26 (DST end, Helsinki) is a Sunday. Its Monday is 2025-10-20.
    expect(mondayOfYmd("2025-10-26")).toBe("2025-10-20");
  });
});
