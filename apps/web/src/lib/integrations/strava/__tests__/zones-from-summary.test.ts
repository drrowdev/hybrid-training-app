import { describe, it, expect } from "vitest";
import { estimateZonesFromSummary } from "../zones-from-summary";
import { zoneBandsFromMaxHr, type ZoneBands } from "@/lib/stats/hr-zones";

// hrMax 200 → z1Max 120, z2Max 140, z3Max 160, z4Max 180.
const BANDS = zoneBandsFromMaxHr(200);

function sum(z: { z1: number; z2: number; z3: number; z4: number; z5: number }): number {
  return z.z1 + z.z2 + z.z3 + z.z4 + z.z5;
}

describe("estimateZonesFromSummary", () => {
  it("returns null when bands is null", () => {
    expect(
      estimateZonesFromSummary({
        avgHrBpm: 140,
        maxHrBpm: 160,
        durationSec: 1800,
        bands: null,
      }),
    ).toBeNull();
  });

  it("returns null when avgHrBpm is null/undefined", () => {
    expect(
      estimateZonesFromSummary({
        avgHrBpm: null,
        maxHrBpm: 160,
        durationSec: 1800,
        bands: BANDS,
      }),
    ).toBeNull();
    expect(
      estimateZonesFromSummary({
        avgHrBpm: undefined,
        maxHrBpm: null,
        durationSec: 1800,
        bands: BANDS,
      }),
    ).toBeNull();
  });

  it("returns null for zero / non-finite duration", () => {
    expect(
      estimateZonesFromSummary({
        avgHrBpm: 140,
        maxHrBpm: 160,
        durationSec: 0,
        bands: BANDS,
      }),
    ).toBeNull();
  });

  it("Avg in Z2, max in Z2 → 100% Z2", () => {
    // avg 130 sits mid-Z2 (120–140), max 138 still Z2.
    const z = estimateZonesFromSummary({
      avgHrBpm: 130,
      maxHrBpm: 138,
      durationSec: 1800,
      bands: BANDS,
    });
    expect(z).not.toBeNull();
    expect(z!.z2).toBe(1800);
    expect(z!.z1).toBe(0);
    expect(z!.z3).toBe(0);
    expect(z!.z4).toBe(0);
    expect(z!.z5).toBe(0);
    expect(sum(z!)).toBe(1800);
  });

  it("Avg in Z2, max in Z4 → mostly Z2 plus a slice in Z4", () => {
    const z = estimateZonesFromSummary({
      avgHrBpm: 130,
      maxHrBpm: 175,
      durationSec: 1000,
      bands: BANDS,
    });
    expect(z).not.toBeNull();
    // Distance 2 → 20% to Z4, rest Z2.
    expect(z!.z4).toBeGreaterThan(0);
    expect(z!.z4).toBeLessThan(z!.z2);
    expect(z!.z2).toBeGreaterThan(700);
    expect(sum(z!)).toBe(1000);
  });

  it("Avg in Z4, max in Z5 → mix with Z5 slice", () => {
    const z = estimateZonesFromSummary({
      avgHrBpm: 170,
      maxHrBpm: 190,
      durationSec: 1200,
      bands: BANDS,
    });
    expect(z).not.toBeNull();
    expect(z!.z4).toBeGreaterThan(z!.z5);
    expect(z!.z5).toBeGreaterThan(0);
    expect(sum(z!)).toBe(1200);
  });

  it("leaks into adjacent zone when avg sits in upper third of band", () => {
    // avg 138 — top of Z2 (120–140). Should leak some into Z3, no max push.
    const z = estimateZonesFromSummary({
      avgHrBpm: 138,
      maxHrBpm: 138,
      durationSec: 1000,
      bands: BANDS,
    });
    expect(z).not.toBeNull();
    expect(z!.z3).toBeGreaterThan(0);
    expect(z!.z2).toBeGreaterThan(z!.z3);
    expect(sum(z!)).toBe(1000);
  });

  it("leaks into the zone below when avg sits in lower third", () => {
    // avg 122 — bottom of Z2 (120–140). Should leak some into Z1.
    const z = estimateZonesFromSummary({
      avgHrBpm: 122,
      maxHrBpm: 122,
      durationSec: 1000,
      bands: BANDS,
    });
    expect(z).not.toBeNull();
    expect(z!.z1).toBeGreaterThan(0);
    expect(z!.z2).toBeGreaterThan(z!.z1);
    expect(sum(z!)).toBe(1000);
  });

  it("works with custom (non-hrMax-derived) bands", () => {
    const custom: ZoneBands = { z1Max: 110, z2Max: 135, z3Max: 155, z4Max: 175 };
    const z = estimateZonesFromSummary({
      avgHrBpm: 145,
      maxHrBpm: 170,
      durationSec: 600,
      bands: custom,
    });
    expect(z).not.toBeNull();
    // 145 in Z3 (135–155); 170 in Z4 → some Z4.
    expect(z!.z3).toBeGreaterThan(0);
    expect(z!.z4).toBeGreaterThan(0);
    expect(sum(z!)).toBe(600);
  });

  it("ignores maxHrBpm when it lands in the same zone as avg", () => {
    // avg 130 (mid-Z2), max 139 (still Z2).
    const z = estimateZonesFromSummary({
      avgHrBpm: 130,
      maxHrBpm: 139,
      durationSec: 800,
      bands: BANDS,
    });
    expect(z!.z2).toBe(800);
    expect(z!.z3).toBe(0);
    expect(z!.z4).toBe(0);
  });

  it("handles missing maxHrBpm gracefully (all in dominant when avg is mid-band)", () => {
    const z = estimateZonesFromSummary({
      avgHrBpm: 130,
      maxHrBpm: null,
      durationSec: 600,
      bands: BANDS,
    });
    expect(z).not.toBeNull();
    expect(z!.z2).toBe(600);
    expect(sum(z!)).toBe(600);
  });

  it("sum of seconds always equals durationSec (rounding reconciliation)", () => {
    const z = estimateZonesFromSummary({
      avgHrBpm: 137, // upper-Z2 → leaks Z3
      maxHrBpm: 178, // Z4 → another slice
      durationSec: 1777,
      bands: BANDS,
    });
    expect(z).not.toBeNull();
    expect(sum(z!)).toBe(1777);
  });
});
