import { describe, it, expect } from "vitest";
import { bestEstimateOneRm, epleyOneRm, rpeOneRm, tmFromOneRm } from "../one-rm";

describe("epleyOneRm", () => {
  it("100 kg × 5 reps → ~116.7 kg", () => {
    const r = epleyOneRm(100, 5);
    expect(r).toBeCloseTo(116.667, 2);
  });

  it("1RM at 1 rep returns the weight itself", () => {
    expect(epleyOneRm(150, 1)).toBeCloseTo(155, 0); // Epley gives 150 * (1 + 1/30) = 155
  });

  it("returns null above 12 reps", () => {
    expect(epleyOneRm(100, 13)).toBeNull();
    expect(epleyOneRm(100, 20)).toBeNull();
  });

  it("returns null for invalid weight / reps", () => {
    expect(epleyOneRm(0, 5)).toBeNull();
    expect(epleyOneRm(-50, 5)).toBeNull();
    expect(epleyOneRm(100, 0)).toBeNull();
    expect(epleyOneRm(NaN, 5)).toBeNull();
  });
});

describe("rpeOneRm — Helms/Zourdos chart", () => {
  it("100 kg × 5 @ RPE 8.0 → ~122.1 kg (100 / 0.819)", () => {
    const r = rpeOneRm(100, 5, 8.0);
    expect(r).toBeCloseTo(100 / 0.819, 1);
  });

  it("1 rep @ RPE 10 returns the weight itself (100% of 1RM)", () => {
    const r = rpeOneRm(150, 1, 10.0);
    expect(r).toBeCloseTo(150, 1);
  });

  it("snaps RPE to 0.5 grid (8.3 → 8.5)", () => {
    const snapped = rpeOneRm(100, 5, 8.3);
    const direct = rpeOneRm(100, 5, 8.5);
    expect(snapped).toBe(direct);
  });

  it("returns null below RPE 6 or above RPE 10", () => {
    expect(rpeOneRm(100, 5, 5.5)).toBeNull();
    expect(rpeOneRm(100, 5, 11)).toBeNull();
  });

  it("returns null above 12 reps", () => {
    expect(rpeOneRm(100, 13, 8)).toBeNull();
  });

  it("higher RPE at same reps → LOWER implied 1RM (set felt harder, so max is closer to the weight)", () => {
    const lowerRpe = rpeOneRm(100, 5, 7)!;
    const higherRpe = rpeOneRm(100, 5, 9)!;
    expect(higherRpe).toBeLessThan(lowerRpe);
  });
});

describe("bestEstimateOneRm — conservative dispatcher", () => {
  it("falls back to Epley when no RPE is logged", () => {
    const result = bestEstimateOneRm({ weight: 100, reps: 5 });
    expect(result).toBeCloseTo(epleyOneRm(100, 5)!, 2);
  });

  it("takes the lower of Epley and RPE-based when RPE is present", () => {
    const epley = epleyOneRm(100, 5)!; // 116.67
    const rpe9 = rpeOneRm(100, 5, 9.0)!; // 100 / 0.860 = 116.28 — lower
    const dispatched = bestEstimateOneRm({ weight: 100, reps: 5, rpe: 9.0 });
    expect(dispatched).toBe(Math.min(epley, rpe9));
  });

  it("conservative pick prevents grinder-RPE inflation", () => {
    // RPE 10 (grinder) gives HIGHER 1RM than Epley — dispatcher should
    // still pick Epley as the safer estimate.
    const epley = epleyOneRm(100, 5)!; // 116.67
    const rpe10 = rpeOneRm(100, 5, 10.0)!; // 100 / 0.910 = ~109.9 — lower again
    const dispatched = bestEstimateOneRm({ weight: 100, reps: 5, rpe: 10.0 });
    expect(dispatched).toBe(Math.min(epley, rpe10));
  });

  it("returns null above 12 reps", () => {
    expect(bestEstimateOneRm({ weight: 100, reps: 13 })).toBeNull();
  });

  it("ignores out-of-range RPE and falls back to Epley", () => {
    const r = bestEstimateOneRm({ weight: 100, reps: 5, rpe: 4.0 });
    expect(r).toBeCloseTo(epleyOneRm(100, 5)!, 2);
  });
});

describe("tmFromOneRm — conservative 90% rule", () => {
  it("116.67 kg 1RM rounds to 105 kg TM (90% × plate-friendly)", () => {
    expect(tmFromOneRm(116.67)).toBe(105);
  });

  it("130 kg 1RM rounds to 117.5 kg TM", () => {
    expect(tmFromOneRm(130)).toBe(117.5);
  });

  it("respects a custom plate increment", () => {
    // 1.25 kg increment for fractional plates.
    expect(tmFromOneRm(130, 1.25)).toBe(117.5);
  });
});
