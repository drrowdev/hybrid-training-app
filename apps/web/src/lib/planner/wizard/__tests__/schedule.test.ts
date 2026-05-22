/**
 * Schedule placement + sequencing-warning tests.
 *
 * Cites DC-D4 (no back-to-back glycolytic/high-CNS) for the adjacency-spacer
 * tests — the placement pass + override-and-warn path is the engine-facing
 * implementation of that constraint at the wizard boundary.
 */
import { describe, it, expect } from "vitest";
import {
  defaultSchedule,
  pickDayIndices,
  sequencingWarnings,
  type ScheduleCell,
  type SessionShape,
  type WeightKey,
} from "../schedule";
import { resolveArchetype } from "../wizard-mapping";

const ctx = (goal: "strength" | "muscle" | "cardio" | "resilience" | null, secondary: "strength" | "muscle" | "cardio" | "skip" | "maintenance" | null) =>
  ({ goal, secondary, twoADay: false });

function makeSession(weightKey: WeightKey): SessionShape {
  return { icon: "🏋️", title: weightKey, meta: "", weightKey, durationMin: 45 };
}

function makeCells(payload: Record<number, WeightKey>): ScheduleCell[] {
  return Array.from({ length: 7 }, (_, day) => ({
    day,
    am: payload[day] ? makeSession(payload[day]!) : null,
    pm: null,
  }));
}

describe("pickDayIndices", () => {
  it("returns the documented presets for n=1..7", () => {
    expect(pickDayIndices(1)).toEqual([2]);
    expect(pickDayIndices(2)).toEqual([0, 3]);
    expect(pickDayIndices(3)).toEqual([0, 2, 4]);
    expect(pickDayIndices(4)).toEqual([0, 2, 4, 6]);
    expect(pickDayIndices(5)).toEqual([0, 1, 3, 5, 6]);
    expect(pickDayIndices(6)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(pickDayIndices(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("defaultSchedule — Strength Focus 4d", () => {
  it("places 4 strength sessions on Mon/Wed/Fri/Sun with zero high-CNS adjacencies (DC-D4)", () => {
    const a = resolveArchetype({ days: 4, goal: "strength", secondary: "skip", twoADay: false })!;
    const cells = defaultSchedule(a, ctx("strength", "skip"));
    const trainingDays = cells.filter((c) => c.am || c.pm).map((c) => c.day);
    expect(trainingDays).toEqual([0, 2, 4, 6]);
    expect(sequencingWarnings(cells)).toHaveLength(0);
  });
});

describe("defaultSchedule — Strength + Muscle 6d (swap pass)", () => {
  it("reproduces the swap-pass result: heavy on Mon/Wed/Fri/Sun, hyper on Tue/Sat, zero warnings (DC-D4)", () => {
    // 6 days = 4 strength + 2 hypertrophy (lift-led distribution).
    const a = resolveArchetype({ days: 6, goal: "strength", secondary: "muscle", twoADay: false })!;
    expect(a.sessions).toEqual({ strength: 4, hypertrophy: 2, cardio: 0, tendon: 0 });
    const cells = defaultSchedule(a, ctx("strength", "muscle"));
    const map = Object.fromEntries(
      cells
        .filter((c) => c.am)
        .map((c) => [c.day, c.am!.weightKey] as const),
    );
    // High-CNS on the "rest island" days (Mon Wed Fri Sun), hypertrophy fills Tue/Sat.
    expect(map[0]).toBe("Strength day (heavy)");
    expect(map[2]).toBe("Strength day (heavy)");
    expect(map[4]).toBe("Strength day (heavy)");
    expect(map[6]).toBe("Strength day (heavy)");
    expect(map[1]).toBe("Hypertrophy day");
    expect(map[5]).toBe("Hypertrophy day");
    expect(sequencingWarnings(cells)).toHaveLength(0);
  });
});

describe("sequencingWarnings — false positives blocked", () => {
  it("does NOT fire for hypertrophy + hypertrophy on adjacent days", () => {
    const cells = makeCells({ 0: "Hypertrophy day", 1: "Hypertrophy day" });
    expect(sequencingWarnings(cells)).toHaveLength(0);
  });

  it("does NOT fire for moderate strength + moderate strength on adjacent days", () => {
    const cells = makeCells({ 0: "Strength day (moderate)", 1: "Strength day (moderate)" });
    expect(sequencingWarnings(cells)).toHaveLength(0);
  });
});

describe("sequencingWarnings — true positives (DC-D4)", () => {
  it("fires for heavy + heavy on adjacent days", () => {
    const cells = makeCells({ 0: "Strength day (heavy)", 1: "Strength day (heavy)" });
    const warnings = sequencingWarnings(cells);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.days).toEqual([0, 1]);
    expect(warnings[0]!.text).toMatch(/high-cns/i);
  });

  it("fires for VO2 + heavy on adjacent days (DC-D4 high-glycolytic)", () => {
    const cells = makeCells({ 2: "VO2 intervals", 3: "Strength day (heavy)" });
    const warnings = sequencingWarnings(cells);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.days).toEqual([2, 3]);
  });

  it("fires for tendon + tendon on adjacent days", () => {
    const cells = makeCells({ 4: "Tendon day", 5: "Tendon day" });
    expect(sequencingWarnings(cells)).toHaveLength(1);
  });

  it("does NOT fire when there's a rest day between two high-CNS sessions", () => {
    const cells = makeCells({ 0: "Strength day (heavy)", 2: "Strength day (heavy)" });
    expect(sequencingWarnings(cells)).toHaveLength(0);
  });
});
