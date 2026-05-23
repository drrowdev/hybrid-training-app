import { describe, it, expect } from "vitest";
import {
  dailyCheckInSchema,
  dailyCheckInUpsertColumns,
} from "../check-in";

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
  it("rejects motivation outside 1-5", () => {
    expect(
      dailyCheckInSchema.safeParse({ date: "2026-05-23", motivation: 0 }).success,
    ).toBe(false);
    expect(
      dailyCheckInSchema.safeParse({ date: "2026-05-23", motivation: 6 }).success,
    ).toBe(false);
  });
});

describe("dailyCheckInUpsertColumns — upsert shape", () => {
  it("emits only the keys the caller supplied (bodyweight only)", () => {
    const cols = dailyCheckInUpsertColumns({
      date: "2026-05-23",
      bodyweightKg: 84.5,
    });
    expect(cols).toEqual({ date: "2026-05-23", bodyweight_kg: 84.5 });
    expect(Object.prototype.hasOwnProperty.call(cols, "motivation")).toBe(false);
  });

  it("nulls a field when the caller explicitly passes null", () => {
    const cols = dailyCheckInUpsertColumns({
      date: "2026-05-23",
      notes: null,
    });
    expect(cols.notes).toBeNull();
  });
});
