import { describe, it, expect } from "vitest";
import {
  aggregateLoadBalance,
  loadBand,
  LOAD_BAND_THRESHOLDS,
} from "../load-balance";

describe("loadBand — display thresholds", () => {
  it("returns 'unknown' for null/non-finite", () => {
    expect(loadBand(null)).toBe("unknown");
    expect(loadBand(Number.NaN)).toBe("unknown");
    expect(loadBand(Number.POSITIVE_INFINITY)).toBe("unknown");
  });

  it("classifies the boundary values per spec", () => {
    // detraining < 0.8
    expect(loadBand(0.79)).toBe("detraining");
    // productive [0.8, 1.3)
    expect(loadBand(0.8)).toBe("productive");
    expect(loadBand(1.0)).toBe("productive");
    expect(loadBand(1.29)).toBe("productive");
    // pushing [1.3, 1.5)
    expect(loadBand(1.3)).toBe("pushing");
    expect(loadBand(1.49)).toBe("pushing");
    // spiking >= 1.5
    expect(loadBand(1.5)).toBe("spiking");
    expect(loadBand(2.5)).toBe("spiking");
  });

  it("the threshold constants are exported for ADR cross-reference", () => {
    expect(LOAD_BAND_THRESHOLDS.detrainingMax).toBe(0.8);
    expect(LOAD_BAND_THRESHOLDS.productiveMax).toBe(1.3);
    expect(LOAD_BAND_THRESHOLDS.pushingMax).toBe(1.5);
  });
});

describe("aggregateLoadBalance — pure aggregator", () => {
  const tz = "UTC";
  // Fixed `now` so the 12-week lookback is deterministic.
  const NOW = new Date("2026-05-15T12:00:00Z");

  it("sums ATL/CTL across regions and computes the ratio", () => {
    const result = aggregateLoadBalance(
      [
        { atl: 100, ctl: 80 },
        { atl: 50, ctl: 60 },
        { atl: 30, ctl: 40 },
      ],
      [],
      tz,
      NOW,
    );
    expect(result.bodyAcute).toBe(180);
    expect(result.bodyChronic).toBe(180);
    expect(result.ratio).toBe(1);
    expect(result.band).toBe("productive");
  });

  it("returns ratio=null and band=unknown when chronic is zero", () => {
    const result = aggregateLoadBalance(
      [{ atl: 10, ctl: 0 }],
      [],
      tz,
      NOW,
    );
    expect(result.bodyChronic).toBe(0);
    expect(result.ratio).toBeNull();
    expect(result.band).toBe("unknown");
  });

  it("returns ratio=null with empty region_state (cold start)", () => {
    const result = aggregateLoadBalance([], [], tz, NOW);
    expect(result.bodyAcute).toBe(0);
    expect(result.bodyChronic).toBe(0);
    expect(result.ratio).toBeNull();
    expect(result.band).toBe("unknown");
    expect(result.weeksOfData).toBe(0);
  });

  it("counts DISTINCT ISO weeks of completed sessions within the 12-week lookback", () => {
    // Build 4 sessions spanning 3 distinct ISO weeks; one duplicate week.
    const sessions = [
      { performed_at: "2026-05-04T10:00:00Z" }, // week of Mon 2026-05-04
      { performed_at: "2026-05-06T10:00:00Z" }, // same week
      { performed_at: "2026-04-27T10:00:00Z" }, // week of Mon 2026-04-27
      { performed_at: "2026-04-20T10:00:00Z" }, // week of Mon 2026-04-20
    ];
    const result = aggregateLoadBalance(
      [{ atl: 100, ctl: 80 }],
      sessions,
      tz,
      NOW,
    );
    expect(result.weeksOfData).toBe(3);
  });

  it("ignores sessions older than the 12-week lookback", () => {
    const sessions = [
      // ~6 months ago — outside the 12-week (84d) lookback
      { performed_at: "2025-11-01T10:00:00Z" },
      // Within window
      { performed_at: "2026-05-04T10:00:00Z" },
    ];
    const result = aggregateLoadBalance(
      [{ atl: 50, ctl: 50 }],
      sessions,
      tz,
      NOW,
    );
    expect(result.weeksOfData).toBe(1);
  });

  it("tolerates malformed performed_at strings without throwing", () => {
    const sessions = [
      { performed_at: "not-a-date" },
      { performed_at: "2026-05-04T10:00:00Z" },
    ];
    const result = aggregateLoadBalance(
      [{ atl: 50, ctl: 50 }],
      sessions,
      tz,
      NOW,
    );
    expect(result.weeksOfData).toBe(1);
  });

  it("coerces string atl/ctl values (PostgREST returns numeric as string)", () => {
    const result = aggregateLoadBalance(
      [{ atl: "100" as unknown as number, ctl: "50" as unknown as number }],
      [],
      tz,
      NOW,
    );
    expect(result.bodyAcute).toBe(100);
    expect(result.bodyChronic).toBe(50);
    expect(result.ratio).toBe(2);
    expect(result.band).toBe("spiking");
  });
});
