/**
 * Unit tests for `isLateLogged`.
 *
 * The helper is a thin wrapper around `ymdInTimezone` + string
 * compare, but the timezone-edge cases (user at UTC-12 vs UTC+12)
 * have bitten us before — pin them.
 */
import { describe, it, expect } from "vitest";
import { isLateLogged } from "../late-logged";

describe("isLateLogged", () => {
  it("returns false when there is no planned date", () => {
    expect(isLateLogged(null, "2026-05-19T10:00:00Z", "UTC")).toBe(false);
  });

  it("returns false when performed on the planned day (same day)", () => {
    expect(isLateLogged("2026-05-19", "2026-05-19T10:00:00Z", "UTC")).toBe(false);
  });

  it("returns true when performed one day after the planned day", () => {
    expect(isLateLogged("2026-05-18", "2026-05-19T10:00:00Z", "UTC")).toBe(true);
  });

  it("returns true when performed multiple days late", () => {
    expect(isLateLogged("2026-05-10", "2026-05-19T10:00:00Z", "UTC")).toBe(true);
  });

  it("returns false when performed earlier than the planned day", () => {
    expect(isLateLogged("2026-05-25", "2026-05-19T10:00:00Z", "UTC")).toBe(false);
  });

  it("evaluates the calendar in the user's tz: UTC+12 sees a later date", () => {
    // performed_at is 2026-05-18T23:00:00Z. In Pacific/Auckland (UTC+12
    // during this period) that's 2026-05-19 local. Planned for the
    // 18th → late.
    expect(
      isLateLogged("2026-05-18", "2026-05-18T23:00:00Z", "Pacific/Auckland"),
    ).toBe(true);
  });

  it("evaluates the calendar in the user's tz: UTC-12 still sees the earlier date", () => {
    // Same instant 2026-05-18T23:00:00Z, but in Etc/GMT+12 (UTC-12)
    // the wall clock reads 2026-05-18 11:00 — still the 18th. Planned
    // 18th → not late.
    expect(
      isLateLogged("2026-05-18", "2026-05-18T23:00:00Z", "Etc/GMT+12"),
    ).toBe(false);
  });

  it("accepts a Date object too", () => {
    expect(
      isLateLogged("2026-05-18", new Date("2026-05-19T10:00:00Z"), "UTC"),
    ).toBe(true);
  });

  it("returns false on unparseable performed_at strings", () => {
    expect(isLateLogged("2026-05-18", "not-a-date", "UTC")).toBe(false);
  });
});
