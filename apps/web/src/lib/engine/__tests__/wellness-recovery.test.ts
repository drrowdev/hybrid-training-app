/**
 * Unit tests for the pure daily-wellness → recoveryMultiplier mapping.
 *
 * Covers each band of the heuristic, the null-data fallbacks, and the
 * exact-boundary deltas — these matter because the audit spec mixes `≤`
 * and `<` thresholds and a subtle off-by-one would silently shift every
 * user's ceiling.
 */

import { describe, it, expect } from "vitest";
import {
  computeRecoveryMultiplier,
  MIN_HISTORICAL_POINTS,
  type WellnessSnapshot,
} from "../wellness-recovery";

/** Build a snapshot with both sliders set to the same value. */
function snap(date: string, score: number): WellnessSnapshot {
  return { date, fatigue: score, soreness: score };
}

/** Build a baseline of N identical historical snapshots. */
function baseline(score: number, n = MIN_HISTORICAL_POINTS): WellnessSnapshot[] {
  return Array.from({ length: n }, (_, i) =>
    snap(`2026-04-${String(10 + i).padStart(2, "0")}`, score),
  );
}

describe("computeRecoveryMultiplier — bands", () => {
  it("much better than average (delta ≤ -2.0) → 1.10", () => {
    // baseline avg = 5, today = 3 → delta = -2.0 (boundary, ≤ matches).
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 3),
      recent: baseline(5),
    });
    expect(r).toBe(1.1);
  });

  it("better than average (delta ≤ -1.0) → 1.05", () => {
    // baseline avg = 5, today = 4 → delta = -1.0 (boundary).
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 4),
      recent: baseline(5),
    });
    expect(r).toBe(1.05);
  });

  it("neutral band (small delta) → 1.00", () => {
    // baseline avg = 5, today = 5 → delta = 0.
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 5),
      recent: baseline(5),
    });
    expect(r).toBe(1.0);
  });

  it("mildly worse (1.0 ≤ delta < 2.0) → 0.90", () => {
    // baseline avg = 5, today = 6 → delta = +1.0 (boundary, drops to 0.90).
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 6),
      recent: baseline(5),
    });
    expect(r).toBe(0.9);
  });

  it("clearly worse (2.0 ≤ delta < 3.0) → 0.80", () => {
    // baseline avg = 5, today = 7 → delta = +2.0 (boundary, drops to 0.80).
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 7),
      recent: baseline(5),
    });
    expect(r).toBe(0.8);
  });

  it("much worse (delta ≥ +3.0) → 0.70", () => {
    // baseline avg = 5, today = 8 → delta = +3.0 (boundary, drops to floor).
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 8),
      recent: baseline(5),
    });
    expect(r).toBe(0.7);
  });

  it("extreme delta clamps at the floor (0.70)", () => {
    // baseline avg = 1 (fresh forever), today = 9 → delta = +8.
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 9),
      recent: baseline(1),
    });
    expect(r).toBe(0.7);
  });
});

describe("computeRecoveryMultiplier — null-data fallbacks", () => {
  it("returns null when today is null (we don't penalise for forgetting)", () => {
    const r = computeRecoveryMultiplier({
      today: null,
      recent: baseline(5, 7),
    });
    expect(r).toBeNull();
  });

  it("returns null when both fatigue and soreness are null today", () => {
    const r = computeRecoveryMultiplier({
      today: { date: "2026-04-20", fatigue: null, soreness: null },
      recent: baseline(5),
    });
    expect(r).toBeNull();
  });

  it("returns null with fewer than MIN_HISTORICAL_POINTS usable points", () => {
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 5),
      recent: baseline(5, MIN_HISTORICAL_POINTS - 1),
    });
    expect(r).toBeNull();
  });

  it("ignores historical rows with no usable score when counting points", () => {
    // Two usable points + one row with both sliders null → still below
    // the 3-point threshold.
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 5),
      recent: [
        snap("2026-04-19", 5),
        snap("2026-04-18", 5),
        { date: "2026-04-17", fatigue: null, soreness: null },
      ],
    });
    expect(r).toBeNull();
  });

  it("uses the single available slider when only one is null in a snapshot", () => {
    // History averages to 5; today only soreness reported (=3). Score
    // should be treated as 3, delta = -2 → 1.10.
    const r = computeRecoveryMultiplier({
      today: { date: "2026-04-20", fatigue: null, soreness: 3 },
      recent: baseline(5),
    });
    expect(r).toBe(1.1);
  });

  it("de-dupes today out of recent so callers can pass it through safely", () => {
    // If today (score 5) is also present in recent, the baseline must
    // not include it. Recent has today + 3 ones → avg of just the ones
    // = 1.0; delta = +4 → 0.70.
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 5),
      recent: [
        snap("2026-04-20", 5), // duplicate of today, should be skipped
        snap("2026-04-19", 1),
        snap("2026-04-18", 1),
        snap("2026-04-17", 1),
      ],
    });
    expect(r).toBe(0.7);
  });
});

describe("computeRecoveryMultiplier — exact boundary deltas", () => {
  // The audit spec mixes ≤ and < — these tests pin the exact semantics
  // so a future refactor can't silently re-tier them.
  it("delta = -2.0 exactly → 1.10 (≤ -2 band)", () => {
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 3),
      recent: baseline(5),
    });
    expect(r).toBe(1.1);
  });

  it("delta = -1.0 exactly → 1.05 (≤ -1 band, not the neutral band)", () => {
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 4),
      recent: baseline(5),
    });
    expect(r).toBe(1.05);
  });

  it("delta = +1.0 exactly → 0.90 (NOT the neutral band)", () => {
    // < 1.0 is the neutral band; delta of exactly 1.0 falls into the
    // mild-worse band.
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 6),
      recent: baseline(5),
    });
    expect(r).toBe(0.9);
  });

  it("delta = +2.0 exactly → 0.80", () => {
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 7),
      recent: baseline(5),
    });
    expect(r).toBe(0.8);
  });

  it("delta = +3.0 exactly → 0.70 (floor)", () => {
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 8),
      recent: baseline(5),
    });
    expect(r).toBe(0.7);
  });

  it("delta just inside neutral (+0.99) → 1.00", () => {
    // baseline avg = 5.01, today = 6 → delta = 0.99 → still neutral.
    const r = computeRecoveryMultiplier({
      today: snap("2026-04-20", 6),
      recent: [
        snap("2026-04-19", 5),
        snap("2026-04-18", 5),
        snap("2026-04-17", 5.03), // bump avg so delta < 1.0
      ],
    });
    expect(r).toBe(1.0);
  });
});
