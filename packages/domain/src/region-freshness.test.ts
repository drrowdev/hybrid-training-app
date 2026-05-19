/**
 * Tests for region freshness (DC-C14) and EWMA helper (DC-C1).
 *
 * Reference: docs/knowledge/design-constraints.md
 */
import { describe, expect, it } from "vitest";
import {
  clamp,
  computeAllRegionFreshness,
  computeRegionFreshness,
  ewmaStep,
} from "./region-freshness.js";

describe("clamp", () => {
  it("returns x when inside the band", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
  it("clips below min", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
  });
  it("clips above max", () => {
    expect(clamp(2, 0, 1)).toBe(1);
  });
});

describe("computeRegionFreshness — DC-C14", () => {
  it("returns 1.0 when no recent load (ATL = 0)", () => {
    expect(computeRegionFreshness(0, 100)).toBe(1);
  });

  it("returns ~0.5 when recent load is half of baseline", () => {
    expect(computeRegionFreshness(50, 100)).toBeCloseTo(0.5, 6);
  });

  it("returns 0 when recent load equals baseline", () => {
    expect(computeRegionFreshness(100, 100)).toBe(0);
  });

  it("clamps at 0 when recent load exceeds baseline (overloaded)", () => {
    expect(computeRegionFreshness(150, 100)).toBe(0);
  });

  it("returns 1.0 (fresh) on cold-start when baselineTolerance <= 0", () => {
    // Sparse-data fallback per DC-C13.
    expect(computeRegionFreshness(0, 0)).toBe(1);
    expect(computeRegionFreshness(50, 0)).toBe(1);
    expect(computeRegionFreshness(50, -1)).toBe(1);
  });
});

describe("computeAllRegionFreshness — DC-C14 fanout", () => {
  it("maps each region independently", () => {
    const out = computeAllRegionFreshness(
      { knee: 80, shoulder_scapular: 20 },
      { knee: 100, shoulder_scapular: 100 },
    );
    expect(out.knee).toBeCloseTo(0.2, 6);
    expect(out.shoulder_scapular).toBeCloseTo(0.8, 6);
  });

  it("treats missing baseline as cold-start (fresh) per region", () => {
    const out = computeAllRegionFreshness({ knee: 50 }, {});
    expect(out.knee).toBe(1);
  });

  it("the morning after a heavy squat session (the DC-C14 worked example)", () => {
    // Synthetic case from the constraint description: heavy back squat
    // primarily loads quad / glute / lumbar / hip regions.
    // ATL = 1.4× baseline on those four; upper-body fresh.
    const baseline = {
      knee: 100,
      hamstring_posterior: 100,
      lumbar_trunk: 100,
      shoulder_scapular: 100,
      elbow_forearm: 100,
    };
    const atl = {
      knee: 140,
      hamstring_posterior: 140,
      lumbar_trunk: 140,
      shoulder_scapular: 0,
      elbow_forearm: 0,
    };
    const fresh = computeAllRegionFreshness(atl, baseline);
    // All squat-loaded regions clamped to 0 (heavily loaded).
    expect(fresh.knee).toBe(0);
    expect(fresh.hamstring_posterior).toBe(0);
    expect(fresh.lumbar_trunk).toBe(0);
    // Upper body unaffected.
    expect(fresh.shoulder_scapular).toBe(1);
    expect(fresh.elbow_forearm).toBe(1);
  });
});

describe("ewmaStep — DC-C1", () => {
  it("computes alpha = 2/(n+1) correctly for n=7 (ATL)", () => {
    // alpha_7 = 2/8 = 0.25; previous=0, current=100 → 25.
    expect(ewmaStep(0, 100, 7)).toBeCloseTo(25, 6);
  });

  it("computes alpha = 2/(n+1) correctly for n=28 (CTL)", () => {
    // alpha_28 = 2/29 ≈ 0.0690; previous=0, current=100 → ~6.90.
    expect(ewmaStep(0, 100, 28)).toBeCloseTo(100 * (2 / 29), 6);
  });

  it("decays toward zero when current is zero", () => {
    // alpha_7 = 0.25; previous=100, current=0 → 75.
    expect(ewmaStep(100, 0, 7)).toBeCloseTo(75, 6);
  });
});
