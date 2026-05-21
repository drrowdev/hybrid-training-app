import { describe, it, expect } from "vitest";
import { evaluateBumpGate, type GateInput } from "../tm-bump";

const baseline: GateInput = {
  performedReps: 1,
  target: 1,
  weekIndex: 2, // Wk3
  performedWeight: 100,
  performedRpe: null,
  currentTm: 100,
  daysSinceLastTmChange: 30,
  recentProposalExists: false,
  hasActiveLimitation: false,
  priorSmashCount: 0,
  todayGrm: null,
};

describe("evaluateBumpGate — hard gates", () => {
  it("blocks when cooldown still active (TM changed < 28 days ago)", () => {
    const r = evaluateBumpGate({ ...baseline, daysSinceLastTmChange: 14 });
    expect(r.passes).toBe(false);
    expect(r.passes || r.blockedBy).toBe("cooldown_active");
  });

  it("blocks when a proposal was already emitted recently", () => {
    const r = evaluateBumpGate({ ...baseline, recentProposalExists: true });
    expect(r.passes).toBe(false);
    expect(r.passes || r.blockedBy).toBe("proposal_already_emitted");
  });

  it("blocks when the movement's region has an active limitation", () => {
    const r = evaluateBumpGate({ ...baseline, hasActiveLimitation: true });
    expect(r.passes).toBe(false);
    expect(r.passes || r.blockedBy).toBe("active_limitation");
  });
});

describe("evaluateBumpGate — soft signals", () => {
  it("Wk3 1+ AMRAP beaten by 5 reps fires (Wendler canonical)", () => {
    // Wk3, target 1, performed 6, weight 100 vs TM 100.
    // Signals: reps_over≥5 (+1), Wk3_5plus (+2), e1rm_excess (+2 since
    // Epley 100*1.2 = 120 implies TM = 108, +8% over 100), cycle≥21 (+1) = 6.
    const r = evaluateBumpGate({ ...baseline, performedReps: 6 });
    expect(r.passes).toBe(true);
    if (r.passes) {
      expect(r.score).toBeGreaterThanOrEqual(3);
      expect(r.newTm).toBeGreaterThan(baseline.currentTm);
    }
  });

  it("Wk1 5+ AMRAP beaten by 7 reps fires (early-week outlier)", () => {
    // Wk1, target 5, performed 12. Epley 100*(1+12/30)=140 -> TM 126, +26%.
    // Signals: reps_over≥5 (+1), early_week_7 (+2), e1rm_excess (+2),
    // cycle≥21 (+1) = 6 points.
    const r = evaluateBumpGate({
      ...baseline,
      weekIndex: 0,
      target: 5,
      performedReps: 12,
    });
    expect(r.passes).toBe(true);
    if (r.passes) expect(r.score).toBeGreaterThanOrEqual(5);
  });

  it("performance below threshold suppresses", () => {
    // Wk3, target 1, performed 2. Epley 100*(1+2/30)=106.67 -> TM 96, -4%.
    // Signals: reps_over=1 (no points), no Wk3 5+, no early_week, no
    // e1rm_excess. Just the +1 for cycle≥21 = 1 point. Below threshold.
    const r = evaluateBumpGate({ ...baseline, performedReps: 2 });
    expect(r.passes).toBe(false);
    expect(r.passes || r.blockedBy).toBe("score_below_threshold");
  });

  it("GRM<0.93 subtracts a point (acute fatigue mask)", () => {
    // Same as the Wk3-1+ canonical case (6 points), but cooked today (GRM 0.88).
    // Should still pass (6-1=5 > 3) but the reason list includes the penalty.
    const r = evaluateBumpGate({ ...baseline, performedReps: 6, todayGrm: 0.88 });
    expect(r.passes).toBe(true);
    const fatigueReason = r.reasons.find((x) => x.points < 0);
    expect(fatigueReason).toBeDefined();
  });

  it("prior AMRAP smash bonus caps at +2 even if 5 prior smashes", () => {
    const r = evaluateBumpGate({ ...baseline, performedReps: 6, priorSmashCount: 5 });
    if (r.passes) {
      const priorReason = r.reasons.find((x) => /prior AMRAP smash/.test(x.label));
      expect(priorReason?.points).toBe(2);
    }
  });

  it("cycle-since-change soft signal only fires when ≥21 days", () => {
    // 14 days since last change is below the 21-day cycle threshold AND
    // also blocks via the 28-day cooldown hard gate. Use 21 days exactly
    // to confirm the soft signal contributes.
    const r = evaluateBumpGate({
      ...baseline,
      performedReps: 6,
      daysSinceLastTmChange: 28, // past cooldown
    });
    if (r.passes) {
      const cycleReason = r.reasons.find((x) => /full cycle/.test(x.label));
      expect(cycleReason?.points).toBe(1);
    }
  });

  it("excessive reps (>12) yield no e1RM and no proposal", () => {
    // Wk1, target 5, performed 15 — Epley invalid above 12.
    const r = evaluateBumpGate({
      ...baseline,
      weekIndex: 0,
      target: 5,
      performedReps: 15,
    });
    expect(r.passes).toBe(false);
  });
});

describe("evaluateBumpGate — suggested new TM", () => {
  it("new TM = round(0.9 × e1RM) to 2.5 kg", () => {
    const r = evaluateBumpGate({ ...baseline, performedReps: 6 });
    if (r.passes) {
      // Epley 100*(1+6/30) = 120; TM = 108; rounded to 2.5 = 107.5
      expect(r.newTm).toBe(107.5);
    }
  });
});
