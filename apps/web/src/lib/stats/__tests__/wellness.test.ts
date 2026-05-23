/**
 * Wellness lib — Phase 3.
 *
 * Tests cover:
 *   - getWellnessTimeseries filters by user and range.
 *   - getSessionWellness filters by user + excludes soft-deleted sessions.
 *   - calcPredictionCorrelation: n<10 → null, perfect → 1, anti → -1,
 *     zero-variance → null.
 *   - predictionStrength bands at the boundaries.
 *   - linearTrend: pure math edge cases.
 */
import { describe, it, expect } from "vitest";
import {
  getSessionWellness,
  getWellnessTimeseries,
  predictionPairsFromSessions,
  calcPredictionCorrelation,
  predictionStrength,
  linearTrend,
  linearTrendSeries,
} from "../wellness";
import { makeFakeSupabase, type Tables } from "./fake-supabase";

const TZ = "UTC";

function emptyTables(): Tables {
  return {
    training_blocks: [],
    planned_sessions: [],
    sessions: [],
    set_logs: [],
    movements: [],
    wellness: [],
    profiles: [],
  };
}

describe("getWellnessTimeseries", () => {
  it("returns only the user's rows in the date range, oldest first", async () => {
    const tables = emptyTables();
    const today = new Date().toISOString().slice(0, 10);
    const mkDate = (days: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - days);
      return d.toISOString().slice(0, 10);
    };
    tables.wellness = [
      // Owner: USER_A, in range.
      { user_id: "USER_A", date: mkDate(2), bodyweight_kg: 82.0, motivation: 4 },
      { user_id: "USER_A", date: mkDate(1), bodyweight_kg: 82.2, motivation: 5 },
      // Owner: USER_A, out of range (older than 30d).
      { user_id: "USER_A", date: mkDate(45), bodyweight_kg: 80.0, motivation: 3 },
      // Other user — must be excluded.
      { user_id: "USER_B", date: today, bodyweight_kg: 99.0, motivation: 1 },
    ];
    const sb = makeFakeSupabase(tables);
    const rows = await getWellnessTimeseries(sb, "USER_A", TZ, 30);
    expect(rows).toHaveLength(2);
    expect(rows[0].date < rows[1].date).toBe(true);
    expect(rows.every((r) => r.bodyweight_kg != null)).toBe(true);
    expect(rows.some((r) => r.bodyweight_kg === 99.0)).toBe(false);
  });

  it("windowDays=null returns all-time", async () => {
    const tables = emptyTables();
    tables.wellness = [
      { user_id: "USER_A", date: "2024-01-01", bodyweight_kg: 80.0, motivation: null },
      { user_id: "USER_A", date: "2025-01-01", bodyweight_kg: 82.0, motivation: null },
    ];
    const sb = makeFakeSupabase(tables);
    const rows = await getWellnessTimeseries(sb, "USER_A", TZ, null);
    expect(rows).toHaveLength(2);
  });
});

describe("getSessionWellness", () => {
  it("excludes soft-deleted sessions", async () => {
    const tables = emptyTables();
    const now = new Date();
    const iso = (daysBack: number) => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - daysBack);
      return d.toISOString();
    };
    tables.sessions = [
      {
        user_id: "USER_A",
        performed_at: iso(1),
        fatigue: 2,
        soreness: 3,
        session_rpe: 7,
        deleted_at: null,
      },
      {
        user_id: "USER_A",
        performed_at: iso(2),
        fatigue: 4,
        soreness: 4,
        session_rpe: 9,
        deleted_at: iso(0), // soft-deleted, must be excluded
      },
      {
        user_id: "USER_B",
        performed_at: iso(1),
        fatigue: 1,
        soreness: 1,
        session_rpe: 5,
        deleted_at: null,
      },
    ];
    const sb = makeFakeSupabase(tables);
    const rows = await getSessionWellness(sb, "USER_A", TZ, 30);
    expect(rows).toHaveLength(1);
    expect(rows[0].fatigue).toBe(2);
    expect(rows[0].soreness).toBe(3);
    expect(rows[0].session_rpe).toBe(7);
  });
});

describe("predictionPairsFromSessions", () => {
  it("includes only sessions with all three fields", () => {
    const pairs = predictionPairsFromSessions([
      { performed_at: "x", fatigue: 2, soreness: 2, session_rpe: 7 },
      { performed_at: "x", fatigue: null, soreness: 2, session_rpe: 7 },
      { performed_at: "x", fatigue: 2, soreness: null, session_rpe: 7 },
      { performed_at: "x", fatigue: 2, soreness: 2, session_rpe: null },
    ]);
    expect(pairs).toEqual([{ pre: 4, rpe: 7 }]);
  });
});

describe("calcPredictionCorrelation", () => {
  it("returns null when n < 10", () => {
    const pairs = Array.from({ length: 9 }, (_, i) => ({ pre: i, rpe: i }));
    expect(calcPredictionCorrelation(pairs)).toBeNull();
  });

  it("perfect linear → +1", () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({ pre: i + 2, rpe: i + 2 }));
    const r = calcPredictionCorrelation(pairs);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(1, 10);
  });

  it("anti-correlated → -1", () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({ pre: i + 2, rpe: 12 - i }));
    const r = calcPredictionCorrelation(pairs);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(-1, 10);
  });

  it("zero variance on one axis → null", () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({ pre: 5, rpe: i + 1 }));
    expect(calcPredictionCorrelation(pairs)).toBeNull();
  });

  it("clamps to [-1, 1]", () => {
    const pairs = Array.from({ length: 15 }, (_, i) => ({ pre: i, rpe: 2 * i + 1 }));
    const r = calcPredictionCorrelation(pairs);
    expect(r).not.toBeNull();
    expect(r!).toBeLessThanOrEqual(1);
    expect(r!).toBeGreaterThanOrEqual(-1);
  });
});

describe("predictionStrength", () => {
  it("bands at the spec boundaries", () => {
    expect(predictionStrength(0)).toBe("weak");
    expect(predictionStrength(0.29)).toBe("weak");
    expect(predictionStrength(0.3)).toBe("moderate");
    expect(predictionStrength(0.49)).toBe("moderate");
    expect(predictionStrength(0.5)).toBe("strong");
    expect(predictionStrength(0.69)).toBe("strong");
    expect(predictionStrength(0.7)).toBe("very strong");
    expect(predictionStrength(0.95)).toBe("very strong");
    // Uses |r| so anti-correlation also gets labelled.
    expect(predictionStrength(-0.85)).toBe("very strong");
  });
});

describe("linearTrend", () => {
  it("returns null for fewer than two values", () => {
    expect(linearTrend([])).toBeNull();
    expect(linearTrend([5])).toBeNull();
  });

  it("zero slope on a constant series", () => {
    expect(linearTrend([3, 3, 3, 3, 3])).toBe(0);
  });

  it("slope = 1 for 0,1,2,3,4", () => {
    expect(linearTrend([0, 1, 2, 3, 4])).toBeCloseTo(1, 10);
  });

  it("slope = -2 for 10,8,6,4,2", () => {
    expect(linearTrend([10, 8, 6, 4, 2])).toBeCloseTo(-2, 10);
  });
});

describe("linearTrendSeries", () => {
  it("returns the regression line for a perfect linear input", () => {
    const out = linearTrendSeries([0, 2, 4, 6, 8]);
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(5);
    out!.forEach((v, i) => expect(v).toBeCloseTo(2 * i, 10));
  });
  it("returns null when slope is undefined", () => {
    expect(linearTrendSeries([])).toBeNull();
    expect(linearTrendSeries([5])).toBeNull();
  });
});
