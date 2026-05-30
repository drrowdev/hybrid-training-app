import { describe, it, expect } from "vitest";
import { computeRecoveryWindow, scaleForDateInWindow } from "../recovery";

describe("computeRecoveryWindow", () => {
  it("returns null for C-priority events", () => {
    expect(
      computeRecoveryWindow({
        distanceKm: 42.195,
        durationMin: null,
        modality: "run",
        priority: "C",
        userTier: 2,
      }),
    ).toBeNull();
  });

  it("baseline tier-2 A-priority marathon → 14d × 1.0 × 1.0 × 1.2 = 16.8 → 17d", () => {
    const w = computeRecoveryWindow({
      distanceKm: 42.195,
      durationMin: null,
      modality: "run",
      priority: "A",
      userTier: 2,
    });
    expect(w?.days).toBe(17);
    expect(w?.strengthLoadScale).toBe(0);
    expect(w?.cardioLoadScale).toBe(0.5);
    expect(w?.confidence).toBeUndefined();
  });

  it("trained tier-3 A-priority marathon → 14 × 1.0 × 0.85 × 1.2 = 14.28 → 14d", () => {
    // Note: spec text mentioned 17d here but the formula yields ~14.28
    // → rounds to 14. Following the formula as per spec gate
    // ("implement per the formula above and assert the values your
    // formula produces"). Documented in PR body.
    const w = computeRecoveryWindow({
      distanceKm: 42.195,
      durationMin: null,
      modality: "run",
      priority: "A",
      userTier: 3,
    });
    expect(w?.days).toBe(14);
  });

  it("5K, run, A-priority, tier-2 → 2 × 1.0 × 1.0 × 1.2 = 2.4 → 2d, ≤3d bracket", () => {
    const w = computeRecoveryWindow({
      distanceKm: 5,
      durationMin: null,
      modality: "run",
      priority: "A",
      userTier: 2,
    });
    expect(w?.days).toBe(2);
    expect(w?.cardioLoadScale).toBe(0.3);
    expect(w?.strengthLoadScale).toBe(0);
  });

  it("HM, run, B-priority, tier-2 → 7 × 1.0 × 1.0 × 1.0 = 7d, ≤7d bracket", () => {
    const w = computeRecoveryWindow({
      distanceKm: 21.0975,
      durationMin: null,
      modality: "run",
      priority: "B",
      userTier: 2,
    });
    expect(w?.days).toBe(7);
    expect(w?.cardioLoadScale).toBe(0.4);
  });

  it("century bike (100km), A, tier-2 → 28 × 0.5 × 1.0 × 1.2 = 16.8 → 17d", () => {
    const w = computeRecoveryWindow({
      distanceKm: 100,
      durationMin: null,
      modality: "bike",
      priority: "A",
      userTier: 2,
    });
    expect(w?.days).toBe(17);
    expect(w?.cardioLoadScale).toBe(0.5);
  });

  it("10K swim, A, tier-2 → swim modality 0.35 multiplier", () => {
    const w = computeRecoveryWindow({
      distanceKm: 10,
      durationMin: null,
      modality: "swim",
      priority: "A",
      userTier: 2,
    });
    // 4 × 0.35 × 1.0 × 1.2 = 1.68 → 2d
    expect(w?.days).toBe(2);
    expect(w?.cardioLoadScale).toBe(0.3);
  });

  it("ultra 50km, A, tier-2 → confidence: LOW", () => {
    const w = computeRecoveryWindow({
      distanceKm: 50,
      durationMin: null,
      modality: "run",
      priority: "A",
      userTier: 2,
    });
    expect(w?.confidence).toBe("LOW");
    // 21 × 1.0 × 1.0 × 1.2 = 25.2 → 25d
    expect(w?.days).toBe(25);
  });

  it("100-mile ultra, A, tier-4 elite → still flagged LOW", () => {
    const w = computeRecoveryWindow({
      distanceKm: 160,
      durationMin: null,
      modality: "run",
      priority: "A",
      userTier: 4,
    });
    expect(w?.confidence).toBe("LOW");
    // 35 × 1.0 × 0.75 × 1.2 = 31.5 → 32d
    expect(w?.days).toBe(32);
  });

  it("untrained tier-0 marathon, A → 14 × 1.0 × 1.5 × 1.2 = 25.2 → 25d", () => {
    const w = computeRecoveryWindow({
      distanceKm: 42.195,
      durationMin: null,
      modality: "run",
      priority: "A",
      userTier: 0,
    });
    expect(w?.days).toBe(25);
  });

  it("triathlon sprint (<90min, B) → 4d bucket", () => {
    const w = computeRecoveryWindow({
      distanceKm: null,
      durationMin: 70,
      modality: "triathlon",
      priority: "B",
      userTier: 2,
    });
    expect(w?.days).toBe(4); // 4 × 1.0(tri) × 1.0(tier2) × 1.0(B)
    expect(w?.cardioLoadScale).toBe(0.4);
  });

  it("triathlon Olympic (~150min, A) → 6 × 1.2 = 7d", () => {
    const w = computeRecoveryWindow({
      distanceKm: null,
      durationMin: 150,
      modality: "triathlon",
      priority: "A",
      userTier: 2,
    });
    expect(w?.days).toBe(7);
  });

  it("triathlon Ironman (>360min, A, tier-2) → 14 × 1.2 = 16.8 → 17d", () => {
    const w = computeRecoveryWindow({
      distanceKm: null,
      durationMin: 540,
      modality: "triathlon",
      priority: "A",
      userTier: 2,
    });
    expect(w?.days).toBe(17);
  });

  it("rowing 5K, A, tier-2 → row modality 0.35 → 2 × 0.35 × 1.0 × 1.2 ≈ 0.84 → clamp to 1d", () => {
    const w = computeRecoveryWindow({
      distanceKm: 5,
      durationMin: null,
      modality: "row",
      priority: "A",
      userTier: 2,
    });
    expect(w?.days).toBe(1);
  });

  it("modality matrix at HM, A, tier-2: run vs bike vs swim ordering", () => {
    const base = {
      distanceKm: 21.0975,
      durationMin: null,
      priority: "A" as const,
      userTier: 2,
    };
    const run = computeRecoveryWindow({ ...base, modality: "run" });
    const bike = computeRecoveryWindow({ ...base, modality: "bike" });
    const swim = computeRecoveryWindow({ ...base, modality: "swim" });
    expect(run!.days).toBeGreaterThan(bike!.days);
    expect(bike!.days).toBeGreaterThan(swim!.days);
  });

  it("rampDays = max(3, days × 0.5)", () => {
    const w = computeRecoveryWindow({
      distanceKm: 42.195,
      durationMin: null,
      modality: "run",
      priority: "A",
      userTier: 2,
    });
    expect(w?.rampDays).toBe(Math.max(3, Math.round(17 * 0.5)));
  });
});

describe("scaleForDateInWindow", () => {
  const win = {
    days: 14,
    strengthLoadScale: 0,
    cardioLoadScale: 0.5,
    rampDays: 7,
  };

  it("returns null outside window", () => {
    expect(
      scaleForDateInWindow({
        window: win,
        startDate: "2026-06-02",
        targetDate: "2026-06-01",
      }),
    ).toBeNull();
    expect(
      scaleForDateInWindow({
        window: win,
        startDate: "2026-06-02",
        targetDate: "2026-06-16",
      }),
    ).toBeNull();
  });

  it("flat first half of >7d window", () => {
    const s = scaleForDateInWindow({
      window: win,
      startDate: "2026-06-02",
      targetDate: "2026-06-04",
    });
    expect(s?.strengthLoadScale).toBe(0);
    expect(s?.cardioLoadScale).toBe(0.5);
  });

  it("linear ramp in second half of >7d window", () => {
    // staticDays = 14 - 7 = 7. dayIdx = 7 → first ramp day.
    // t = 1/7. cardio: 0.5 + 0.5 × 1/7 ≈ 0.571
    const s = scaleForDateInWindow({
      window: win,
      startDate: "2026-06-02",
      targetDate: "2026-06-09",
    });
    expect(s?.cardioLoadScale).toBeCloseTo(0.5 + 0.5 / 7, 5);
    expect(s?.strengthLoadScale).toBeCloseTo(1 / 7, 5);
  });

  it("flat throughout ≤7d window (no ramp)", () => {
    const small = { days: 4, strengthLoadScale: 0, cardioLoadScale: 0.4, rampDays: 3 };
    for (let i = 0; i < 4; i++) {
      const d = new Date(`2026-06-02T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const s = scaleForDateInWindow({
        window: small,
        startDate: "2026-06-02",
        targetDate: d.toISOString().slice(0, 10),
      });
      expect(s?.cardioLoadScale).toBe(0.4);
      expect(s?.strengthLoadScale).toBe(0);
    }
  });
});
