import { describe, it, expect } from "vitest";
import {
  detectRegionSpikes,
  REGION_SPIKE_THRESHOLD,
} from "../region-spike-detector";

describe("detectRegionSpikes", () => {
  it("returns [] when no regions are provided", () => {
    expect(detectRegionSpikes({}, {})).toEqual([]);
  });

  it("skips regions whose trailing average is 0 (avoids divide-by-zero)", () => {
    const result = detectRegionSpikes(
      { knee: 100 },
      { knee: 0 },
    );
    expect(result).toEqual([]);
  });

  it("skips regions with no current ATL", () => {
    const result = detectRegionSpikes(
      { knee: 0 },
      { knee: 50 },
    );
    expect(result).toEqual([]);
  });

  it("returns [] when every region is within threshold", () => {
    const result = detectRegionSpikes(
      { knee: 105, lumbar_trunk: 110 }, // +5% and +10% — both below 25%
      { knee: 100, lumbar_trunk: 100 },
    );
    expect(result).toEqual([]);
  });

  it("returns a region that is 30% above the trailing average", () => {
    const result = detectRegionSpikes(
      { knee: 130 },
      { knee: 100 },
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.region).toBe("knee");
    expect(result[0]!.currentAtl).toBe(130);
    expect(result[0]!.trailingAvg).toBe(100);
    expect(result[0]!.spikePct).toBeCloseTo(0.3, 10);
  });

  it("sorts multiple spiking regions by spikePct descending", () => {
    const result = detectRegionSpikes(
      { knee: 130, shoulder_scapular: 200, lumbar_trunk: 150 },
      { knee: 100, shoulder_scapular: 100, lumbar_trunk: 100 },
    );
    expect(result.map((s) => s.region)).toEqual([
      "shoulder_scapular", // +100%
      "lumbar_trunk",      // +50%
      "knee",              // +30%
    ]);
  });

  it("honours a custom threshold", () => {
    // Default 25% would fire; 60% threshold should not.
    const aboveDefault = detectRegionSpikes(
      { knee: 130 },
      { knee: 100 },
    );
    expect(aboveDefault).toHaveLength(1);

    const tightened = detectRegionSpikes(
      { knee: 130 },
      { knee: 100 },
      0.6,
    );
    expect(tightened).toEqual([]);
  });

  it("triggers just over the boundary (25.001%) and not at exactly 25%", () => {
    // 25% exactly — strictly greater-than, so this must NOT trigger.
    const onLine = detectRegionSpikes(
      { knee: 125 },
      { knee: 100 },
    );
    expect(onLine).toEqual([]);

    // 25.001% — floating-point safety. Build the value so that
    // (current - avg) / avg is > 0.25 by a tiny margin.
    const justOver = detectRegionSpikes(
      { knee: 125.001 },
      { knee: 100 },
    );
    expect(justOver).toHaveLength(1);
    expect(justOver[0]!.spikePct).toBeGreaterThan(REGION_SPIKE_THRESHOLD);
  });

  it("skips regions whose values are not finite numbers", () => {
    const result = detectRegionSpikes(
      { knee: Number.NaN, lumbar_trunk: 200 },
      { knee: 100, lumbar_trunk: Number.POSITIVE_INFINITY },
    );
    expect(result).toEqual([]);
  });

  it("exposes the heuristic default threshold at 0.25", () => {
    expect(REGION_SPIKE_THRESHOLD).toBe(0.25);
  });
});
