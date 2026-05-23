/**
 * Per-movement deep-dive — Phase 5 pure-helper unit tests.
 *
 * Pins the high-stakes Phase 5 decisions:
 *   - PR flag is set only on rows whose e1RM strictly exceeds every
 *     prior session's e1RM (not just the immediately-prior one).
 *   - RPE creep fires when the recent 28-day mean RPE rises by ≥1 AND
 *     the top weight stays flat or drops. Short series → false / no
 *     spurious flag.
 *   - Swap history is chronological newest-first and surfaces BOTH
 *     directions when the user has swapped this movement in or out.
 *   - Sister-movement picker degrades gracefully when role / pattern
 *     are missing — non-strength movements (e.g. cardio) fall back to
 *     functional_roles[] overlap.
 *
 * The I/O wrappers (`getMovementSwapHistory`, `getSisterMovements`) are
 * exercised by the e2e spec; the unit suite covers the pure derivations
 * they delegate to.
 */
import { describe, it, expect } from "vitest";
import {
  deriveSwapHistory,
  detectRpeCreep,
  filterSeriesToRange,
  formatSlopePerWeek,
  linearRegressionSlopePerDay,
  pickSisters,
  rollupRpePerSession,
  rollupTopSetsPerSession,
  rollupVolumePerSession,
  type WorkingSetRow,
  type RpePoint,
} from "../movement";

function ws(
  partial: Partial<WorkingSetRow> & { sessionId: string; performedAt: string },
): WorkingSetRow {
  return {
    weight: 100,
    reps: 5,
    rpe: 8,
    ...partial,
  };
}

describe("rollupTopSetsPerSession (Phase 5)", () => {
  it("flags isPR only when e1RM strictly exceeds every prior session", () => {
    // Three sessions:
    //   S1 100×5 → e1rm 116.7
    //   S2 105×5 → e1rm 122.5 (PR)
    //   S3 100×5 → e1rm 116.7 (not PR — below S2)
    //   S4 110×5 → e1rm 128.3 (PR)
    const rows: WorkingSetRow[] = [
      ws({ sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", weight: 100, reps: 5 }),
      ws({ sessionId: "s2", performedAt: "2026-04-08T10:00:00Z", weight: 105, reps: 5 }),
      ws({ sessionId: "s3", performedAt: "2026-04-15T10:00:00Z", weight: 100, reps: 5 }),
      ws({ sessionId: "s4", performedAt: "2026-04-22T10:00:00Z", weight: 110, reps: 5 }),
    ];
    const result = rollupTopSetsPerSession(rows);
    expect(result.map((p) => p.isPR)).toEqual([true, true, false, true]);
  });

  it("picks the heaviest set per session as the top set (tiebreak by reps)", () => {
    const rows: WorkingSetRow[] = [
      ws({ sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", weight: 100, reps: 5 }),
      ws({ sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", weight: 110, reps: 3 }),
      ws({ sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", weight: 110, reps: 5 }),
      ws({ sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", weight: 95, reps: 10 }),
    ];
    const result = rollupTopSetsPerSession(rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.weight).toBe(110);
    expect(result[0]!.reps).toBe(5);
  });

  it("returns [] for empty input", () => {
    expect(rollupTopSetsPerSession([])).toEqual([]);
  });
});

describe("linearRegressionSlopePerDay + formatSlopePerWeek", () => {
  it("computes a positive slope when e1RM trends up linearly", () => {
    const slope = linearRegressionSlopePerDay([
      { performedAt: "2026-04-01T10:00:00Z", e1rm: 100 },
      { performedAt: "2026-04-08T10:00:00Z", e1rm: 105 },
      { performedAt: "2026-04-15T10:00:00Z", e1rm: 110 },
    ]);
    expect(slope).not.toBeNull();
    expect(slope!).toBeCloseTo(5 / 7, 3);
    expect(formatSlopePerWeek(slope!)).toBe("+5.0 kg/week");
  });

  it("returns null for a single point", () => {
    expect(
      linearRegressionSlopePerDay([
        { performedAt: "2026-04-01T10:00:00Z", e1rm: 100 },
      ]),
    ).toBeNull();
  });
});

describe("rollupVolumePerSession", () => {
  it("sums (weight × reps) across all working sets per session", () => {
    const rows: WorkingSetRow[] = [
      ws({ sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", weight: 100, reps: 5 }),
      ws({ sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", weight: 100, reps: 5 }),
      ws({ sessionId: "s2", performedAt: "2026-04-08T10:00:00Z", weight: 110, reps: 3 }),
    ];
    const result = rollupVolumePerSession(rows);
    expect(result).toEqual([
      { sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", tonnage: 1000 },
      { sessionId: "s2", performedAt: "2026-04-08T10:00:00Z", tonnage: 330 },
    ]);
  });
});

describe("rollupRpePerSession", () => {
  it("averages RPE per session and tracks top weight", () => {
    const rows: WorkingSetRow[] = [
      ws({ sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", weight: 100, reps: 5, rpe: 7 }),
      ws({ sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", weight: 110, reps: 3, rpe: 9 }),
    ];
    const result = rollupRpePerSession(rows);
    expect(result).toEqual([
      {
        sessionId: "s1",
        performedAt: "2026-04-01T10:00:00Z",
        rpe: 8,
        topWeight: 110,
      },
    ]);
  });

  it("returns null rpe when the session has no RPE entries", () => {
    const rows: WorkingSetRow[] = [
      ws({ sessionId: "s1", performedAt: "2026-04-01T10:00:00Z", weight: 100, reps: 5, rpe: null }),
    ];
    expect(rollupRpePerSession(rows)[0]!.rpe).toBeNull();
  });
});

describe("detectRpeCreep", () => {
  function rpeAt(daysAgo: number, rpe: number, topWeight = 100): RpePoint {
    const ms = Date.now() - daysAgo * 86_400_000;
    return {
      sessionId: `s${daysAgo}`,
      performedAt: new Date(ms).toISOString(),
      rpe,
      topWeight,
    };
  }

  it("flags when the recent 28-day mean RPE rises by ≥1 on flat weight", () => {
    const series: RpePoint[] = [
      // Earlier window (28..56 days ago): mean RPE 7, weight 100
      rpeAt(55, 7, 100),
      rpeAt(48, 7, 100),
      rpeAt(40, 7, 100),
      rpeAt(32, 7, 100),
      // Recent window (last 28 days): mean RPE 8.5, weight 100 (flat)
      rpeAt(20, 8, 100),
      rpeAt(14, 9, 100),
      rpeAt(7, 8.5, 100),
      rpeAt(1, 8.5, 100),
    ];
    const r = detectRpeCreep(series);
    expect(r.flagged).toBe(true);
    expect(r.rpeDelta).not.toBeNull();
    expect(r.rpeDelta!).toBeGreaterThanOrEqual(1);
    expect(r.weightDelta).not.toBeNull();
    expect(Math.abs(r.weightDelta!)).toBeLessThan(0.5);
  });

  it("does NOT flag when RPE rose but weight rose too (productive overload)", () => {
    const series: RpePoint[] = [
      rpeAt(55, 7, 100),
      rpeAt(48, 7, 100),
      rpeAt(40, 7, 100),
      rpeAt(32, 7, 100),
      rpeAt(20, 8.5, 110),
      rpeAt(14, 9, 115),
      rpeAt(7, 8.5, 115),
      rpeAt(1, 8.5, 115),
    ];
    const r = detectRpeCreep(series);
    expect(r.flagged).toBe(false);
  });

  it("does NOT flag short series (< 2 sessions)", () => {
    expect(detectRpeCreep([]).flagged).toBe(false);
    expect(detectRpeCreep([rpeAt(1, 8, 100)]).flagged).toBe(false);
  });

  it("does NOT flag when one of the two 28-day windows has no RPE data", () => {
    // Only one window populated → cannot compare.
    const series: RpePoint[] = [rpeAt(7, 9, 100), rpeAt(1, 9, 100)];
    expect(detectRpeCreep(series).flagged).toBe(false);
  });
});

describe("deriveSwapHistory", () => {
  const TARGET = "movement-back-squat";
  const OTHER = "movement-front-squat";

  it("returns chronological newest-first events including both directions", () => {
    const rows = [
      // Swapped TO back-squat (from front-squat) on 2026-05-15
      {
        completed_session_id: "sess-1",
        prescription: {
          items: [
            {
              movementId: TARGET,
              movementName: "Back Squat",
              meta: {
                swappedFrom: { movementId: OTHER, movementName: "Front Squat" },
                swappedAt: "2026-05-15T10:00:00Z",
              },
            },
          ],
        },
      },
      // Swapped AWAY from back-squat (to pause-squat) on 2026-05-18
      {
        completed_session_id: null,
        prescription: {
          items: [
            {
              movementId: "movement-pause-squat",
              movementName: "Pause Squat",
              meta: {
                swappedFrom: { movementId: TARGET, movementName: "Back Squat" },
                swappedAt: "2026-05-18T10:00:00Z",
              },
            },
          ],
        },
      },
    ];

    const events = deriveSwapHistory(TARGET, rows);
    expect(events).toHaveLength(2);
    expect(events[0]!.swappedAt > events[1]!.swappedAt).toBe(true);
    const directions = events.map((e) => e.direction);
    expect(directions).toContain("to");
    expect(directions).toContain("from");
    const fromEvent = events.find((e) => e.direction === "from")!;
    expect(fromEvent.otherMovementName).toBe("Pause Squat");
  });

  it("ignores prescription items unrelated to the target movement", () => {
    const rows = [
      {
        completed_session_id: null,
        prescription: {
          items: [
            {
              movementId: "movement-bench-press",
              movementName: "Bench Press",
              meta: {
                swappedFrom: { movementId: "movement-dip", movementName: "Dip" },
                swappedAt: "2026-05-10T10:00:00Z",
              },
            },
          ],
        },
      },
    ];
    expect(deriveSwapHistory(TARGET, rows)).toEqual([]);
  });

  it("ignores items without swappedAt metadata", () => {
    const rows = [
      {
        completed_session_id: null,
        prescription: {
          items: [
            {
              movementId: TARGET,
              meta: { swappedFrom: { movementId: OTHER, movementName: "Front Squat" } },
            },
          ],
        },
      },
    ];
    expect(deriveSwapHistory(TARGET, rows)).toEqual([]);
  });
});

describe("pickSisters", () => {
  const back_squat = {
    id: "back-squat",
    slug: "back-squat",
    display_name: "Back Squat",
    pattern: "squat",
    functional_roles: ["quad_dominant_squat"],
  };
  const front_squat = {
    id: "front-squat",
    slug: "front-squat",
    display_name: "Front Squat",
    pattern: "squat",
    functional_roles: ["quad_dominant_squat"],
  };
  const bench = {
    id: "bench",
    slug: "bench",
    display_name: "Bench Press",
    pattern: "horizontal_press",
    functional_roles: ["chest_press"],
  };
  const row_easy = {
    id: "row",
    slug: "row",
    display_name: "Bent Row",
    pattern: "horizontal_pull",
    functional_roles: ["upper_back"],
  };

  it("ranks pattern-matched movements above mere functional-role peers", () => {
    const peers = pickSisters(
      { id: "back-squat", pattern: "squat", functionalRoles: ["quad_dominant_squat"] },
      [front_squat, bench, row_easy],
      6,
    );
    expect(peers.map((p) => p.id)).toEqual(["front-squat"]);
  });

  it("excludes self from the result", () => {
    const peers = pickSisters(
      { id: "back-squat", pattern: "squat", functionalRoles: ["quad_dominant_squat"] },
      [back_squat, front_squat],
      6,
    );
    expect(peers.map((p) => p.id)).toEqual(["front-squat"]);
  });

  it("falls back gracefully when pattern is undefined / role list is empty (e.g. cardio)", () => {
    // No pattern, no shared roles → no matches.
    const peers = pickSisters(
      { id: "treadmill-z2", pattern: null, functionalRoles: [] },
      [bench, row_easy],
      6,
    );
    expect(peers).toEqual([]);
  });

  it("uses functional_roles overlap when pattern is missing", () => {
    const treadmill = {
      id: "treadmill",
      slug: "treadmill",
      display_name: "Treadmill",
      pattern: null,
      functional_roles: ["cardio_z2"],
    };
    const rower = {
      id: "rower",
      slug: "rower",
      display_name: "Rower",
      pattern: null,
      functional_roles: ["cardio_z2"],
    };
    const peers = pickSisters(
      { id: "treadmill", pattern: null, functionalRoles: ["cardio_z2"] },
      [treadmill, rower],
      6,
    );
    expect(peers.map((p) => p.id)).toEqual(["rower"]);
  });
});

describe("filterSeriesToRange", () => {
  it("keeps everything for range=all", () => {
    const series = [
      { performedAt: new Date(Date.now() - 365 * 86_400_000).toISOString() },
      { performedAt: new Date().toISOString() },
    ];
    expect(filterSeriesToRange(series, "all")).toHaveLength(2);
  });

  it("trims to the last 30 days for range=30d", () => {
    const old = { performedAt: new Date(Date.now() - 60 * 86_400_000).toISOString() };
    const recent = { performedAt: new Date(Date.now() - 5 * 86_400_000).toISOString() };
    expect(filterSeriesToRange([old, recent], "30d")).toEqual([recent]);
  });
});
