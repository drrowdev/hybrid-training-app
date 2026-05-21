import { describe, it, expect } from "vitest";
import {
  GRM_RECOMMEND_THRESHOLD,
  applyGrmToPercent,
  computeGrm,
  grmLabel,
} from "../grm";

describe("computeGrm", () => {
  it("neutral 3/3 returns 1.00", () => {
    expect(computeGrm({ fatigue: 3, soreness: 3 })).toEqual({ value: 1.0, hasCheckIn: true });
  });

  it("cooked 5/5 returns the floor at 0.90", () => {
    const r = computeGrm({ fatigue: 5, soreness: 5 });
    expect(r.value).toBe(0.9);
    expect(r.hasCheckIn).toBe(true);
  });

  it("fresh 1/1 caps at 1.00 (never recommends going above planned)", () => {
    const r = computeGrm({ fatigue: 1, soreness: 1 });
    expect(r.value).toBe(1.0);
  });

  it("missing fatigue returns 1.00 with hasCheckIn=false", () => {
    expect(computeGrm({ fatigue: null, soreness: 4 })).toEqual({ value: 1.0, hasCheckIn: false });
  });

  it("missing soreness returns 1.00 with hasCheckIn=false", () => {
    expect(computeGrm({ fatigue: 4, soreness: undefined })).toEqual({ value: 1.0, hasCheckIn: false });
  });

  it("fatigue weighted more heavily than soreness", () => {
    const onlyFatigue = computeGrm({ fatigue: 5, soreness: 3 });
    const onlySoreness = computeGrm({ fatigue: 3, soreness: 5 });
    expect(onlyFatigue.value).toBeLessThan(onlySoreness.value);
  });

  it("clamps inputs outside 1-5 range", () => {
    const r = computeGrm({ fatigue: 10, soreness: -1 });
    expect(r.value).toBeLessThan(1.0);
    expect(r.value).toBeGreaterThanOrEqual(0.8);
  });

  it("returns 2-decimal precision", () => {
    const r = computeGrm({ fatigue: 4, soreness: 4 });
    expect(r.value).toBe(0.95);
  });
});

describe("applyGrmToPercent", () => {
  it("90% * 1.00 = 90", () => {
    expect(applyGrmToPercent(90, 1.0)).toBe(90);
  });

  it("90% * 0.90 = 81", () => {
    expect(applyGrmToPercent(90, 0.9)).toBe(81);
  });

  it("rounds to the nearest integer", () => {
    expect(applyGrmToPercent(90, 0.94)).toBe(85);
  });
});

describe("GRM_RECOMMEND_THRESHOLD", () => {
  it("a 4/3 check-in stays silent (above threshold)", () => {
    const r = computeGrm({ fatigue: 4, soreness: 3 });
    expect(r.value).toBe(0.97);
    expect(r.value).toBeGreaterThanOrEqual(GRM_RECOMMEND_THRESHOLD);
  });

  it("a 4/4 check-in triggers a recommendation", () => {
    const r = computeGrm({ fatigue: 4, soreness: 4 });
    expect(r.value).toBeLessThan(GRM_RECOMMEND_THRESHOLD);
  });
});

describe("grmLabel", () => {
  it("maps GRM ranges to plain words", () => {
    expect(grmLabel(1.0)).toBe("fresh");
    expect(grmLabel(0.98)).toBe("good");
    expect(grmLabel(0.95)).toBe("neutral");
    expect(grmLabel(0.92)).toBe("tired");
    expect(grmLabel(0.85)).toBe("cooked");
  });
});
