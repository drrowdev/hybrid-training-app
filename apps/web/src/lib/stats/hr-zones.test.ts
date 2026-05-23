import { describe, expect, it } from "vitest";
import {
  bucketByZone,
  polarisedSplit,
  readZoneConfig,
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
