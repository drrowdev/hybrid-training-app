/**
 * Tactical Barbell template-data integrity — guards the transcription from the
 * official template-collection spreadsheet against drift.
 */
import { describe, it, expect } from "vitest";
import { TB_TEMPLATES, getTbTemplate } from "./templates";

describe("TB templates — structural integrity", () => {
  it("ships the seven canonical templates plus TB3 Activation", () => {
    expect(TB_TEMPLATES.map((t) => t.id).sort()).toEqual(
      ["activation", "fighter", "gladiator", "grey-man", "mass", "operator", "zulu", "zulu-ia"],
    );
  });

  for (const t of TB_TEMPLATES) {
    describe(t.name, () => {
      it("sets×rep scheme spans exactly the block length", () => {
        expect(t.setsReps).toHaveLength(t.blockWeeks);
      });

      it("every percentage wave spans exactly the block length", () => {
        for (const wave of t.waves) expect(wave.percents).toHaveLength(t.blockWeeks);
      });

      it("every weekly session references a real wave", () => {
        const ids = new Set(t.waves.map((w) => w.id));
        for (const s of t.weeklySessions) expect(ids.has(s.waveId)).toBe(true);
      });

      it("all percentages are submaximal and sane (50–100%)", () => {
        for (const wave of t.waves) {
          for (const p of wave.percents) {
            expect(p).toBeGreaterThanOrEqual(0.5);
            expect(p).toBeLessThanOrEqual(1.0);
          }
        }
      });

      it("set counts are positive with min ≤ max", () => {
        for (const s of t.setsReps) {
          expect(s.setsMin).toBeGreaterThan(0);
          expect(s.setsMax).toBeGreaterThanOrEqual(s.setsMin);
        }
      });
    });
  }

  it("Operator TB3 uses the 75/80/85/75/80/peak wave and week-scoped peak days", () => {
    const op = getTbTemplate("operator")!;
    expect(op.maxMainLifts).toBe(3);
    expect(op.weeklySessions).toHaveLength(6);
    expect(op.waves).toHaveLength(1);
    expect(op.waves[0]!.percents).toEqual([0.75, 0.8, 0.85, 0.75, 0.8, 1]);
    expect(op.setsReps.map((w) => [w.setsMin, w.setsMax, w.repsLabel])).toEqual([
      [3, 5, "5"],
      [3, 5, "5"],
      [3, 5, "3"],
      [3, 5, "5"],
      [3, 5, "5"],
      [1, 1, "1"],
    ]);
    expect(op.weeklySessions.filter((s) => s.kind === "test").map((s) => s.label)).toEqual([
      "Peak · Squat",
      "Peak · Bench",
      "Peak · Deadlift",
    ]);
  });

  it("Fighter TB3 shares the core wave and peaks its lifts in week 6", () => {
    const f = getTbTemplate("fighter")!;
    expect(f.waves[0]!.percents).toEqual([0.75, 0.8, 0.85, 0.75, 0.8, 1]);
    expect(f.weeklySessions.filter((s) => s.kind === "test")).toHaveLength(2);
  });

  it("Zulu TB3 is an A/B split with light 70/75% passes and 100% peak sessions", () => {
    const z = getTbTemplate("zulu")!;
    expect(z.structure).toBe("split");
    expect(z.weeklySessions.filter((s) => s.kind !== "test").map((s) => s.split)).toEqual([
      "A",
      "B",
      "A",
      "B",
    ]);
    const one = z.waves.find((w) => w.id === "one")!;
    const two = z.waves.find((w) => w.id === "two")!;
    expect(one.percents).toEqual([0.7, 0.8, 0.85, 0.7, 0.8, 1]);
    expect(two.percents).toEqual([0.75, 0.8, 0.85, 0.75, 0.8, 1]);
    expect(two.percents[0]).toBeGreaterThan(one.percents[0]!);
    expect(z.setsReps[0]!.repsLabel).toBe("5–8");
    expect(z.weeklySessions.filter((s) => s.kind === "test")).toHaveLength(4);
  });

  it("Zulu I/A shares the split but autoregulates 3–5 sets and loads heavier in the back half", () => {
    const z = getTbTemplate("zulu-ia")!;
    expect(z.structure).toBe("split");
    expect(z.clusterMin).toBe(4);
    expect(z.clusterMax).toBe(8);
    // 3–5 set ranges every week.
    expect(z.setsReps.map((s) => [s.setsMin, s.setsMax])).toEqual([
      [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5],
    ]);
    // Reps peak harder than Standard (wk5 = 3, wk6 = 1–2).
    expect(z.setsReps.map((s) => s.repsLabel)).toEqual(["5", "5", "3", "5", "3", "1–2"]);
    // Both passes load identically; weeks 4–6 are heavier than Standard.
    const one = z.waves.find((w) => w.id === "one")!;
    const two = z.waves.find((w) => w.id === "two")!;
    expect(one.percents).toEqual([0.7, 0.8, 0.9, 0.75, 0.85, 0.95]);
    expect(two.percents).toEqual(one.percents);
  });

  it("Grey Man is a 12-week double-wave block", () => {
    const g = getTbTemplate("grey-man")!;
    expect(g.blockWeeks).toBe(12);
    expect(g.waves[0]!.percents).toEqual([
      0.7, 0.8, 0.9, 0.7, 0.8, 0.9, 0.75, 0.85, 0.95, 0.75, 0.85, 0.95,
    ]);
  });

  it("Activation carries the full 25-week phase map and fixed session loadouts", () => {
    const activation = getTbTemplate("activation")!;
    expect(activation.blockWeeks).toBe(25);
    expect(activation.weeklySessions).toHaveLength(17);
    expect(activation.weeklySessions.find((session) => session.id === "operator-d1")?.kindByWeek).toEqual({
      15: "deload",
    });
    expect(activation.segments?.map((segment) => [segment.startWeekIndex, segment.label])).toEqual([
      [0, "Base"],
      [4, "Rest and test"],
      [5, "Armor"],
      [8, "Operator Blue"],
      [13, "Peak"],
      [14, "Operator Black"],
      [19, "Peak"],
      [20, "Rest and test"],
      [21, "Vertex (Breacher)"],
      [24, "Final retest"],
    ]);
  });
});
