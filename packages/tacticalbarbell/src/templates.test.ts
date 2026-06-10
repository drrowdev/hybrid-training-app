/**
 * Tactical Barbell template-data integrity — guards the transcription from the
 * official template-collection spreadsheet against drift.
 */
import { describe, it, expect } from "vitest";
import { TB_TEMPLATES, getTbTemplate } from "./templates";

describe("TB templates — structural integrity", () => {
  it("ships the seven canonical templates", () => {
    expect(TB_TEMPLATES.map((t) => t.id).sort()).toEqual(
      ["fighter", "gladiator", "grey-man", "mass", "operator", "zulu", "zulu-ia"],
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

  it("Operator caps the cluster at 3 main lifts and runs 3×/week off one wave", () => {
    const op = getTbTemplate("operator")!;
    expect(op.maxMainLifts).toBe(3);
    expect(op.weeklySessions).toHaveLength(3);
    expect(op.waves).toHaveLength(1);
    expect(op.waves[0]!.percents).toEqual([0.7, 0.8, 0.9, 0.75, 0.85, 0.95]);
  });

  it("Zulu is an A/B split with a heavier second pass", () => {
    const z = getTbTemplate("zulu")!;
    expect(z.structure).toBe("split");
    expect(z.weeklySessions.map((s) => s.split)).toEqual(["A", "B", "A", "B"]);
    const one = z.waves.find((w) => w.id === "one")!;
    const two = z.waves.find((w) => w.id === "two")!;
    expect(one.percents).toEqual([0.7, 0.8, 0.9, 0.7, 0.8, 0.9]);
    expect(two.percents).toEqual([0.75, 0.8, 0.9, 0.75, 0.8, 0.9]);
    // Pass 2 opens heavier than Pass 1 in week 1, identical thereafter.
    expect(two.percents[0]).toBeGreaterThan(one.percents[0]!);
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
});
