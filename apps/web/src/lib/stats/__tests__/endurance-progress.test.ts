import { describe, it, expect } from "vitest";
import {
  classifyPaceSlope,
  ENDURANCE_PACE_SLOPE_EPSILON_SEC_PER_KM_PER_WEEK,
  ENDURANCE_MIN_WEEKS,
  type EasyRunSample,
} from "../endurance-progress";

/** Generate one sample at (week-relative offset) `weekOffset` weeks from a fixed base Monday. */
function sample(weekOffset: number, pace: number, dayInWeek = 1): EasyRunSample {
  // 2026-04-06 = Monday.
  const base = Date.UTC(2026, 3, 6); // months are 0-indexed
  const ts = base + (weekOffset * 7 + dayInWeek) * 86_400_000;
  return {
    performedAt: new Date(ts).toISOString(),
    avgPaceSecPerKm: pace,
  };
}

describe("classifyPaceSlope — pure pace-slope classifier", () => {
  it("no-run-data when there are zero samples", () => {
    const r = classifyPaceSlope([]);
    expect(r.direction).toBe("no-run-data");
    expect(r.easyPaceSecPerKm).toBeNull();
    expect(r.slopeSecPerKmPerWeek).toBeNull();
  });

  it("building when fewer than min-weeks of data", () => {
    expect(ENDURANCE_MIN_WEEKS).toBeGreaterThanOrEqual(2);
    // Two runs in the same week.
    const r = classifyPaceSlope([sample(0, 360, 1), sample(0, 350, 3)]);
    expect(r.direction).toBe("building");
    expect(r.slopeSecPerKmPerWeek).toBeNull();
    expect(r.easyPaceSecPerKm).toBe(355);
  });

  it("faster ('up') — pace dropping week over week", () => {
    // 5 weeks, pace falling by ~10 sec/km/week.
    const samples = [0, 1, 2, 3, 4].map((w) => sample(w, 360 - 10 * w));
    const r = classifyPaceSlope(samples);
    expect(r.direction).toBe("up");
    expect(r.slopeSecPerKmPerWeek).toBeLessThan(0);
  });

  it("slower ('down') — pace rising week over week", () => {
    const samples = [0, 1, 2, 3, 4].map((w) => sample(w, 360 + 10 * w));
    const r = classifyPaceSlope(samples);
    expect(r.direction).toBe("down");
    expect(r.slopeSecPerKmPerWeek).toBeGreaterThan(0);
  });

  it("flat — slope inside ±epsilon", () => {
    const eps = ENDURANCE_PACE_SLOPE_EPSILON_SEC_PER_KM_PER_WEEK;
    // A tiny per-week movement under epsilon.
    const samples = [0, 1, 2, 3, 4].map((w) => sample(w, 360 + (eps * 0.4) * w));
    const r = classifyPaceSlope(samples);
    expect(r.direction).toBe("flat");
    expect(Math.abs(r.slopeSecPerKmPerWeek!)).toBeLessThan(eps);
  });

  it("epsilon boundary — slope just above ε flips from flat to up/down", () => {
    const eps = ENDURANCE_PACE_SLOPE_EPSILON_SEC_PER_KM_PER_WEEK;
    const samples = [0, 1, 2, 3, 4].map((w) => sample(w, 360 - eps * 2 * w));
    const r = classifyPaceSlope(samples);
    expect(r.direction).toBe("up");
  });

  it("multi-sample week → mean within week is used for slope", () => {
    // Week 0: two samples averaging 360.
    // Week 1..3: single sample dropping by 10s/wk.
    const samples = [
      sample(0, 350, 1),
      sample(0, 370, 3),
      sample(1, 350),
      sample(2, 340),
      sample(3, 330),
    ];
    const r = classifyPaceSlope(samples);
    expect(r.direction).toBe("up");
    expect(r.slopeSecPerKmPerWeek).toBeLessThan(0);
  });

  it("easyPaceSecPerKm is rounded mean across all samples", () => {
    const samples = [
      sample(0, 360),
      sample(1, 358),
      sample(2, 356),
      sample(3, 354),
    ];
    const r = classifyPaceSlope(samples);
    expect(r.easyPaceSecPerKm).toBe(357);
  });
});
