/**
 * ADR 0032 (Phase 3) — pure fatigue-proxy + early-deload gate tests.
 */
import { describe, it, expect } from "vitest";
import {
  fatigueArchetypeKey,
  fatigueKeyFromMix,
  resolveFatigueKey,
  loadRampTerm,
  cardioInterferenceTerm,
  subjectiveTerm,
  computeFatigueProxy,
  shouldRecommendEarlyDeload,
  EARLY_DELOAD_THRESHOLD,
} from "../fatigue-proxy";

describe("fatigueArchetypeKey", () => {
  it("classifies archetypes by dominant load type", () => {
    expect(fatigueArchetypeKey("strength_anchor")).toBe("strength");
    expect(fatigueArchetypeKey("hypertrophy_anchor")).toBe("strength");
    expect(fatigueArchetypeKey("endurance_anchor")).toBe("endurance");
    expect(fatigueArchetypeKey("concurrent_hybrid")).toBe("balanced");
    expect(fatigueArchetypeKey("rebuild")).toBe("low");
    expect(fatigueArchetypeKey("maintenance")).toBe("low");
    expect(fatigueArchetypeKey("custom")).toBe("balanced");
  });
});

describe("fatigueKeyFromMix (ADR 0046 Phase 3 — data-driven character)", () => {
  it("mostly-strength mix → strength", () => {
    expect(fatigueKeyFromMix(4, 0)).toBe("strength");
    expect(fatigueKeyFromMix(4, 1)).toBe("strength"); // 0.2 cardio frac
  });
  it("cardio-heavy mix → endurance", () => {
    expect(fatigueKeyFromMix(2, 5)).toBe("endurance"); // 0.71
    expect(fatigueKeyFromMix(1, 4)).toBe("endurance"); // 0.8
  });
  it("even-ish mix → balanced", () => {
    expect(fatigueKeyFromMix(3, 3)).toBe("balanced"); // 0.5
    expect(fatigueKeyFromMix(4, 2)).toBe("balanced"); // 0.33
  });
  it("barely training → low", () => {
    expect(fatigueKeyFromMix(1, 0)).toBe("low");
    expect(fatigueKeyFromMix(0, 0)).toBe("low");
  });
});

describe("resolveFatigueKey", () => {
  it("keeps the archetype-tuned key for native/Hybrid blocks (byte-identical)", () => {
    expect(resolveFatigueKey("strength_anchor", { strengthDays: 1, cardioDays: 9 })).toBe("strength");
    expect(resolveFatigueKey("endurance_anchor")).toBe("endurance");
  });
  it("derives from the mix for foreign programs (unknown archetype)", () => {
    expect(resolveFatigueKey("", { strengthDays: 4, cardioDays: 0 })).toBe("strength");
    expect(resolveFatigueKey("wendler-531", { strengthDays: 3, cardioDays: 5 })).toBe("endurance");
  });
  it("falls back to the archetype map when no mix is given", () => {
    expect(resolveFatigueKey("")).toBe("balanced"); // unknown → balanced
  });
});

describe("normalised terms", () => {
  it("loadRampTerm: 0 at flat, 1 at a 50%+ acute spike, 0 without a baseline", () => {
    expect(loadRampTerm(1000, 1000)).toBe(0);
    expect(loadRampTerm(1250, 1000)).toBeCloseTo(0.5, 5);
    expect(loadRampTerm(1500, 1000)).toBe(1);
    expect(loadRampTerm(3000, 1000)).toBe(1); // clamped
    expect(loadRampTerm(900, 1000)).toBe(0); // deramp → 0
    expect(loadRampTerm(1000, 0)).toBe(0); // no chronic baseline
  });

  it("cardioInterferenceTerm: 0 at no cardio, 1 at the scalar floor", () => {
    expect(cardioInterferenceTerm(1.0)).toBe(0);
    expect(cardioInterferenceTerm(0.8)).toBeCloseTo(0.5, 5);
    expect(cardioInterferenceTerm(0.6)).toBe(1);
  });

  it("subjectiveTerm: takes the worse of check-in and sRPE", () => {
    expect(subjectiveTerm({ avgFatigue: 1, avgSoreness: 1, maxSrpe: 0 })).toBe(0);
    expect(subjectiveTerm({ avgFatigue: 4, avgSoreness: 4, maxSrpe: null })).toBe(1);
    expect(subjectiveTerm({ avgFatigue: 3, avgSoreness: 3, maxSrpe: null })).toBeCloseTo(0.5, 5);
    // sRPE dominates when the check-in is mild.
    expect(subjectiveTerm({ avgFatigue: 1, avgSoreness: 1, maxSrpe: 9 })).toBe(1);
    expect(subjectiveTerm({ avgFatigue: null, avgSoreness: null, maxSrpe: null })).toBe(0);
  });
});

describe("computeFatigueProxy", () => {
  it("weights cardio heaviest for endurance, lightest for strength", () => {
    const cardioHeavy = {
      acuteTonnage: 1000,
      chronicTonnage: 1000, // load term 0
      concurrentScalar: 0.6, // cardio term 1
      avgFatigue: 1,
      avgSoreness: 1,
      maxSrpe: 0, // subj 0
    };
    const endurance = computeFatigueProxy({ archetype: "endurance_anchor", ...cardioHeavy });
    const strength = computeFatigueProxy({ archetype: "strength_anchor", ...cardioHeavy });
    // Only the cardio term is non-zero → proxy == cardio weight.
    expect(endurance.proxy).toBeCloseTo(0.5, 5);
    expect(strength.proxy).toBeCloseTo(0.1, 5);
    expect(endurance.proxy).toBeGreaterThan(strength.proxy);
  });

  it("weights tonnage-ramp heaviest for strength", () => {
    const rampHeavy = {
      acuteTonnage: 1500,
      chronicTonnage: 1000, // load term 1
      concurrentScalar: 1.0, // cardio 0
      avgFatigue: 1,
      avgSoreness: 1,
      maxSrpe: 0, // subj 0
    };
    const strength = computeFatigueProxy({ archetype: "strength_anchor", ...rampHeavy });
    const endurance = computeFatigueProxy({ archetype: "endurance_anchor", ...rampHeavy });
    expect(strength.proxy).toBeCloseTo(0.5, 5);
    expect(endurance.proxy).toBeCloseTo(0.2, 5);
  });

  it("a fully-fresh week yields a near-zero proxy", () => {
    const fresh = computeFatigueProxy({
      archetype: "concurrent_hybrid",
      acuteTonnage: 900,
      chronicTonnage: 1000,
      concurrentScalar: 1.0,
      avgFatigue: 1,
      avgSoreness: 1,
      maxSrpe: 5,
    });
    expect(fresh.proxy).toBe(0);
  });

  it("a cooked hybrid week crosses the threshold", () => {
    const cooked = computeFatigueProxy({
      archetype: "concurrent_hybrid",
      acuteTonnage: 1500, // ramp 1
      chronicTonnage: 1000,
      concurrentScalar: 0.6, // cardio 1
      avgFatigue: 4,
      avgSoreness: 4,
      maxSrpe: 9, // subj 1
    });
    expect(cooked.proxy).toBe(1);
    expect(cooked.proxy).toBeGreaterThanOrEqual(EARLY_DELOAD_THRESHOLD);
  });
});

describe("shouldRecommendEarlyDeload", () => {
  const base = {
    proxy: 0.8,
    dataSufficient: true,
    loadingWeeksLeft: 4,
    recentDeloadAlready: false,
  };

  it("recommends when fatigued with loading left and enough data", () => {
    expect(shouldRecommendEarlyDeload(base)).toBe(true);
  });

  it("does not recommend below the threshold", () => {
    expect(shouldRecommendEarlyDeload({ ...base, proxy: 0.5 })).toBe(false);
  });

  it("does not recommend without enough data (fixed fallback = scheduled deload)", () => {
    expect(shouldRecommendEarlyDeload({ ...base, dataSufficient: false })).toBe(false);
  });

  it("does not recommend within ~1 week of the scheduled deload", () => {
    expect(shouldRecommendEarlyDeload({ ...base, loadingWeeksLeft: 1 })).toBe(false);
  });

  it("does not recommend when a deload already fired this block", () => {
    expect(shouldRecommendEarlyDeload({ ...base, recentDeloadAlready: true })).toBe(false);
  });
});
