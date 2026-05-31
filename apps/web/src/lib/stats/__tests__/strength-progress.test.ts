import { describe, it, expect } from "vitest";
import {
  composeStrengthProgress,
  STRENGTH_SLOPE_EPSILON_KG_PER_WEEK,
  STRENGTH_MIN_LIFTS_FOR_VERDICT,
  type StrengthLiftPoints,
} from "../strength-progress";

/**
 * Build a synthetic e1RM series whose least-squares slope (in kg/day) is
 * exactly `slopePerDay`. Spread points across `days` days at 1-day stride.
 */
function liftRising(
  id: string,
  label: string,
  startE1rm: number,
  slopePerWeek: number,
  days = 28,
): StrengthLiftPoints {
  const slopePerDay = slopePerWeek / 7;
  const points: Array<{ performedAt: string; e1rm: number }> = [];
  const base = new Date("2026-04-01T00:00:00Z").getTime();
  // Evenly spaced — 1 point per `gap` days, gives N >= 4 points.
  const N = Math.max(4, Math.floor(days / 7) * 2);
  for (let i = 0; i < N; i++) {
    const d = Math.round((i / (N - 1)) * days);
    points.push({
      performedAt: new Date(base + d * 86_400_000).toISOString(),
      e1rm: startE1rm + d * slopePerDay,
    });
  }
  return { movementId: id, label, points };
}

describe("composeStrengthProgress — pure verdict", () => {
  const WIN = 56;

  it("building — zero classifiable lifts (no points)", () => {
    const r = composeStrengthProgress([], WIN);
    expect(r.direction).toBe("building");
    expect(r.perLift).toHaveLength(0);
    expect(r.detail).toMatch(/no main lift/i);
    expect(r.windowDays).toBe(WIN);
  });

  it("building — only one classifiable lift (below min lifts threshold)", () => {
    expect(STRENGTH_MIN_LIFTS_FOR_VERDICT).toBeGreaterThan(1);
    const r = composeStrengthProgress(
      [
        liftRising("a", "Squat", 150, 1.0),
        // Single point: regression returns null → "building"
        { movementId: "b", label: "Bench", points: [{ performedAt: "2026-04-01", e1rm: 100 }] },
        { movementId: "c", label: "Deadlift", points: [] },
      ],
      WIN,
    );
    expect(r.direction).toBe("building");
    expect(r.perLift.find((l) => l.movementId === "b")?.direction).toBe("building");
    expect(r.perLift.find((l) => l.movementId === "c")?.direction).toBe("building");
  });

  it("up — majority of lifts rising above epsilon", () => {
    const r = composeStrengthProgress(
      [
        liftRising("a", "Squat", 150, 1.5),
        liftRising("b", "Bench", 100, 0.6),
        liftRising("c", "Deadlift", 180, 0.0),
        liftRising("d", "OHP", 60, 0.5),
      ],
      WIN,
    );
    expect(r.direction).toBe("up");
    const upCount = r.perLift.filter((l) => l.direction === "up").length;
    expect(upCount).toBeGreaterThanOrEqual(2);
    expect(r.detail).toMatch(/trending up/i);
  });

  it("down — majority of lifts regressing — regression honesty", () => {
    const r = composeStrengthProgress(
      [
        liftRising("a", "Squat", 150, -1.5),
        liftRising("b", "Bench", 100, -0.6),
        liftRising("c", "Deadlift", 180, 0.5),
      ],
      WIN,
    );
    expect(r.direction).toBe("down");
    expect(r.detail).toMatch(/regress/i);
  });

  it("flat — all lifts inside the ±epsilon band", () => {
    const r = composeStrengthProgress(
      [
        liftRising("a", "Squat", 150, 0.1),
        liftRising("b", "Bench", 100, -0.1),
        liftRising("c", "Deadlift", 180, 0.05),
      ],
      WIN,
    );
    expect(r.direction).toBe("flat");
    for (const l of r.perLift) expect(l.direction).toBe("flat");
  });

  it("flat — equal up vs down counts cancel out", () => {
    const r = composeStrengthProgress(
      [
        liftRising("a", "Squat", 150, 1.0),
        liftRising("b", "Bench", 100, -1.0),
      ],
      WIN,
    );
    expect(r.direction).toBe("flat");
  });

  it("epsilon boundary — slope strictly less than ε is flat, strictly greater is up/down", () => {
    const eps = STRENGTH_SLOPE_EPSILON_KG_PER_WEEK;
    const slightlyUnder = liftRising("a", "Squat", 150, eps * 0.5);
    const slightlyOver = liftRising("b", "Bench", 100, eps * 2);
    const r = composeStrengthProgress([slightlyUnder, slightlyOver], WIN);
    const a = r.perLift.find((l) => l.movementId === "a")!;
    const b = r.perLift.find((l) => l.movementId === "b")!;
    expect(a.direction).toBe("flat");
    expect(b.direction).toBe("up");
  });

  it("per-lift slopePerWeek is a real least-squares slope (sanity)", () => {
    const r = composeStrengthProgress([liftRising("a", "Squat", 150, 2.0)], WIN);
    const a = r.perLift[0]!;
    expect(a.slopePerWeek).not.toBeNull();
    expect(a.slopePerWeek!).toBeCloseTo(2.0, 1);
  });
});
