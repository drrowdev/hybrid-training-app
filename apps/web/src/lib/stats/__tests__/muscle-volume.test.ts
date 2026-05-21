/**
 * Muscle volume helper tests — pure functions, no DB calls.
 */
import { describe, it, expect } from "vitest";
import {
  BAND_LABEL,
  BAND_COLOR,
  classifyBand,
  scaleThresholds,
  isConcurrentWeek,
  type VolumeBand,
} from "../muscle-volume";

const ALL_BANDS: VolumeBand[] = [
  "untouched",
  "below-maintenance",
  "maintaining",
  "building",
  "high-volume",
  "overreaching",
];

describe("BAND_LABEL", () => {
  it("every band has a plain-English user-facing label", () => {
    for (const b of ALL_BANDS) {
      expect(BAND_LABEL[b]).toBeDefined();
      expect(BAND_LABEL[b].length).toBeGreaterThan(0);
      // No research-jargon leakage.
      expect(BAND_LABEL[b]).not.toMatch(/MV|MEV|MAV|MRV/);
    }
  });

  it("every band has a color token", () => {
    for (const b of ALL_BANDS) {
      expect(BAND_COLOR[b]).toMatch(/^var\(--cp-/);
    }
  });
});

describe("classifyBand", () => {
  const t = { maintenance: 6, building: 10, productive: 18, limit: 24 };

  it("0 sets -> untouched (not below-maintenance)", () => {
    expect(classifyBand(0, t)).toBe("untouched");
  });

  it("below maintenance threshold -> below-maintenance", () => {
    expect(classifyBand(3, t)).toBe("below-maintenance");
  });

  it("between maintenance and building -> maintaining", () => {
    expect(classifyBand(6, t)).toBe("maintaining");
    expect(classifyBand(9, t)).toBe("maintaining");
  });

  it("between building and productive (inclusive) -> building", () => {
    expect(classifyBand(10, t)).toBe("building");
    expect(classifyBand(18, t)).toBe("building");
  });

  it("between productive and limit -> high-volume", () => {
    expect(classifyBand(20, t)).toBe("high-volume");
    expect(classifyBand(24, t)).toBe("high-volume");
  });

  it("above limit -> overreaching", () => {
    expect(classifyBand(25, t)).toBe("overreaching");
    expect(classifyBand(40, t)).toBe("overreaching");
  });
});

describe("scaleThresholds", () => {
  const base = { maintenance: 6, building: 10, productive: 18, limit: 24 };

  it("scalar 1 leaves thresholds unchanged", () => {
    expect(scaleThresholds(base, 1)).toEqual(base);
  });

  it("scalar 0.7 (concurrent-cardio pullback) lowers all thresholds", () => {
    const out = scaleThresholds(base, 0.7);
    expect(out.maintenance).toBe(4); // round(4.2)
    expect(out.building).toBe(7);     // round(7.0)
    expect(out.productive).toBe(13);  // round(12.6)
    expect(out.limit).toBe(17);       // round(16.8)
  });

  it("never lets building fall below 1 (avoid divide-by-zero in UI)", () => {
    const tiny = { maintenance: 0, building: 1, productive: 4, limit: 8 };
    expect(scaleThresholds(tiny, 0.1).building).toBe(1);
  });
});

describe("isConcurrentWeek", () => {
  it("fires at 3+ cardio sessions regardless of duration", () => {
    expect(isConcurrentWeek(3, 30)).toBe(true);
    expect(isConcurrentWeek(2, 30)).toBe(false);
  });

  it("fires at 240+ minutes regardless of session count", () => {
    expect(isConcurrentWeek(1, 240)).toBe(true);
    expect(isConcurrentWeek(1, 239)).toBe(false);
  });

  it("does not fire on a strength-dominant week (0 cardio)", () => {
    expect(isConcurrentWeek(0, 0)).toBe(false);
  });
});
