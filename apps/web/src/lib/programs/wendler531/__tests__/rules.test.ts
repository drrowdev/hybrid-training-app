/**
 * 5/3/1 fundamental rules — canonical-fidelity pins.
 *
 * These tests assert the published methodology EXACTLY. They are intentionally
 * strict: if a number here changes, it means the program no longer matches
 * 5/3/1 / 5/3/1 Forever, which is a correctness bug for this app's whole premise.
 */
import { describe, it, expect } from "vitest";
import {
  MAIN_LIFTS,
  TM_PERCENT_OF_1RM,
  WEIGHT_INCREMENT_KG,
  roundToIncrement,
  trainingMaxFrom1RM,
  TM_INCREMENT_KG,
  nextTrainingMax,
  resetTrainingMax,
  CLASSIC_531_WEEKS,
  FIVES_PRO_WEEKS,
  mainWorkWeeks,
  materializeMainWork,
  SEVENTH_WEEK_SCHEMES,
  materializeSeventhWeek,
  evaluateTmTest,
  DEFAULT_LEADER_ANCHOR_SEQUENCE,
  MAX_CYCLES_PER_PHASE,
  expandProgramSequence,
} from "../rules";

describe("5/3/1 — Training Max", () => {
  it("TM is 85% (conservative) or 90% (standard) of 1RM", () => {
    expect(TM_PERCENT_OF_1RM.conservative).toBe(0.85);
    expect(TM_PERCENT_OF_1RM.standard).toBe(0.9);
  });

  it("trainingMaxFrom1RM defaults to 85% and rounds DOWN to 2.5 kg", () => {
    // 100 * 0.85 = 85 → 85 (already on increment)
    expect(trainingMaxFrom1RM(100)).toBe(85);
    // 102 * 0.85 = 86.7 → floor to 85
    expect(trainingMaxFrom1RM(102)).toBe(85);
    // standard 90%
    expect(trainingMaxFrom1RM(100, "standard")).toBe(90);
  });

  it("roundToIncrement snaps to 2.5 kg", () => {
    expect(WEIGHT_INCREMENT_KG).toBe(2.5);
    expect(roundToIncrement(86.3)).toBe(87.5);
    expect(roundToIncrement(86.1)).toBe(85);
  });

  it("TM increments: +5 kg squat/deadlift, +2.5 kg bench/press per cycle", () => {
    expect(TM_INCREMENT_KG.squat).toBe(5);
    expect(TM_INCREMENT_KG.deadlift).toBe(5);
    expect(TM_INCREMENT_KG.bench).toBe(2.5);
    expect(TM_INCREMENT_KG.press).toBe(2.5);
    expect(nextTrainingMax("squat", 140)).toBe(145);
    expect(nextTrainingMax("press", 60)).toBe(62.5);
  });

  it("reset drops the TM ~10%", () => {
    expect(resetTrainingMax(100)).toBe(90);
    expect(resetTrainingMax(140)).toBe(125); // 126 → 125
  });
});

describe("5/3/1 — classic main-work weeks", () => {
  it("matches 65/75/85+, 70/80/90+, 75/85/95+ with AMRAP on the top set", () => {
    expect(CLASSIC_531_WEEKS.map((w) => w.sets.map((s) => s.pctOfTm))).toEqual([
      [0.65, 0.75, 0.85],
      [0.7, 0.8, 0.9],
      [0.75, 0.85, 0.95],
    ]);
    expect(CLASSIC_531_WEEKS.map((w) => w.sets.map((s) => s.reps))).toEqual([
      [5, 5, 5],
      [3, 3, 3],
      [5, 3, 1],
    ]);
    // Only the LAST set of each week is the AMRAP/PR set.
    for (const w of CLASSIC_531_WEEKS) {
      expect(w.sets.map((s) => s.amrap)).toEqual([false, false, true]);
    }
  });
});

describe("5/3/1 — 5's PRO", () => {
  it("uses the classic percentages but straight 5s and NO AMRAP", () => {
    expect(FIVES_PRO_WEEKS.map((w) => w.sets.map((s) => s.pctOfTm))).toEqual(
      CLASSIC_531_WEEKS.map((w) => w.sets.map((s) => s.pctOfTm)),
    );
    for (const w of FIVES_PRO_WEEKS) {
      expect(w.sets.map((s) => s.reps)).toEqual([5, 5, 5]);
      expect(w.sets.every((s) => s.amrap === false)).toBe(true);
    }
  });

  it("mainWorkWeeks resolves the scheme", () => {
    expect(mainWorkWeeks("classic")).toBe(CLASSIC_531_WEEKS);
    expect(mainWorkWeeks("fives_pro")).toBe(FIVES_PRO_WEEKS);
  });
});

describe("5/3/1 — materialisation", () => {
  it("computes rounded working weights off the TM (week 1, TM 100)", () => {
    const sets = materializeMainWork(100, CLASSIC_531_WEEKS[0]!);
    expect(sets).toEqual([
      { pctOfTm: 0.65, weightKg: 65, reps: 5, amrap: false },
      { pctOfTm: 0.75, weightKg: 75, reps: 5, amrap: false },
      { pctOfTm: 0.85, weightKg: 85, reps: 5, amrap: true },
    ]);
  });

  it("rounds to 2.5 kg for a non-round TM (week 3, TM 142.5)", () => {
    const sets = materializeMainWork(142.5, CLASSIC_531_WEEKS[2]!);
    // 0.75*142.5=106.875→107.5 ; 0.85*142.5=121.125→120 ; 0.95*142.5=135.375→135
    expect(sets.map((s) => s.weightKg)).toEqual([107.5, 120, 135]);
    expect(sets.map((s) => s.reps)).toEqual([5, 3, 1]);
  });
});

describe("5/3/1 — 7th Week Protocol", () => {
  it("deload: 70x5, 80x3-5, 90x1, TM x1 (no AMRAP)", () => {
    const d = SEVENTH_WEEK_SCHEMES.deload;
    expect(d.map((s) => s.pctOfTm)).toEqual([0.7, 0.8, 0.9, 1.0]);
    expect(d.map((s) => s.reps)).toEqual([5, 3, 1, 1]);
    expect(d[1]!.repsMax).toBe(5); // 80% × 3–5
    expect(d.every((s) => s.amrap === false)).toBe(true);
    expect(d[3]!.isTmSet).toBe(true);
  });

  it("tm_test: 70x5, 80x5, 90x5, TM x3-5 (validation set)", () => {
    const t = SEVENTH_WEEK_SCHEMES.tm_test;
    expect(t.map((s) => s.pctOfTm)).toEqual([0.7, 0.8, 0.9, 1.0]);
    expect(t.map((s) => s.reps)).toEqual([5, 5, 5, 3]);
    expect(t[3]!.repsMax).toBe(5);
    expect(t[3]!.isTmSet).toBe(true);
  });

  it("pr_test: 70x5, 80x5, 90x5, TM x PR (AMRAP at TM)", () => {
    const p = SEVENTH_WEEK_SCHEMES.pr_test;
    expect(p.map((s) => s.pctOfTm)).toEqual([0.7, 0.8, 0.9, 1.0]);
    expect(p[3]!.amrap).toBe(true);
    expect(p[3]!.isTmSet).toBe(true);
  });

  it("materialises against the TM with the TM set flagged", () => {
    const sets = materializeSeventhWeek(100, "tm_test");
    expect(sets.map((s) => s.weightKg)).toEqual([70, 80, 90, 100]);
    expect(sets[3]!.isTmSet).toBe(true);
  });

  it("evaluateTmTest: <3 reps lower, 3-4 hold, >=5 raise", () => {
    expect(evaluateTmTest(2)).toBe("lower");
    expect(evaluateTmTest(3)).toBe("hold");
    expect(evaluateTmTest(4)).toBe("hold");
    expect(evaluateTmTest(5)).toBe("raise");
  });
});

describe("5/3/1 — Leader/Anchor structure", () => {
  it("a phase is capped at 2 cycles", () => {
    expect(MAX_CYCLES_PER_PHASE).toBe(2);
  });

  it("the default sequence is 2 Leaders (5's PRO) → deload → 1 Anchor (classic) → TM test", () => {
    expect(DEFAULT_LEADER_ANCHOR_SEQUENCE).toEqual([
      { kind: "leader", cycles: 2, mainWork: "fives_pro" },
      { kind: "seventh_week", mode: "deload" },
      { kind: "anchor", cycles: 1, mainWork: "classic" },
      { kind: "seventh_week", mode: "tm_test" },
    ]);
  });

  it("expands to 6 leader weeks + deload + 3 anchor weeks + TM test = 11 weeks", () => {
    const weeks = expandProgramSequence();
    expect(weeks).toHaveLength(11);
    // Leader: weeks 0-5, two cycles of 5's PRO
    expect(weeks.slice(0, 6).every((w) => w.type === "main" && w.phaseKind === "leader" && w.mainWork === "fives_pro")).toBe(true);
    // Deload at index 6
    expect(weeks[6]).toMatchObject({ type: "seventh_week", mode: "deload" });
    // Anchor: weeks 7-9, classic
    expect(weeks.slice(7, 10).every((w) => w.type === "main" && w.phaseKind === "anchor" && w.mainWork === "classic")).toBe(true);
    // TM test at index 10
    expect(weeks[10]).toMatchObject({ type: "seventh_week", mode: "tm_test" });
  });

  it("tracks cycle-in-phase across the two leader cycles", () => {
    const weeks = expandProgramSequence();
    const leaderMains = weeks.filter(
      (w): w is Extract<typeof w, { type: "main" }> => w.type === "main" && w.phaseKind === "leader",
    );
    expect(leaderMains.map((w) => w.cycleInPhase)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(leaderMains.map((w) => w.week.weekInCycle)).toEqual([1, 2, 3, 1, 2, 3]);
  });
});

describe("5/3/1 — lifts", () => {
  it("the four main lifts are press, bench, squat, deadlift", () => {
    expect([...MAIN_LIFTS].sort()).toEqual(["bench", "deadlift", "press", "squat"]);
  });
});
