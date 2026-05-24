import { describe, expect, it } from "vitest";
import {
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  formatDate,
  formatDateTime,
  formatEyebrowDate,
  formatTime,
  isDateFormat,
  isTimeFormat,
  resolveDateFormat,
  resolveTimeFormat,
} from "../datetime";

// A fixed instant: 2026-05-24 17:30 UTC (a Sunday).
const SAMPLE = new Date(Date.UTC(2026, 4, 24, 17, 30, 0));

describe("resolveTimeFormat", () => {
  it("returns explicit override when set", () => {
    expect(resolveTimeFormat({ time_format: "12h" })).toBe("12h");
    expect(resolveTimeFormat({ time_format: "24h" })).toBe("24h");
  });
  it("ignores unknown override strings and falls back", () => {
    expect(resolveTimeFormat({ time_format: "bogus", timezone: "UTC" })).toBe("24h");
  });
  it("infers 12h for America/* tz", () => {
    expect(resolveTimeFormat({ timezone: "America/New_York" })).toBe("12h");
    expect(resolveTimeFormat({ timezone: "America/Los_Angeles" })).toBe("12h");
  });
  it("infers 24h for Europe/Asia/Africa/Australia/UTC", () => {
    expect(resolveTimeFormat({ timezone: "Europe/Helsinki" })).toBe("24h");
    expect(resolveTimeFormat({ timezone: "Asia/Tokyo" })).toBe("24h");
    expect(resolveTimeFormat({ timezone: "Africa/Cairo" })).toBe("24h");
    expect(resolveTimeFormat({ timezone: "Australia/Sydney" })).toBe("24h");
    expect(resolveTimeFormat({ timezone: "UTC" })).toBe("24h");
  });
  it("returns 24h for null/undefined/empty profile", () => {
    expect(resolveTimeFormat(null)).toBe("24h");
    expect(resolveTimeFormat(undefined)).toBe("24h");
    expect(resolveTimeFormat({})).toBe("24h");
  });
});

describe("resolveDateFormat", () => {
  it("returns explicit override when set", () => {
    expect(resolveDateFormat({ date_format: "iso" })).toBe("iso");
    expect(resolveDateFormat({ date_format: "dmy_long" })).toBe("dmy_long");
    expect(resolveDateFormat({ date_format: "mdy_short" })).toBe("mdy_short");
  });
  it("ignores unknown override strings and falls back", () => {
    expect(
      resolveDateFormat({ date_format: "bogus", timezone: "Europe/Helsinki" }),
    ).toBe("dmy_short");
  });
  it("infers dmy_short for Europe + Africa + Australia", () => {
    expect(resolveDateFormat({ timezone: "Europe/Helsinki" })).toBe("dmy_short");
    expect(resolveDateFormat({ timezone: "Africa/Cairo" })).toBe("dmy_short");
    expect(resolveDateFormat({ timezone: "Australia/Sydney" })).toBe("dmy_short");
  });
  it("infers mdy_short for America/*", () => {
    expect(resolveDateFormat({ timezone: "America/New_York" })).toBe("mdy_short");
  });
  it("defaults to iso for Asia/UTC/unknown/null", () => {
    expect(resolveDateFormat({ timezone: "Asia/Tokyo" })).toBe("iso");
    expect(resolveDateFormat({ timezone: "UTC" })).toBe("iso");
    expect(resolveDateFormat({ timezone: "Etc/Unknown" })).toBe("iso");
    expect(resolveDateFormat(null)).toBe("iso");
    expect(resolveDateFormat(undefined)).toBe("iso");
    expect(resolveDateFormat({})).toBe("iso");
  });
});

describe("formatTime", () => {
  it("24h in UTC renders zero-padded HH:MM", () => {
    expect(formatTime(SAMPLE, { time_format: "24h", timezone: "UTC" })).toBe("17:30");
  });
  it("12h in UTC renders with PM suffix", () => {
    expect(formatTime(SAMPLE, { time_format: "12h", timezone: "UTC" })).toBe("5:30 PM");
  });
  it("respects timezone offset", () => {
    // 17:30 UTC == 20:30 in Helsinki (UTC+3 in May/DST).
    expect(formatTime(SAMPLE, { time_format: "24h", timezone: "Europe/Helsinki" })).toBe(
      "20:30",
    );
    // 17:30 UTC == 13:30 in NYC (UTC-4 in May/DST) → 1:30 PM.
    expect(formatTime(SAMPLE, { time_format: "12h", timezone: "America/New_York" })).toBe(
      "1:30 PM",
    );
  });
  it("falls back via timezone when format unset", () => {
    expect(formatTime(SAMPLE, { timezone: "America/New_York" })).toBe("1:30 PM");
    expect(formatTime(SAMPLE, { timezone: "Europe/Helsinki" })).toBe("20:30");
  });
  it("accepts ISO string input", () => {
    expect(
      formatTime("2026-05-24T17:30:00Z", { time_format: "24h", timezone: "UTC" }),
    ).toBe("17:30");
  });
});

describe("formatDate — every format × every mode", () => {
  const profile = (fmt: string) => ({ date_format: fmt, timezone: "UTC" });

  it("mode='date'", () => {
    expect(formatDate(SAMPLE, profile("iso"))).toBe("2026-05-24");
    expect(formatDate(SAMPLE, profile("dmy_long"))).toBe("24 May 2026");
    expect(formatDate(SAMPLE, profile("mdy_long"))).toBe("May 24, 2026");
    expect(formatDate(SAMPLE, profile("dmy_short"))).toBe("24/05/2026");
    expect(formatDate(SAMPLE, profile("mdy_short"))).toBe("05/24/2026");
  });

  it("mode='short_date'", () => {
    expect(formatDate(SAMPLE, profile("iso"), "short_date")).toBe("05-24");
    expect(formatDate(SAMPLE, profile("dmy_long"), "short_date")).toBe("24 May");
    expect(formatDate(SAMPLE, profile("mdy_long"), "short_date")).toBe("May 24");
    expect(formatDate(SAMPLE, profile("dmy_short"), "short_date")).toBe("24 May");
    expect(formatDate(SAMPLE, profile("mdy_short"), "short_date")).toBe("May 24");
  });

  it("mode='weekday_short'", () => {
    expect(formatDate(SAMPLE, profile("iso"), "weekday_short")).toBe("Sun 2026-05-24");
    expect(formatDate(SAMPLE, profile("dmy_long"), "weekday_short")).toBe("Sun 24 May");
    expect(formatDate(SAMPLE, profile("mdy_long"), "weekday_short")).toBe("Sun May 24");
    expect(formatDate(SAMPLE, profile("dmy_short"), "weekday_short")).toBe("Sun 24 May");
    expect(formatDate(SAMPLE, profile("mdy_short"), "weekday_short")).toBe("Sun May 24");
  });

  it("respects timezone for the calendar date", () => {
    // 2026-05-24 23:30 UTC === 2026-05-25 02:30 in Helsinki.
    const late = new Date(Date.UTC(2026, 4, 24, 23, 30, 0));
    expect(
      formatDate(late, { date_format: "dmy_short", timezone: "Europe/Helsinki" }),
    ).toBe("25/05/2026");
    expect(formatDate(late, { date_format: "dmy_short", timezone: "UTC" })).toBe(
      "24/05/2026",
    );
  });

  it("uses ISO fallback when profile is null", () => {
    expect(formatDate(SAMPLE, null)).toBe("2026-05-24");
    expect(formatDate(SAMPLE, undefined)).toBe("2026-05-24");
  });

  it("accepts ISO string input", () => {
    expect(
      formatDate("2026-05-24T00:00:00Z", { date_format: "dmy_long", timezone: "UTC" }),
    ).toBe("24 May 2026");
  });
});

describe("formatDateTime", () => {
  it("combines date + time in the user's formats", () => {
    expect(
      formatDateTime(SAMPLE, {
        date_format: "dmy_short",
        time_format: "24h",
        timezone: "Europe/Helsinki",
      }),
    ).toBe("24/05/2026 20:30");
    expect(
      formatDateTime(SAMPLE, {
        date_format: "mdy_long",
        time_format: "12h",
        timezone: "America/New_York",
      }),
    ).toBe("May 24, 2026 1:30 PM");
  });
});

describe("formatEyebrowDate", () => {
  it("upper-cases the weekday_short flavour", () => {
    expect(
      formatEyebrowDate(SAMPLE, { date_format: "dmy_short", timezone: "UTC" }),
    ).toBe("SUN 24 MAY");
    expect(
      formatEyebrowDate(SAMPLE, { date_format: "mdy_short", timezone: "UTC" }),
    ).toBe("SUN MAY 24");
    expect(
      formatEyebrowDate(SAMPLE, { date_format: "iso", timezone: "UTC" }),
    ).toBe("SUN 2026-05-24");
  });
});

describe("option catalogues", () => {
  it("TIME_FORMAT_OPTIONS shape", () => {
    expect(TIME_FORMAT_OPTIONS.map((o) => o.id).sort()).toEqual(["12h", "24h"]);
  });
  it("DATE_FORMAT_OPTIONS shape", () => {
    expect(DATE_FORMAT_OPTIONS.map((o) => o.id)).toEqual([
      "iso",
      "dmy_long",
      "mdy_long",
      "dmy_short",
      "mdy_short",
    ]);
  });
});

describe("guards", () => {
  it("isTimeFormat", () => {
    expect(isTimeFormat("12h")).toBe(true);
    expect(isTimeFormat("24h")).toBe(true);
    expect(isTimeFormat("48h")).toBe(false);
    expect(isTimeFormat(null)).toBe(false);
  });
  it("isDateFormat", () => {
    for (const id of ["iso", "dmy_long", "mdy_long", "dmy_short", "mdy_short"]) {
      expect(isDateFormat(id)).toBe(true);
    }
    expect(isDateFormat("ymd")).toBe(false);
    expect(isDateFormat(null)).toBe(false);
  });
});
