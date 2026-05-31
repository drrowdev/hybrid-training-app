import { describe, it, expect } from "vitest";
import {
  aggregateWeeklyRhythm,
  type RawCompletedSession,
  type RawPlannedSession,
} from "../weekly-rhythm";

// Use a fixed Monday so the test is deterministic across timezones.
const TODAY = "2026-04-22"; // Wednesday
const CURRENT_MONDAY = "2026-04-20";

function s(performedYmd: string, modality: "strength" | "cardio" | "both" | "none"): RawCompletedSession {
  return {
    performedYmd,
    isStrength: modality === "strength" || modality === "both",
    isCardio: modality === "cardio" || modality === "both",
  };
}

describe("aggregateWeeklyRhythm — pure bucketing", () => {
  it("returns the requested number of weeks oldest-first, all zeros when empty", () => {
    const r = aggregateWeeklyRhythm(TODAY, 4, [], []);
    expect(r.weeks).toHaveLength(4);
    expect(r.weeks[0]!.weekStart < r.weeks[3]!.weekStart).toBe(true);
    expect(r.weeks.at(-1)!.weekStart).toBe(CURRENT_MONDAY);
    for (const w of r.weeks) {
      expect(w.strengthCount).toBe(0);
      expect(w.cardioCount).toBe(0);
      expect(w.plannedCount).toBe(0);
    }
  });

  it("strength + cardio sessions are bucketed into the right Monday", () => {
    const r = aggregateWeeklyRhythm(
      TODAY,
      4,
      [
        s("2026-04-20", "strength"), // current week
        s("2026-04-21", "cardio"),   // current week
        s("2026-04-15", "strength"), // 1 week ago
      ],
      [],
    );
    const cur = r.weeks.at(-1)!;
    expect(cur.weekStart).toBe(CURRENT_MONDAY);
    expect(cur.strengthCount).toBe(1);
    expect(cur.cardioCount).toBe(1);

    const prev = r.weeks.at(-2)!;
    expect(prev.weekStart).toBe("2026-04-13");
    expect(prev.strengthCount).toBe(1);
    expect(prev.cardioCount).toBe(0);
  });

  it("'both' (mixed-modality) session contributes to BOTH counts in the same week", () => {
    const r = aggregateWeeklyRhythm(
      TODAY,
      2,
      [s("2026-04-20", "both")],
      [],
    );
    const cur = r.weeks.at(-1)!;
    expect(cur.strengthCount).toBe(1);
    expect(cur.cardioCount).toBe(1);
  });

  it("legacy session with no modality tag is treated as strength so the cell still represents 'you trained'", () => {
    const r = aggregateWeeklyRhythm(TODAY, 2, [s("2026-04-20", "none")], []);
    const cur = r.weeks.at(-1)!;
    expect(cur.strengthCount).toBe(1);
    expect(cur.cardioCount).toBe(0);
  });

  it("planned sessions count separately and are bucketed by their date", () => {
    const planned: RawPlannedSession[] = [
      { date: "2026-04-20" },
      { date: "2026-04-22" },
      { date: "2026-04-26" }, // Sunday of current week
      { date: "2026-04-14" }, // previous week
    ];
    const r = aggregateWeeklyRhythm(TODAY, 4, [], planned);
    const cur = r.weeks.at(-1)!;
    expect(cur.plannedCount).toBe(3);
    const prev = r.weeks.at(-2)!;
    expect(prev.plannedCount).toBe(1);
  });

  it("sessions and planned outside the window are dropped (no bleed)", () => {
    const r = aggregateWeeklyRhythm(
      TODAY,
      2,
      [
        s("2026-04-20", "strength"),
        s("2025-12-01", "strength"), // way outside the 2-week window
      ],
      [{ date: "2025-12-01" }],
    );
    const total = r.weeks.reduce((a, w) => a + w.strengthCount + w.cardioCount, 0);
    const plannedTotal = r.weeks.reduce((a, w) => a + w.plannedCount, 0);
    expect(total).toBe(1);
    expect(plannedTotal).toBe(0);
  });

  it("future planned (later in current ISO week) still counts because Sunday is the latest cell", () => {
    // Wednesday today, Friday planned → same ISO week.
    const r = aggregateWeeklyRhythm(TODAY, 1, [], [{ date: "2026-04-24" }]);
    expect(r.weeks).toHaveLength(1);
    expect(r.weeks[0]!.plannedCount).toBe(1);
  });

  it("weeks parameter is floored and clamped to >= 1", () => {
    const r = aggregateWeeklyRhythm(TODAY, 0, [], []);
    expect(r.weeks).toHaveLength(1);
  });
});
