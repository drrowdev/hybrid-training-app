import { describe, it, expect } from "vitest";
import { evaluateTmSuggestion, SUGGESTION_DELTA_KG, AMRAP_CONFIDENCE_REP_CAP } from "../suggestions";

describe("evaluateTmSuggestion (≥2.5 kg gate, conservative)", () => {
  it("suggests when conservative e1RM beats current TM by ≥ 2.5 kg", () => {
    // 100 kg × 5 → brzycki gives 112.5 → rounds to 112.5 → +12.5 over 100.
    const r = evaluateTmSuggestion({
      currentTmKg: 100,
      amrapWeightKg: 100,
      amrapReps: 5,
    });
    expect(r.suggest).toBe(true);
    if (r.suggest) {
      expect(r.suggestedTmKg).toBe(112.5);
      expect(r.formula).toBe("brzycki");
    }
  });

  it("rejects sub-threshold bumps", () => {
    // 100 kg × 1 → brzycki = 100; epley = 103.33 → conservative is 100; delta = 0.
    const r = evaluateTmSuggestion({
      currentTmKg: 100,
      amrapWeightKg: 100,
      amrapReps: 1,
    });
    expect(r.suggest).toBe(false);
  });

  it("uses Zourdos when RPE is provided and it's the smallest", () => {
    // 100 kg × 5 @ RPE 10 → 100/0.892 = 112.1 < brzycki 112.5 → wins.
    const r = evaluateTmSuggestion({
      currentTmKg: 90,
      amrapWeightKg: 100,
      amrapReps: 5,
      amrapRpe: 10,
    });
    expect(r.suggest).toBe(true);
    if (r.suggest) {
      expect(r.formula).toBe("rpe_zourdos");
      // 112.1 rounds to 112.5 with plate rounding.
      expect(r.suggestedTmKg).toBe(112.5);
    }
  });

  it("threshold constant is the 2.5 kg plate increment", () => {
    expect(SUGGESTION_DELTA_KG).toBe(2.5);
  });

  it("returns invalid-input on garbage", () => {
    expect(
      evaluateTmSuggestion({ currentTmKg: -1, amrapWeightKg: 100, amrapReps: 5 }),
    ).toEqual({ suggest: false, reason: "invalid-input" });
    expect(
      evaluateTmSuggestion({ currentTmKg: 100, amrapWeightKg: 0, amrapReps: 5 }),
    ).toEqual({ suggest: false, reason: "invalid-input" });
    expect(
      evaluateTmSuggestion({ currentTmKg: 100, amrapWeightKg: 100, amrapReps: 0 }),
    ).toEqual({ suggest: false, reason: "invalid-input" });
    expect(
      evaluateTmSuggestion({ currentTmKg: 100, amrapWeightKg: 100, amrapReps: 2.5 }),
    ).toEqual({ suggest: false, reason: "invalid-input" });
  });

  it("rejects exactly-at-threshold bumps smaller than 2.5 kg after rounding", () => {
    // Construct a case where conservative e1RM rounded ≈ current + 1 kg.
    // Brzycki 95 kg × 2 = 95 * 36/35 ≈ 97.71 → rounds to 97.5 → +2.5 = boundary.
    // The gate uses ">=" 2.5 so this should *just* pass.
    const r = evaluateTmSuggestion({
      currentTmKg: 95,
      amrapWeightKg: 95,
      amrapReps: 2,
    });
    expect(r.suggest).toBe(true);
  });
});

describe("evaluateTmSuggestion — high-rep confidence gate", () => {
  it("cap is 5 reps (high-confidence 1RM-estimate window)", () => {
    expect(AMRAP_CONFIDENCE_REP_CAP).toBe(5);
  });

  it("suppresses the reported 60 kg × 8 banner case as low-confidence", () => {
    // The exact banner: current TM 67.5, AMRAP 60 kg × 8. e1RM would clear the
    // 2.5 kg delta, but 8 reps is past the confidence cap → no suggestion.
    const r = evaluateTmSuggestion({
      currentTmKg: 67.5,
      amrapWeightKg: 60,
      amrapReps: 8,
    });
    expect(r).toEqual({ suggest: false, reason: "low-confidence" });
  });

  it("suppresses just past the cap (6 reps)", () => {
    const r = evaluateTmSuggestion({
      currentTmKg: 100,
      amrapWeightKg: 100,
      amrapReps: 6,
    });
    expect(r).toEqual({ suggest: false, reason: "low-confidence" });
  });

  it("still fires at exactly the cap (5 reps) when the bump clears the delta", () => {
    const r = evaluateTmSuggestion({
      currentTmKg: 100,
      amrapWeightKg: 100,
      amrapReps: 5,
    });
    expect(r.suggest).toBe(true);
  });

  it("a high-rep set is suppressed even with an RPE (8 reps can't be high-confidence)", () => {
    const r = evaluateTmSuggestion({
      currentTmKg: 67.5,
      amrapWeightKg: 60,
      amrapReps: 8,
      amrapRpe: 9,
    });
    expect(r).toEqual({ suggest: false, reason: "low-confidence" });
  });
});
