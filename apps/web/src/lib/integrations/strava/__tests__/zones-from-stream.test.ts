import { describe, it, expect } from "vitest";
import { zonesFromStream } from "../zones-from-stream";
import { zoneBandsFromMaxHr } from "@/lib/stats/hr-zones";

// hrMax 200 → z1Max 120, z2Max 140, z3Max 160, z4Max 180.
// zoneForBpm: <120 Z1, <140 Z2, <160 Z3, <180 Z4, >=180 Z5.
const BANDS = zoneBandsFromMaxHr(200);

function sum(z: { z1: number; z2: number; z3: number; z4: number; z5: number }): number {
  return z.z1 + z.z2 + z.z3 + z.z4 + z.z5;
}

describe("zonesFromStream", () => {
  it("returns null when bands is null", () => {
    expect(
      zonesFromStream({ hrStream: [130, 130], timeStream: [0, 1], bands: null }),
    ).toBeNull();
  });

  it("returns null for non-array / empty streams", () => {
    expect(zonesFromStream({ hrStream: null, timeStream: [0, 1], bands: BANDS })).toBeNull();
    expect(zonesFromStream({ hrStream: [130], timeStream: undefined, bands: BANDS })).toBeNull();
    expect(zonesFromStream({ hrStream: [], timeStream: [], bands: BANDS })).toBeNull();
  });

  it("returns null when no sample has a usable HR", () => {
    expect(
      zonesFromStream({ hrStream: [0, -5, NaN], timeStream: [0, 1, 2], bands: BANDS }),
    ).toBeNull();
  });

  it("attributes each 1s interval to the zone of that sample (steady Z2)", () => {
    const z = zonesFromStream({
      hrStream: [130, 130, 130, 130, 130, 130],
      timeStream: [0, 1, 2, 3, 4, 5],
      bands: BANDS,
    })!;
    expect(z.z2).toBe(6); // first sample = 1s tick + five 1s intervals
    expect(sum(z)).toBe(6);
    expect(z.z1 + z.z3 + z.z4 + z.z5).toBe(0);
  });

  it("splits time across zones for an interval session", () => {
    // 3s in Z2 (130), then 3s in Z5 (190).
    const z = zonesFromStream({
      hrStream: [130, 130, 130, 190, 190, 190],
      timeStream: [0, 1, 2, 3, 4, 5],
      bands: BANDS,
    })!;
    expect(z.z2).toBe(3);
    expect(z.z5).toBe(3);
    expect(sum(z)).toBe(6);
  });

  it("honours non-uniform sample spacing", () => {
    // 10s gaps between samples, all Z3 (150).
    const z = zonesFromStream({
      hrStream: [150, 150, 150],
      timeStream: [0, 10, 20],
      bands: BANDS,
    })!;
    // first sample = 1s tick, then two 10s intervals = 21s.
    expect(z.z3).toBe(21);
  });

  it("caps a pathological gap at 60s", () => {
    // A 5000s gap (auto-pause / dropout) must not dump ~83 min into one zone.
    const z = zonesFromStream({
      hrStream: [130, 130],
      timeStream: [0, 5000],
      bands: BANDS,
    })!;
    expect(z.z2).toBe(61); // 1s first tick + 60s capped gap
  });

  it("skips samples with invalid HR but keeps valid neighbours", () => {
    const z = zonesFromStream({
      hrStream: [130, 0, 130],
      timeStream: [0, 1, 2],
      bands: BANDS,
    })!;
    // sample0 (1s) + sample2 (1s); sample1 skipped.
    expect(z.z2).toBe(2);
    expect(sum(z)).toBe(2);
  });
});
