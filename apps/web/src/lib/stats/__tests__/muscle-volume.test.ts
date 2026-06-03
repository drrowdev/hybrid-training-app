/**
 * Muscle volume helper tests — pure functions, no DB calls.
 */
import { describe, it, expect } from "vitest";
import {
  BAND_LABEL,
  BAND_COLOR,
  classifyBand,
  scaleThresholds,
  minutesByModalityFromCardioLogs,
  cardioBlocksFromLogs,
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

describe("isConcurrentWeek (legacy binary trigger) — removed", () => {
  // The legacy `isConcurrentWeek(sessions, minutes)` helper was removed
  // in PR `feat(engine): modality-aware continuous concurrent-training
  // scalar (Stage A)`. The binary 0.7× scalar is replaced by
  // `computeConcurrentScalar(minutesByModality)` (see
  // `lib/engine/__tests__/concurrent-scalar.test.ts`). Continuity is
  // pinned there: a 300-min run-only week still resolves to 0.70×.
  it("placeholder — see concurrent-scalar.test.ts for new contract", () => {
    expect(true).toBe(true);
  });
});

describe("minutesByModalityFromCardioLogs", () => {
  it("buckets by modality and converts seconds → minutes", () => {
    const out = minutesByModalityFromCardioLogs([
      { modality: "run", duration_sec: 1800 },
      { modality: "run", duration_sec: 600 },
      { modality: "bike", duration_sec: 3600 },
    ]);
    expect(out).toEqual({ run: 40, bike: 60 });
  });

  it("treats null/empty modality as 'other'", () => {
    const out = minutesByModalityFromCardioLogs([
      { modality: null, duration_sec: 600 },
      { modality: "", duration_sec: 600 },
    ]);
    expect(out).toEqual({ other: 20 });
  });

  it("normalises casing", () => {
    const out = minutesByModalityFromCardioLogs([
      { modality: "Run", duration_sec: 600 },
      { modality: "RUN", duration_sec: 600 },
    ]);
    expect(out).toEqual({ run: 20 });
  });

  it("skips zero/negative durations", () => {
    const out = minutesByModalityFromCardioLogs([
      { modality: "run", duration_sec: 0 },
      { modality: "bike", duration_sec: -60 },
      { modality: "swim", duration_sec: null },
    ]);
    expect(out).toEqual({});
  });
});

describe("cardioBlocksFromLogs", () => {
  it("keeps logs discrete (not aggregated) and carries zones/rpe", () => {
    const blocks = cardioBlocksFromLogs([
      { modality: "run", duration_sec: 1800, hr_zones: { z2: 1800 }, rpe: 4 },
      { modality: "run", duration_sec: 600, hr_zones: { z5: 600 }, rpe: 9 },
    ]);
    expect(blocks).toEqual([
      { modality: "run", minutes: 30, hrZones: { z2: 1800 }, rpe: 4 },
      { modality: "run", minutes: 10, hrZones: { z5: 600 }, rpe: 9 },
    ]);
  });

  it("defaults modality to 'other' and zones/rpe to null", () => {
    const blocks = cardioBlocksFromLogs([
      { modality: null, duration_sec: 600 },
    ]);
    expect(blocks).toEqual([
      { modality: "other", minutes: 10, hrZones: null, rpe: null },
    ]);
  });

  it("skips zero/negative/null durations", () => {
    const blocks = cardioBlocksFromLogs([
      { modality: "run", duration_sec: 0 },
      { modality: "bike", duration_sec: -60 },
      { modality: "swim", duration_sec: null },
    ]);
    expect(blocks).toEqual([]);
  });
});
