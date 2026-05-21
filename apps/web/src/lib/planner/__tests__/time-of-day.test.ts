/**
 * Time-of-day helper tests.
 *
 * Covers the local-time-in-tz -> UTC conversion that backs the per-session
 * time override on the Plan page, plus the gap computation that drives the
 * DC-D1 warning.
 */
import { describe, it, expect } from "vitest";
import { effectiveTimeOfDay, gapHoursBetween, localTimeToUTC, formatTimeInTz } from "../time-of-day";

describe("localTimeToUTC", () => {
  it("Helsinki summer (EEST = UTC+3): 07:00 local -> 04:00 UTC", () => {
    // 2026-05-21 is in EEST.
    const utc = localTimeToUTC("2026-05-21", "07:00", "Europe/Helsinki");
    expect(utc.toISOString()).toBe("2026-05-21T04:00:00.000Z");
  });

  it("Helsinki winter (EET = UTC+2): 07:00 local -> 05:00 UTC", () => {
    // 2026-01-15 is in EET.
    const utc = localTimeToUTC("2026-01-15", "07:00", "Europe/Helsinki");
    expect(utc.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("UTC tz is identity", () => {
    const utc = localTimeToUTC("2026-05-21", "17:30", "UTC");
    expect(utc.toISOString()).toBe("2026-05-21T17:30:00.000Z");
  });
});

describe("formatTimeInTz", () => {
  it("renders Helsinki morning correctly", () => {
    expect(formatTimeInTz("2026-05-21T04:00:00.000Z", "Europe/Helsinki")).toBe("07:00");
  });
});

describe("effectiveTimeOfDay", () => {
  it("returns plannedAt formatted in tz when set", () => {
    const t = effectiveTimeOfDay({
      slot: "am",
      plannedAt: "2026-05-21T04:30:00.000Z",
      amWindowStart: "07:00:00",
      pmWindowStart: "17:00:00",
      timezone: "Europe/Helsinki",
    });
    expect(t).toBe("07:30");
  });

  it("falls back to amWindowStart when plannedAt is null and slot=am", () => {
    const t = effectiveTimeOfDay({
      slot: "am",
      plannedAt: null,
      amWindowStart: "06:30:00",
      pmWindowStart: "18:00:00",
      timezone: "Europe/Helsinki",
    });
    expect(t).toBe("06:30");
  });

  it("falls back to pmWindowStart when plannedAt is null and slot=pm", () => {
    const t = effectiveTimeOfDay({
      slot: "pm",
      plannedAt: null,
      amWindowStart: "07:00:00",
      pmWindowStart: "17:30:00",
      timezone: "Europe/Helsinki",
    });
    expect(t).toBe("17:30");
  });

  it("returns null for single-session days (no time-of-day surface)", () => {
    expect(
      effectiveTimeOfDay({
        slot: "single",
        plannedAt: null,
        amWindowStart: "07:00:00",
        pmWindowStart: "17:00:00",
        timezone: "Europe/Helsinki",
      }),
    ).toBeNull();
  });
});

describe("gapHoursBetween (DC-D1 6h check)", () => {
  it("07:00 -> 17:00 = 10h gap (compliant)", () => {
    expect(gapHoursBetween("07:00", "17:00")).toBe(10);
  });

  it("07:00 -> 13:00 = 6h gap (right at the boundary)", () => {
    expect(gapHoursBetween("07:00", "13:00")).toBe(6);
  });

  it("08:00 -> 11:00 = 3h gap (warn territory)", () => {
    expect(gapHoursBetween("08:00", "11:00")).toBe(3);
  });

  it("07:30 -> 13:00 = 5.5h gap (just below)", () => {
    expect(gapHoursBetween("07:30", "13:00")).toBe(5.5);
  });

  it("inverted order returns 0 (we never expect AM later than PM)", () => {
    expect(gapHoursBetween("18:00", "07:00")).toBe(0);
  });
});
