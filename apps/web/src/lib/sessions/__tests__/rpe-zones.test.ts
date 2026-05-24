import { describe, it, expect } from "vitest";
import { ZONE_MIDPOINTS, zoneForRpe } from "../rpe-zones";

describe("rpe-zones", () => {
  it("persists exact midpoints per zone", () => {
    expect(ZONE_MIDPOINTS.easy).toBe(6.25);
    expect(ZONE_MIDPOINTS.moderate).toBe(7.5);
    expect(ZONE_MIDPOINTS.hard).toBe(8.75);
    expect(ZONE_MIDPOINTS.max).toBe(9.75);
  });

  it("maps stored midpoints back to their zones", () => {
    expect(zoneForRpe(6.25)).toBe("easy");
    expect(zoneForRpe(7.5)).toBe("moderate");
    expect(zoneForRpe(8.75)).toBe("hard");
    expect(zoneForRpe(9.75)).toBe("max");
  });

  it("respects the inverse-mapping band boundaries", () => {
    expect(zoneForRpe(6)).toBe("easy");
    expect(zoneForRpe(6.75)).toBe("easy");
    expect(zoneForRpe(6.76)).toBe("moderate");
    expect(zoneForRpe(8.25)).toBe("moderate");
    expect(zoneForRpe(8.26)).toBe("hard");
    expect(zoneForRpe(9.25)).toBe("hard");
    expect(zoneForRpe(9.26)).toBe("max");
    expect(zoneForRpe(10)).toBe("max");
  });

  it("returns null for null / undefined / out-of-range", () => {
    expect(zoneForRpe(null)).toBeNull();
    expect(zoneForRpe(undefined)).toBeNull();
    expect(zoneForRpe(5.9)).toBeNull();
    expect(zoneForRpe(10.1)).toBeNull();
    expect(zoneForRpe(Number.NaN)).toBeNull();
  });
});
