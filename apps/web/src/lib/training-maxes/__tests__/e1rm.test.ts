import { describe, it, expect } from "vitest";
import {
  brzycki,
  conservativeEstimate,
  epley,
  rpePercent1Rm,
  rpeZourdos,
} from "../e1rm";

describe("epley (1985)", () => {
  it("returns the lift weight at reps=1 (1 + 1/30 ≈ 1.033)", () => {
    expect(epley(100, 1)).toBeCloseTo(103.333, 3);
  });

  it("scales linearly with reps", () => {
    expect(epley(100, 5)).toBeCloseTo(116.667, 2);
    expect(epley(100, 10)).toBeCloseTo(133.333, 2);
    expect(epley(100, 12)).toBeCloseTo(140, 3);
  });

  it("rejects non-positive weight and non-integer reps", () => {
    expect(() => epley(0, 5)).toThrow();
    expect(() => epley(-10, 5)).toThrow();
    expect(() => epley(100, 0)).toThrow();
    expect(() => epley(100, 2.5)).toThrow();
  });
});

describe("brzycki (1993)", () => {
  it("returns the lift weight at reps=1 (36/36 = 1)", () => {
    expect(brzycki(100, 1)).toBeCloseTo(100, 6);
  });

  it("at reps=12 returns weight · 36 / 25", () => {
    expect(brzycki(100, 12)).toBeCloseTo(144, 6);
  });

  it("clamps reps > 12 to the reps=12 value", () => {
    expect(brzycki(100, 15)).toBeCloseTo(brzycki(100, 12), 6);
  });

  it("rejects bad inputs", () => {
    expect(() => brzycki(0, 5)).toThrow();
    expect(() => brzycki(100, 0)).toThrow();
  });
});

describe("rpePercent1Rm (Zourdos 2016 chart)", () => {
  it("returns 100% at RPE 10 × 1 rep", () => {
    expect(rpePercent1Rm(1, 10)).toBe(100);
  });

  it("returns 75.5% at RPE 10 × 12 reps", () => {
    expect(rpePercent1Rm(12, 10)).toBe(75.5);
  });

  it("returns 79% at RPE 5 × 1 rep", () => {
    expect(rpePercent1Rm(1, 5)).toBe(79);
  });

  it("returns 81% at RPE 8 × 5 reps", () => {
    expect(rpePercent1Rm(5, 8)).toBe(81);
  });

  it("rounds RPE UP to nearest 0.5 step (conservative)", () => {
    // RPE 8.3 should snap to 8.5 (higher %1RM → lower e1RM).
    expect(rpePercent1Rm(5, 8.3)).toBe(rpePercent1Rm(5, 8.5));
    expect(rpePercent1Rm(5, 8.6)).toBe(rpePercent1Rm(5, 9.0));
  });

  it("clamps reps > 12 to 12", () => {
    expect(rpePercent1Rm(15, 10)).toBe(rpePercent1Rm(12, 10));
  });

  it("rejects out-of-range RPE", () => {
    expect(() => rpePercent1Rm(5, 4.9)).toThrow();
    expect(() => rpePercent1Rm(5, 10.1)).toThrow();
  });
});

describe("rpeZourdos", () => {
  it("returns the lift weight at RPE 10 × 1 rep", () => {
    expect(rpeZourdos(100, 1, 10)).toBeCloseTo(100, 6);
  });

  it("yields a higher e1RM at lower RPE for the same weight × reps", () => {
    const high = rpeZourdos(100, 5, 10); // 100/0.892
    const low = rpeZourdos(100, 5, 8); //  100/0.81
    expect(low).toBeGreaterThan(high);
  });
});

describe("conservativeEstimate", () => {
  it("picks the smaller of Epley and Brzycki when no RPE given", () => {
    // At low reps Brzycki < Epley (e.g. 5 reps: B≈112.5 vs E≈116.7).
    const r = conservativeEstimate(100, 5);
    expect(r.formula).toBe("brzycki");
    expect(r.value).toBeCloseTo(brzycki(100, 5), 6);
  });

  it("at reps=1 Epley and Brzycki disagree → Brzycki returns weight, Epley returns weight·31/30", () => {
    const r = conservativeEstimate(100, 1);
    expect(r.formula).toBe("brzycki");
    expect(r.value).toBeCloseTo(100, 6);
  });

  it("includes Zourdos when an RPE is provided and prefers it if smaller", () => {
    // RPE 10 × 5 reps → 100/0.892 ≈ 112.1, below brzycki (112.5) → wins.
    const r = conservativeEstimate(100, 5, 10);
    expect(r.formula).toBe("rpe_zourdos");
    expect(r.value).toBeLessThan(brzycki(100, 5));
  });

  it("falls back to Brzycki when Zourdos would be more optimistic (lower RPE)", () => {
    // RPE 7 × 5 reps → 100/0.77 ≈ 129.9, well above Brzycki (112.5).
    const r = conservativeEstimate(100, 5, 7);
    expect(r.formula).toBe("brzycki");
  });

  it("returns a finite positive value across the chart corners", () => {
    const corners: Array<[number, number, number?]> = [
      [60, 1, 10],
      [120, 12, 5],
      [80, 8, 8],
      [100, 1],
      [100, 12],
    ];
    for (const [w, r, rpe] of corners) {
      const out = conservativeEstimate(w, r, rpe);
      expect(out.value).toBeGreaterThan(0);
      expect(Number.isFinite(out.value)).toBe(true);
    }
  });
});
