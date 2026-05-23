/**
 * DC-K1 — recovered-week rule tests.
 *
 * Pins all five failure paths, the all-null-passes policy, the happy
 * path, the median primitive, and the cold-start ladder in
 * `pickCeilingBase`. Every test cites DC-K1 / DC-C9 / DC-C13 where
 * relevant per AGENTS.md ("Cite the DC-* identifier in the test
 * description").
 */
import { describe, it, expect } from "vitest";
import {
  isRecoveredWeek,
  median,
  pickCeilingBase,
  type WeekRecoveryInput,
} from "./recovered-weeks";

function baseWeek(overrides: Partial<WeekRecoveryInput> = {}): WeekRecoveryInput {
  return {
    weekStart: "2026-05-04",
    plannedSessions: 4,
    loggedSessions: 4,
    skippedSessions: 0,
    missedSessions: 0,
    maxSrpe: 7.5,
    avgFatigue: 2.5,
    avgSoreness: 2.5,
    ...overrides,
  };
}

describe("DC-K1 isRecoveredWeek", () => {
  it("happy path — all sessions logged, no overreach → recovered", () => {
    const r = isRecoveredWeek(baseWeek());
    expect(r.isRecovered).toBe(true);
    expect(r.reason).toMatch(/all sessions logged/i);
  });

  it("DC-K1 failure #1: skippedSessions > 0 → not recovered", () => {
    const r = isRecoveredWeek(baseWeek({ skippedSessions: 1 }));
    expect(r.isRecovered).toBe(false);
    expect(r.reason).toMatch(/1 session skipped/);
  });

  it("DC-K1 failure #2: missedSessions > 0 → not recovered", () => {
    const r = isRecoveredWeek(baseWeek({ missedSessions: 2 }));
    expect(r.isRecovered).toBe(false);
    expect(r.reason).toMatch(/2 sessions missed/);
  });

  it("DC-K1 failure #3: maxSrpe > 9 → not recovered (overreach signal)", () => {
    const r = isRecoveredWeek(baseWeek({ maxSrpe: 9.5 }));
    expect(r.isRecovered).toBe(false);
    expect(r.reason).toMatch(/sRPE peaked at 9\.5/);
  });

  it("DC-K1 failure #3 boundary: maxSrpe exactly 9 is NOT overreach", () => {
    const r = isRecoveredWeek(baseWeek({ maxSrpe: 9 }));
    expect(r.isRecovered).toBe(true);
  });

  it("DC-K1 failure #4: avgFatigue >= 4 → not recovered (elevated stress)", () => {
    const r = isRecoveredWeek(baseWeek({ avgFatigue: 4.2 }));
    expect(r.isRecovered).toBe(false);
    expect(r.reason).toMatch(/avg fatigue 4\.2/);
  });

  it("DC-K1 failure #4 boundary: avgFatigue exactly 4 IS elevated (>= 4)", () => {
    const r = isRecoveredWeek(baseWeek({ avgFatigue: 4 }));
    expect(r.isRecovered).toBe(false);
  });

  it("DC-K1 failure #5: avgSoreness >= 4 → not recovered", () => {
    const r = isRecoveredWeek(baseWeek({ avgSoreness: 4.5 }));
    expect(r.isRecovered).toBe(false);
    expect(r.reason).toMatch(/avg soreness 4\.5/);
  });

  it("DC-K1 NULL policy: all signals null + planned == logged → recovered (user just didn't log sliders)", () => {
    const r = isRecoveredWeek(
      baseWeek({ maxSrpe: null, avgFatigue: null, avgSoreness: null }),
    );
    expect(r.isRecovered).toBe(true);
    expect(r.reason).toMatch(/all sessions logged/i);
  });

  it("DC-K1 informativeness guard: zero logged sessions is not recovered (no-data, not recovered)", () => {
    const r = isRecoveredWeek(
      baseWeek({ plannedSessions: 0, loggedSessions: 0 }),
    );
    expect(r.isRecovered).toBe(false);
    expect(r.reason).toMatch(/no logged sessions/i);
  });

  it("DC-K1 failure precedence: skipped is reported before sRPE / fatigue", () => {
    const r = isRecoveredWeek(
      baseWeek({ skippedSessions: 1, maxSrpe: 9.8, avgFatigue: 4.9 }),
    );
    expect(r.reason).toMatch(/skipped/);
  });
});

describe("median", () => {
  it("returns 0 on an empty list (caller branches on length)", () => {
    expect(median([])).toBe(0);
  });
  it("returns the single value when n=1 (cold-start partial case)", () => {
    expect(median([4200])).toBe(4200);
  });
  it("returns the middle value for odd n", () => {
    expect(median([3000, 5000, 4000])).toBe(4000);
  });
  it("averages the two middle values for even n", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("DC-C9 / DC-C13 pickCeilingBase — cold-start ladder", () => {
  // Helper: build a desc-sorted rollup of n recovered weeks + m
  // failing weeks, with each weekStart 7 days earlier than the prior.
  const VOLUMES: Record<string, number> = {
    "2026-05-04": 5200,
    "2026-04-27": 4800,
    "2026-04-20": 5400,
    "2026-04-13": 4400,
    "2026-04-06": 4600,
  };
  const volumeFor = (ws: string) => VOLUMES[ws] ?? 0;

  it("3+ recovered weeks → median_of_recovered, bias = 1.0", () => {
    const rollup: WeekRecoveryInput[] = [
      baseWeek({ weekStart: "2026-05-04" }),
      baseWeek({ weekStart: "2026-04-27" }),
      baseWeek({ weekStart: "2026-04-20" }),
      baseWeek({ weekStart: "2026-04-13" }),
    ];
    const out = pickCeilingBase(rollup, volumeFor);
    expect(out.formula).toBe("median_of_recovered");
    expect(out.confidenceBias).toBe(1.0);
    // Top-3 volumes are 5200, 4800, 5400 → median = 5200.
    expect(out.baseCeiling).toBe(5200);
    expect(out.basisWeeks).toHaveLength(3);
    expect(out.basisWeeks.every((b) => b.included)).toBe(true);
  });

  it("2 recovered weeks → cold_start_partial, bias = 0.8", () => {
    const rollup: WeekRecoveryInput[] = [
      baseWeek({ weekStart: "2026-05-04" }),
      baseWeek({ weekStart: "2026-04-27", skippedSessions: 1 }), // fails
      baseWeek({ weekStart: "2026-04-20" }),
      baseWeek({ weekStart: "2026-04-13", avgFatigue: 4.5 }), // fails
    ];
    const out = pickCeilingBase(rollup, volumeFor);
    expect(out.formula).toBe("cold_start_partial");
    expect(out.confidenceBias).toBe(0.8);
    // Volumes 5200, 5400 → median = 5300.
    expect(out.baseCeiling).toBe(5300);
  });

  it("1 recovered week → cold_start_partial with that single value (median of n=1)", () => {
    const rollup: WeekRecoveryInput[] = [
      baseWeek({ weekStart: "2026-05-04", maxSrpe: 9.5 }), // fails
      baseWeek({ weekStart: "2026-04-27" }), // passes
      baseWeek({ weekStart: "2026-04-20", missedSessions: 1 }), // fails
    ];
    const out = pickCeilingBase(rollup, volumeFor);
    expect(out.formula).toBe("cold_start_partial");
    expect(out.baseCeiling).toBe(4800);
    expect(out.confidenceBias).toBe(0.8);
  });

  it("0 recovered weeks → cold_start_conservative (min of last 4 × 0.9, bias 0.8)", () => {
    const rollup: WeekRecoveryInput[] = [
      baseWeek({ weekStart: "2026-05-04", skippedSessions: 1 }),
      baseWeek({ weekStart: "2026-04-27", missedSessions: 1 }),
      baseWeek({ weekStart: "2026-04-20", avgFatigue: 4.8 }),
      baseWeek({ weekStart: "2026-04-13", maxSrpe: 9.9 }),
    ];
    const out = pickCeilingBase(rollup, volumeFor);
    expect(out.formula).toBe("cold_start_conservative");
    expect(out.confidenceBias).toBe(0.8);
    // Min of (5200, 4800, 5400, 4400) = 4400; × 0.9 = 3960.
    expect(out.baseCeiling).toBeCloseTo(3960, 6);
    // No week is "included" in the basis — they're all displayed for
    // context only.
    expect(out.basisWeeks.every((b) => !b.included)).toBe(true);
  });

  it("0 weeks total → cold_start_conservative with baseCeiling = 0 (true cold start)", () => {
    const out = pickCeilingBase([], volumeFor);
    expect(out.formula).toBe("cold_start_conservative");
    expect(out.baseCeiling).toBe(0);
    expect(out.basisWeeks).toEqual([]);
  });
});
