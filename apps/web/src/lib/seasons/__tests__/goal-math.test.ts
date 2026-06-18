/**
 * Season goal back-calc tests (ADR 0051 Phase 1). Pure, client-safe date math.
 */
import { describe, it, expect } from "vitest";
import {
  weeksUntil,
  remainingPlannedWeeks,
  goalRunwayStatus,
  DEFAULT_BLOCK_WEEKS,
} from "../goal-math";

describe("goal back-calc helpers", () => {
  it("weeksUntil rounds whole weeks up and rejects past/empty dates", () => {
    expect(weeksUntil("2026-06-18", "2026-06-25")).toBe(1); // 7 days
    expect(weeksUntil("2026-06-18", "2026-07-16")).toBe(4); // 28 days
    expect(weeksUntil("2026-06-18", "2026-07-15")).toBe(4); // 27 days → ceil
    expect(weeksUntil("2026-06-18", null)).toBeNull();
    expect(weeksUntil("2026-06-18", "2026-06-18")).toBeNull(); // not in the future
    expect(weeksUntil("2026-06-18", "2026-06-01")).toBeNull(); // past
  });

  it("remainingPlannedWeeks sums planned+active using the fallback for nulls", () => {
    const total = remainingPlannedWeeks([
      { status: "done", plannedWeeks: 4 }, // excluded
      { status: "active", plannedWeeks: 6 },
      { status: "planned", plannedWeeks: null }, // fallback
      { status: "planned", plannedWeeks: 3 },
    ]);
    expect(total).toBe(6 + DEFAULT_BLOCK_WEEKS + 3);
  });

  it("goalRunwayStatus flags over/tight/ok and null without a goal", () => {
    expect(goalRunwayStatus(null, 10)).toBeNull();
    expect(goalRunwayStatus(8, 12)).toBe("over"); // blocks exceed runway
    expect(goalRunwayStatus(10, 8)).toBe("tight"); // within one block-length
    expect(goalRunwayStatus(20, 8)).toBe("ok"); // comfortable
  });
});
