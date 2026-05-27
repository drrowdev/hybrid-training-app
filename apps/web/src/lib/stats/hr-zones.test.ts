import { describe, expect, it } from "vitest";
import {
  bucketByZone,
  computeZoneBands,
  computeZoneBandsSafe,
  polarisedSplit,
  readZoneConfig,
  validateHrZoneInputs,
  zoneBandsFromMaxHr,
  zoneForBpm,
  type ZoneBands,
} from "./hr-zones";

const BANDS: ZoneBands = zoneBandsFromMaxHr(200); // 120 / 140 / 160 / 180

describe("zoneBandsFromMaxHr", () => {
  it("derives % bands from a max-HR value", () => {
    expect(BANDS).toEqual({ z1Max: 120, z2Max: 140, z3Max: 160, z4Max: 180 });
  });
});

describe("zoneForBpm", () => {
  it("buckets values into Z1–Z5", () => {
    expect(zoneForBpm(100, BANDS)).toBe("Z1");
    expect(zoneForBpm(125, BANDS)).toBe("Z2");
    expect(zoneForBpm(150, BANDS)).toBe("Z3");
    expect(zoneForBpm(170, BANDS)).toBe("Z4");
    expect(zoneForBpm(190, BANDS)).toBe("Z5");
  });

  it("uses exclusive upper bounds (boundary lands in the next zone up)", () => {
    expect(zoneForBpm(120, BANDS)).toBe("Z2");
    expect(zoneForBpm(180, BANDS)).toBe("Z5");
  });
});

describe("bucketByZone", () => {
  it("sums seconds per zone using session averages", () => {
    const { totals, skipped } = bucketByZone(
      [
        { durationSec: 1800, avgHrBpm: 130 }, // Z2
        { durationSec: 600, avgHrBpm: 175 }, // Z4
        { durationSec: 1200, avgHrBpm: 150 }, // Z3
      ],
      BANDS,
    );
    expect(totals.Z2).toBe(1800);
    expect(totals.Z3).toBe(1200);
    expect(totals.Z4).toBe(600);
    expect(skipped).toBe(0);
  });

  it("skips activities with no average HR", () => {
    const { totals, skipped } = bucketByZone(
      [
        { durationSec: 600, avgHrBpm: null },
        { durationSec: 600, avgHrBpm: 130 },
      ],
      BANDS,
    );
    expect(totals.Z2).toBe(600);
    expect(skipped).toBe(1);
  });
});

describe("polarisedSplit", () => {
  it("returns a balanced 80/0/20 split for a polarised week", () => {
    const split = polarisedSplit({ Z1: 4800, Z2: 3200, Z3: 0, Z4: 1500, Z5: 500 });
    expect(split.easyPct).toBeCloseTo(0.8, 2);
    expect(split.thresholdPct).toBeCloseTo(0, 2);
    expect(split.hardPct).toBeCloseTo(0.2, 2);
  });

  it("returns zeros on empty input", () => {
    const split = polarisedSplit({ Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 });
    expect(split).toEqual({ easyPct: 0, thresholdPct: 0, hardPct: 0 });
  });
});

describe("readZoneConfig", () => {
  it("reads explicit zone bands when present", () => {
    const bands = readZoneConfig({
      hrZones: { z1Max: 110, z2Max: 130, z3Max: 150, z4Max: 170 },
    });
    expect(bands).toEqual({ z1Max: 110, z2Max: 130, z3Max: 150, z4Max: 170 });
  });

  it("falls back to %max bands when only hrMax is set", () => {
    const bands = readZoneConfig({ hrMax: 200 });
    expect(bands).toEqual({ z1Max: 120, z2Max: 140, z3Max: 160, z4Max: 180 });
  });

  it("returns null when intake is empty", () => {
    expect(readZoneConfig({})).toBeNull();
    expect(readZoneConfig(null)).toBeNull();
    expect(readZoneConfig({ hrMax: 0 })).toBeNull();
  });
});

describe("computeZoneBands — %Max method", () => {
  it("matches zoneBandsFromMaxHr for a typical max", () => {
    const bands = computeZoneBands({ method: "max", hrMax: 200 });
    expect(bands).toEqual({ z1Max: 120, z2Max: 140, z3Max: 160, z4Max: 180 });
  });

  it("throws on out-of-range max", () => {
    expect(() => computeZoneBands({ method: "max", hrMax: 50 })).toThrow();
    expect(() => computeZoneBands({ method: "max", hrMax: 250 })).toThrow();
  });
});

describe("computeZoneBands — %HRR (Karvonen)", () => {
  it("anchors at resting and spans to max with HRR breakpoints", () => {
    // span = 200 - 60 = 140
    // z1 = 60 + 0.50*140 = 130
    // z2 = 60 + 0.60*140 = 144
    // z3 = 60 + 0.70*140 = 158
    // z4 = 60 + 0.85*140 = 179
    const bands = computeZoneBands({ method: "hrr", hrMax: 200, hrResting: 60 });
    expect(bands.z1Max).toBeCloseTo(130, 6);
    expect(bands.z2Max).toBeCloseTo(144, 6);
    expect(bands.z3Max).toBeCloseTo(158, 6);
    expect(bands.z4Max).toBeCloseTo(179, 6);
  });

  it("places resting HR in Z1 and max HR in Z5", () => {
    const bands = computeZoneBands({ method: "hrr", hrMax: 190, hrResting: 50 });
    expect(zoneForBpm(50, bands)).toBe("Z1");
    expect(zoneForBpm(190, bands)).toBe("Z5");
  });

  it("rejects resting >= max as physiologically impossible", () => {
    expect(() => computeZoneBands({ method: "hrr", hrMax: 150, hrResting: 150 })).toThrow();
    expect(() => computeZoneBands({ method: "hrr", hrMax: 150, hrResting: 160 })).toThrow();
  });
});

describe("computeZoneBands — %LTHR (Friel)", () => {
  it("uses Friel's 5-zone simplified %LTHR breakpoints", () => {
    // LTHR = 170 → z1=137.7, z2=151.3, z3=158.1, z4=168.3
    const bands = computeZoneBands({ method: "lthr", hrLthr: 170 });
    expect(bands.z1Max).toBeCloseTo(170 * 0.81, 6);
    expect(bands.z2Max).toBeCloseTo(170 * 0.89, 6);
    expect(bands.z3Max).toBeCloseTo(170 * 0.93, 6);
    expect(bands.z4Max).toBeCloseTo(170 * 0.99, 6);
  });

  it("puts LTHR itself in Z5 (≥ 100% LTHR)", () => {
    const bands = computeZoneBands({ method: "lthr", hrLthr: 170 });
    expect(zoneForBpm(170, bands)).toBe("Z5");
  });

  it("throws on out-of-range LTHR", () => {
    expect(() => computeZoneBands({ method: "lthr", hrLthr: 80 })).toThrow();
    expect(() => computeZoneBands({ method: "lthr", hrLthr: 220 })).toThrow();
  });
});

describe("computeZoneBands — boundary cases", () => {
  it("uses exclusive upper bounds across all methods (a bpm exactly at z2Max lands in Z3)", () => {
    const maxBands = computeZoneBands({ method: "max", hrMax: 200 });
    expect(zoneForBpm(maxBands.z2Max, maxBands)).toBe("Z3");

    const hrrBands = computeZoneBands({ method: "hrr", hrMax: 200, hrResting: 60 });
    expect(zoneForBpm(hrrBands.z2Max, hrrBands)).toBe("Z3");

    const lthrBands = computeZoneBands({ method: "lthr", hrLthr: 170 });
    expect(zoneForBpm(lthrBands.z2Max, lthrBands)).toBe("Z3");
  });
});

describe("validateHrZoneInputs / computeZoneBandsSafe", () => {
  it("returns null on missing or invalid fields instead of throwing", () => {
    expect(validateHrZoneInputs({ method: "max" })).toBeNull();
    expect(validateHrZoneInputs({ method: "hrr", hrMax: 190 })).toBeNull();
    expect(validateHrZoneInputs({ method: "lthr", hrLthr: 9999 })).toBeNull();
    expect(computeZoneBandsSafe({ method: "max" })).toBeNull();
    expect(computeZoneBandsSafe({ method: "max", hrMax: 190 })).not.toBeNull();
  });
});
