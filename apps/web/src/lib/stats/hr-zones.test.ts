import { describe, expect, it } from "vitest";
import {
  accumulateZoneTotals,
  bucketByZone,
  coerceStoredZones,
  computeZoneBands,
  computeZoneBandsSafe,
  DEFAULT_ZONE_PCTS,
  polarisedSplit,
  readZoneConfig,
  validateHrZoneInputs,
  validateZonePercents,
  zoneBandsFromMaxHr,
  zoneForBpm,
  type ZoneBands,
  type ZonePercents,
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

describe("coerceStoredZones", () => {
  it("reads lowercase z1..z5 second-counts", () => {
    expect(coerceStoredZones({ z1: 10, z2: 20, z3: 0, z4: 0, z5: 5 })).toEqual({
      Z1: 10,
      Z2: 20,
      Z3: 0,
      Z4: 0,
      Z5: 5,
    });
  });

  it("tolerates capitalised keys and missing keys", () => {
    expect(coerceStoredZones({ Z2: 30 })).toEqual({ Z1: 0, Z2: 30, Z3: 0, Z4: 0, Z5: 0 });
  });

  it("returns null for empty / non-object / all-zero input", () => {
    expect(coerceStoredZones(null)).toBeNull();
    expect(coerceStoredZones("nope")).toBeNull();
    expect(coerceStoredZones({ z1: 0, z2: 0 })).toBeNull();
  });
});

describe("accumulateZoneTotals", () => {
  it("prefers stored hr_zones over avg-HR bucketing (measured source)", () => {
    const { totals, contributing, skipped, source } = accumulateZoneTotals(
      [
        // Stored distribution: must be used verbatim, NOT bucketed to the avg's zone.
        { durationSec: 1800, avgHrBpm: 130, hrZones: { z1: 0, z2: 1200, z3: 400, z4: 200, z5: 0 } },
        { durationSec: 600, avgHrBpm: 175, hrZones: { z1: 0, z2: 0, z3: 100, z4: 500, z5: 0 } },
      ],
      BANDS,
    );
    expect(totals).toEqual({ Z1: 0, Z2: 1200, Z3: 500, Z4: 700, Z5: 0 });
    expect(contributing).toBe(2);
    expect(skipped).toBe(0);
    expect(source).toBe("measured");
  });

  it("falls back to avg-HR bucketing for rows without stored zones (approximated source)", () => {
    const { totals, source } = accumulateZoneTotals(
      [
        { durationSec: 1800, avgHrBpm: 130 }, // Z2
        { durationSec: 600, avgHrBpm: 175 }, // Z4
      ],
      BANDS,
    );
    expect(totals.Z2).toBe(1800);
    expect(totals.Z4).toBe(600);
    expect(source).toBe("approximated");
  });

  it("reports a mixed source and skips rows with neither zones nor avg HR", () => {
    const { totals, contributing, skipped, source } = accumulateZoneTotals(
      [
        { durationSec: 600, avgHrBpm: 130, hrZones: { z2: 600 } }, // measured
        { durationSec: 600, avgHrBpm: 150 }, // approximated (Z3)
        { durationSec: 600, avgHrBpm: null }, // skipped
      ],
      BANDS,
    );
    expect(totals.Z2).toBe(600);
    expect(totals.Z3).toBe(600);
    expect(contributing).toBe(2);
    expect(skipped).toBe(1);
    expect(source).toBe("mixed");
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

describe("DEFAULT_ZONE_PCTS", () => {
  it("matches the historic hard-coded breakpoints for each method", () => {
    expect(DEFAULT_ZONE_PCTS.max).toEqual({ z1: 0.6, z2: 0.7, z3: 0.8, z4: 0.9 });
    expect(DEFAULT_ZONE_PCTS.hrr).toEqual({ z1: 0.5, z2: 0.6, z3: 0.7, z4: 0.85 });
    expect(DEFAULT_ZONE_PCTS.lthr).toEqual({ z1: 0.81, z2: 0.89, z3: 0.93, z4: 0.99 });
  });
});

describe("validateZonePercents", () => {
  it("accepts strictly-ascending values inside (0, 1.5]", () => {
    expect(validateZonePercents({ z1: 0.5, z2: 0.6, z3: 0.7, z4: 0.85 })).toEqual({
      z1: 0.5,
      z2: 0.6,
      z3: 0.7,
      z4: 0.85,
    });
    // Upper edge: 1.5 is allowed.
    expect(validateZonePercents({ z1: 0.6, z2: 0.7, z3: 0.8, z4: 1.5 })).not.toBeNull();
  });

  it("rejects a missing field", () => {
    expect(validateZonePercents({ z1: 0.5, z2: 0.6, z3: 0.7 })).toBeNull();
    expect(validateZonePercents({})).toBeNull();
  });

  it("rejects non-finite or wrong-typed values", () => {
    expect(
      validateZonePercents({ z1: Number.NaN, z2: 0.6, z3: 0.7, z4: 0.85 }),
    ).toBeNull();
    expect(
      validateZonePercents({
        z1: Number.POSITIVE_INFINITY,
        z2: 0.6,
        z3: 0.7,
        z4: 0.85,
      }),
    ).toBeNull();
    expect(
      validateZonePercents({
        z1: "0.5" as unknown as number,
        z2: 0.6,
        z3: 0.7,
        z4: 0.85,
      }),
    ).toBeNull();
  });

  it("rejects zero (lower bound is exclusive)", () => {
    expect(validateZonePercents({ z1: 0, z2: 0.6, z3: 0.7, z4: 0.85 })).toBeNull();
  });

  it("rejects out-of-range values", () => {
    // Negative.
    expect(validateZonePercents({ z1: -0.1, z2: 0.6, z3: 0.7, z4: 0.85 })).toBeNull();
    // Above 1.5.
    expect(validateZonePercents({ z1: 0.6, z2: 0.7, z3: 0.8, z4: 1.6 })).toBeNull();
  });

  it("rejects non-ascending sequences", () => {
    expect(validateZonePercents({ z1: 0.6, z2: 0.6, z3: 0.7, z4: 0.85 })).toBeNull();
    expect(validateZonePercents({ z1: 0.7, z2: 0.6, z3: 0.8, z4: 0.9 })).toBeNull();
  });
});

describe("computeZoneBands — custom pcts per method", () => {
  it("overrides %Max defaults when pcts is supplied", () => {
    const pcts: ZonePercents = { z1: 0.55, z2: 0.65, z3: 0.75, z4: 0.88 };
    const bands = computeZoneBands({ method: "max", hrMax: 200, pcts });
    expect(bands.z1Max).toBeCloseTo(110, 6);
    expect(bands.z2Max).toBeCloseTo(130, 6);
    expect(bands.z3Max).toBeCloseTo(150, 6);
    expect(bands.z4Max).toBeCloseTo(176, 6);
  });

  it("overrides %HRR defaults when pcts is supplied (anchored at resting)", () => {
    const pcts: ZonePercents = { z1: 0.55, z2: 0.65, z3: 0.75, z4: 0.9 };
    // span = 200 - 60 = 140
    const bands = computeZoneBands({
      method: "hrr",
      hrMax: 200,
      hrResting: 60,
      pcts,
    });
    expect(bands.z1Max).toBeCloseTo(60 + 0.55 * 140, 6);
    expect(bands.z2Max).toBeCloseTo(60 + 0.65 * 140, 6);
    expect(bands.z3Max).toBeCloseTo(60 + 0.75 * 140, 6);
    expect(bands.z4Max).toBeCloseTo(60 + 0.9 * 140, 6);
  });

  it("overrides %LTHR defaults when pcts is supplied", () => {
    const pcts: ZonePercents = { z1: 0.8, z2: 0.88, z3: 0.94, z4: 1.0 };
    const bands = computeZoneBands({ method: "lthr", hrLthr: 170, pcts });
    expect(bands.z1Max).toBeCloseTo(170 * 0.8, 6);
    expect(bands.z2Max).toBeCloseTo(170 * 0.88, 6);
    expect(bands.z3Max).toBeCloseTo(170 * 0.94, 6);
    expect(bands.z4Max).toBeCloseTo(170 * 1.0, 6);
  });

  it("falls through to defaults when pcts is absent", () => {
    const withOverride = computeZoneBands({
      method: "max",
      hrMax: 200,
      pcts: DEFAULT_ZONE_PCTS.max,
    });
    const withoutOverride = computeZoneBands({ method: "max", hrMax: 200 });
    expect(withOverride).toEqual(withoutOverride);
  });
});
