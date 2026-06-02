/**
 * Unit tests for the pure live-cardio-tracker helpers.
 *
 * These cover the GPS accuracy/jitter gates, distance accumulation,
 * pace/clock/distance formatting and unit conversion — the arithmetic the
 * `LiveCardioTracker` component relies on but cannot exercise under the
 * node test environment.
 */
import { describe, it, expect } from "vitest";
import {
  initTrackState,
  haversineMeters,
  accumulateSample,
  metersToDisplay,
  metersToKm,
  paceSecPerUnit,
  speedToPaceSecPerUnit,
  formatPace,
  formatClock,
  formatDistance,
  elapsedToDurationMin,
  type GpsSample,
} from "../live-tracker";

const sample = (
  lat: number,
  lon: number,
  accuracyM = 5,
  t = 0,
): GpsSample => ({ lat, lon, accuracyM, t });

describe("haversineMeters", () => {
  it("is ~zero for identical points", () => {
    expect(haversineMeters(60.17, 24.94, 60.17, 24.94)).toBeCloseTo(0, 6);
  });

  it("matches a known short distance (~111m per 0.001° latitude)", () => {
    const d = haversineMeters(60.17, 24.94, 60.171, 24.94);
    expect(d).toBeGreaterThan(108);
    expect(d).toBeLessThan(114);
  });

  it("is symmetric", () => {
    const a = haversineMeters(60.17, 24.94, 60.18, 24.95);
    const b = haversineMeters(60.18, 24.95, 60.17, 24.94);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe("accumulateSample", () => {
  it("first trusted fix becomes the anchor with zero distance", () => {
    const s = accumulateSample(initTrackState(), sample(60.17, 24.94));
    expect(s.anchor).not.toBeNull();
    expect(s.totalMeters).toBe(0);
    expect(s.accepted).toBe(1);
  });

  it("rejects samples worse than the accuracy gate", () => {
    const s = accumulateSample(initTrackState(), sample(60.17, 24.94, 80));
    expect(s.anchor).toBeNull();
    expect(s.rejected).toBe(1);
  });

  it("rejects non-finite coordinates", () => {
    const s = accumulateSample(initTrackState(), sample(NaN, 24.94));
    expect(s.anchor).toBeNull();
    expect(s.rejected).toBe(1);
  });

  it("accumulates a real moving segment", () => {
    let s = accumulateSample(initTrackState(), sample(60.17, 24.94, 5, 0));
    s = accumulateSample(s, sample(60.171, 24.94, 5, 1000));
    expect(s.totalMeters).toBeGreaterThan(108);
    expect(s.accepted).toBe(2);
  });

  it("rejects stationary drift below the gate but keeps the anchor", () => {
    let s = accumulateSample(initTrackState(), sample(60.17, 24.94, 10, 0));
    const anchor = s.anchor;
    // ~1m jitter with 10m accuracy → gate is 5m → rejected.
    s = accumulateSample(s, sample(60.170009, 24.94, 10, 1000));
    expect(s.totalMeters).toBe(0);
    expect(s.rejected).toBe(1);
    expect(s.anchor).toBe(anchor); // anchor held
  });

  it("measures the full segment from the held anchor once movement crosses the gate", () => {
    let s = accumulateSample(initTrackState(), sample(60.17, 24.94, 10, 0));
    // tiny jitter rejected
    s = accumulateSample(s, sample(60.170009, 24.94, 10, 1000));
    // then real movement: full distance from the ORIGINAL anchor counts
    s = accumulateSample(s, sample(60.171, 24.94, 10, 2000));
    expect(s.totalMeters).toBeGreaterThan(108);
    expect(s.totalMeters).toBeLessThan(120);
  });

  it("does not mutate the input state", () => {
    const base = initTrackState();
    const next = accumulateSample(base, sample(60.17, 24.94));
    expect(base.anchor).toBeNull();
    expect(base.accepted).toBe(0);
    expect(next).not.toBe(base);
  });
});

describe("unit conversion", () => {
  it("metersToDisplay converts to km", () => {
    expect(metersToDisplay(1000, "metric")).toBeCloseTo(1, 9);
  });
  it("metersToDisplay converts to mi", () => {
    expect(metersToDisplay(1609.344, "imperial")).toBeCloseTo(1, 9);
  });
  it("metersToKm", () => {
    expect(metersToKm(2500)).toBeCloseTo(2.5, 9);
  });
});

describe("pace", () => {
  it("paceSecPerUnit: 5:00 min/km for 1km in 300s", () => {
    expect(paceSecPerUnit(300, 1000, "metric")).toBeCloseTo(300, 6);
  });
  it("paceSecPerUnit returns null with no distance", () => {
    expect(paceSecPerUnit(300, 0, "metric")).toBeNull();
  });
  it("speedToPaceSecPerUnit: 5 m/s → 200 s/km", () => {
    expect(speedToPaceSecPerUnit(5, "metric")).toBeCloseTo(200, 6);
  });
  it("speedToPaceSecPerUnit returns null when near-stationary", () => {
    expect(speedToPaceSecPerUnit(0.1, "metric")).toBeNull();
    expect(speedToPaceSecPerUnit(null, "metric")).toBeNull();
  });
  it("formatPace renders m:ss and a dash for null", () => {
    expect(formatPace(330)).toBe("5:30");
    expect(formatPace(65)).toBe("1:05");
    expect(formatPace(null)).toBe("—");
    expect(formatPace(0)).toBe("—");
  });
});

describe("formatClock", () => {
  it("renders m:ss under an hour", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(599)).toBe("9:59");
  });
  it("renders h:mm:ss at or above an hour", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3723)).toBe("1:02:03");
  });
  it("clamps negatives to zero", () => {
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("formatDistance", () => {
  it("rounds to 2dp", () => {
    expect(formatDistance(1.23456)).toBe("1.23");
    expect(formatDistance(0)).toBe("0.00");
  });
  it("guards bad input", () => {
    expect(formatDistance(NaN)).toBe("0.00");
    expect(formatDistance(-1)).toBe("0.00");
  });
});

describe("elapsedToDurationMin", () => {
  it("rounds to whole minutes", () => {
    expect(elapsedToDurationMin(90)).toBe(2);
    expect(elapsedToDurationMin(89)).toBe(1);
  });
  it("clamps to the server [1, 600] range", () => {
    expect(elapsedToDurationMin(0)).toBe(1);
    expect(elapsedToDurationMin(10)).toBe(1);
    expect(elapsedToDurationMin(60 * 700)).toBe(600);
  });
});
