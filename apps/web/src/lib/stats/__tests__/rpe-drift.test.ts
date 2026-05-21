import { describe, it, expect } from "vitest";
import { leastSquaresSlope } from "../rpe-drift-queries";

describe("leastSquaresSlope", () => {
  it("returns 0 for fewer than 2 points", () => {
    expect(leastSquaresSlope([])).toBe(0);
    expect(leastSquaresSlope([{ date: "2026-05-01", rpe: 7 }])).toBe(0);
  });

  it("detects a rising trend", () => {
    const points = [
      { date: "2026-05-01", rpe: 6 },
      { date: "2026-05-08", rpe: 6.5 },
      { date: "2026-05-15", rpe: 7 },
      { date: "2026-05-22", rpe: 7.5 },
    ];
    const slope = leastSquaresSlope(points);
    expect(slope).toBeGreaterThan(0);
    // ~0.5 sRPE per week = ~0.07 per day
    expect(slope).toBeCloseTo(0.0714, 2);
  });

  it("detects a falling trend (easing)", () => {
    const points = [
      { date: "2026-05-01", rpe: 8 },
      { date: "2026-05-08", rpe: 7.5 },
      { date: "2026-05-15", rpe: 7 },
      { date: "2026-05-22", rpe: 6.5 },
    ];
    expect(leastSquaresSlope(points)).toBeLessThan(0);
  });

  it("returns ~0 for noisy but flat data", () => {
    const points = [
      { date: "2026-05-01", rpe: 7 },
      { date: "2026-05-05", rpe: 7.5 },
      { date: "2026-05-10", rpe: 6.5 },
      { date: "2026-05-15", rpe: 7 },
      { date: "2026-05-20", rpe: 7.2 },
      { date: "2026-05-25", rpe: 6.8 },
    ];
    const slope = leastSquaresSlope(points);
    expect(Math.abs(slope)).toBeLessThan(0.02);
  });

  it("returns 0 when all points fall on the same day (no time spread)", () => {
    const points = [
      { date: "2026-05-01", rpe: 6 },
      { date: "2026-05-01", rpe: 7 },
      { date: "2026-05-01", rpe: 8 },
    ];
    expect(leastSquaresSlope(points)).toBe(0);
  });
});
