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
  it("ignores retired check-in fields without failing", () => {
    // The daily wellness check-in was retired; extra keys are stripped
    // rather than rejected so any stale client payload still parses.
    const r = dailyCheckInSchema.safeParse({
      date: "2026-05-23",
      bodyweightKg: 84.2,
      motivation: 3,
      fatigue: 5,
      soreness: 5,
      notes: "ignored",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(Object.prototype.hasOwnProperty.call(r.data, "motivation")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(r.data, "fatigue")).toBe(false);
    }
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

  it("nulls bodyweight when the caller explicitly passes null", () => {
    const cols = dailyCheckInUpsertColumns({
      date: "2026-05-23",
      bodyweightKg: null,
    });
    expect(cols.bodyweight_kg).toBeNull();
  });

  it("emits only the date when no bodyweight is supplied", () => {
    const cols = dailyCheckInUpsertColumns({ date: "2026-05-23" });
    expect(cols).toEqual({ date: "2026-05-23" });
  });
});
