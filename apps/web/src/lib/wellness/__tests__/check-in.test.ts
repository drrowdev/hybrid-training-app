import { describe, it, expect } from "vitest";
import {
  dailyCheckInSchema,
  dailyCheckInUpsertColumns,
  sleepHoursForChip,
} from "../check-in";

describe("sleepHoursForChip — Phase 3 B1 mapping", () => {
  it("'<6h' → 5.5", () => {
    expect(sleepHoursForChip("lt6")).toBe(5.5);
  });
  it("'6-8h' → 7", () => {
    expect(sleepHoursForChip("6to8")).toBe(7);
  });
  it("'8h+' → 8.5", () => {
    expect(sleepHoursForChip("gte8")).toBe(8.5);
  });
});

describe("dailyCheckInSchema — input validation", () => {
  it("parses a bodyweight-only payload", () => {
    const r = dailyCheckInSchema.safeParse({
      date: "2026-05-23",
      bodyweightKg: "84.2",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bodyweightKg).toBe(84.2);
  });
  it("rejects out-of-range bodyweight", () => {
    expect(
      dailyCheckInSchema.safeParse({ date: "2026-05-23", bodyweightKg: 9 }).success,
    ).toBe(false);
    expect(
      dailyCheckInSchema.safeParse({ date: "2026-05-23", bodyweightKg: 500 }).success,
    ).toBe(false);
  });
  it("rejects an invalid sleep chip value", () => {
    expect(
      dailyCheckInSchema.safeParse({ date: "2026-05-23", sleepChip: "bogus" }).success,
    ).toBe(false);
  });
  it("rejects motivation outside 1-5", () => {
    expect(
      dailyCheckInSchema.safeParse({ date: "2026-05-23", motivation: 0 }).success,
    ).toBe(false);
    expect(
      dailyCheckInSchema.safeParse({ date: "2026-05-23", motivation: 6 }).success,
    ).toBe(false);
  });
});

describe("dailyCheckInUpsertColumns — Phase 3 A1 upsert shape", () => {
  it("emits only the keys the caller supplied (bodyweight only)", () => {
    const cols = dailyCheckInUpsertColumns({
      date: "2026-05-23",
      bodyweightKg: 84.5,
    });
    expect(cols).toEqual({ date: "2026-05-23", bodyweight_kg: 84.5 });
    expect(Object.prototype.hasOwnProperty.call(cols, "sleep_hours")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(cols, "motivation")).toBe(false);
  });

  it("prefers sleepChip over explicit sleepHours when both are given", () => {
    const cols = dailyCheckInUpsertColumns({
      date: "2026-05-23",
      sleepChip: "gte8",
      sleepHours: 6.3,
    });
    expect(cols.sleep_hours).toBe(8.5);
  });

  it("falls back to explicit sleepHours when chip is missing", () => {
    const cols = dailyCheckInUpsertColumns({
      date: "2026-05-23",
      sleepHours: 7.4,
    });
    expect(cols.sleep_hours).toBe(7.4);
  });

  it("nulls a field when the caller explicitly passes null", () => {
    const cols = dailyCheckInUpsertColumns({
      date: "2026-05-23",
      notes: null,
    });
    expect(cols.notes).toBeNull();
  });
});
