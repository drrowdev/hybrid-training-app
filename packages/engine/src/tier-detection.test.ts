/**
 * Tier-detection pure-helper tests.
 *
 * Pins DC-G1 (behavioural, not declared), DC-G3 (consumer / intermediate
 * / high_performance enum), DC-G5 (cold-start = consumer when no signal),
 * and DC-K4 (declared-vs-inferred surfaces as a soft warn).
 */
import { describe, it, expect } from "vitest";
import {
  classifyAbsoluteThreshold,
  classifyBodyweightRatio,
  computeTier,
  DECLARED_TO_TIER,
  type TierInputs,
} from "./tier-detection";

const NO_BEHAVIOR_SIGNAL: {
  anchorAdherenceLast12w: number | null;
  scheduleRegularity: number | null;
  recoveryInputConsistency: number | null;
} = {
  anchorAdherenceLast12w: null,
  scheduleRegularity: null,
  recoveryInputConsistency: null,
};

describe("classifyBodyweightRatio — boundary cases", () => {
  it("80kg bench at 80kg BW = 1.0× → high_performance gate (≥1.0)", () => {
    expect(classifyBodyweightRatio("horizontal_press", 80, 80)).toBe(
      "high_performance",
    );
  });
  it("just below high-perf gate → intermediate", () => {
    // squat 1.5× BW is the high-perf gate; 1.49 falls into intermediate
    expect(classifyBodyweightRatio("squat", 1.49 * 80, 80)).toBe("intermediate");
  });
  it("just below intermediate gate → consumer", () => {
    // bench 0.75× BW gate; 0.74 lands consumer
    expect(classifyBodyweightRatio("horizontal_press", 0.74 * 80, 80)).toBe(
      "consumer",
    );
  });
  it("non-positive bodyweight returns null", () => {
    expect(classifyBodyweightRatio("squat", 100, 0)).toBeNull();
    expect(classifyBodyweightRatio("squat", 100, -1)).toBeNull();
  });
  it("non-positive e1RM returns null", () => {
    expect(classifyBodyweightRatio("squat", 0, 80)).toBeNull();
  });
});

describe("classifyAbsoluteThreshold — boundary cases", () => {
  it("deadlift gates 160 / 200 kg", () => {
    expect(classifyAbsoluteThreshold("deadlift", 159)).toBe("consumer");
    expect(classifyAbsoluteThreshold("deadlift", 160)).toBe("intermediate");
    expect(classifyAbsoluteThreshold("deadlift", 199)).toBe("intermediate");
    expect(classifyAbsoluteThreshold("deadlift", 200)).toBe("high_performance");
  });
});

describe("computeTier — DC-G1..G6 + DC-K4", () => {
  it("cold start (everything null) → consumer + low confidence (DC-G5)", () => {
    const out = computeTier({
      declaredExperience: null,
      bodyweightKg: null,
      e1rmKgByRole: {},
      ...NO_BEHAVIOR_SIGNAL,
    });
    expect(out.tier).toBe("consumer");
    expect(out.inferred).toBe("consumer");
    expect(out.confidence).toBe("low");
    expect(out.mismatch).toBe(false);
    expect(out.contributors).toHaveLength(0);
  });

  it("declared 1_3y with no observed data → intermediate (declared wins)", () => {
    const out = computeTier({
      declaredExperience: "1_3y",
      bodyweightKg: null,
      e1rmKgByRole: {},
      ...NO_BEHAVIOR_SIGNAL,
    });
    expect(out.declared).toBe("intermediate");
    expect(out.tier).toBe("intermediate");
    // Inferred falls back to declared when no signal, so no mismatch.
    expect(out.mismatch).toBe(false);
    expect(out.confidence).toBe("low");
  });

  it("perfect consumer-level numbers → consumer + moderate/high confidence", () => {
    const out = computeTier({
      declaredExperience: "lt_1y",
      bodyweightKg: 80,
      e1rmKgByRole: {
        squat: 60,
        horizontal_press: 40,
        deadlift: 80,
        vertical_press: 25,
      },
      anchorAdherenceLast12w: 0.5,
      scheduleRegularity: 0.3,
      recoveryInputConsistency: 0.2,
    });
    expect(out.inferred).toBe("consumer");
    expect(out.tier).toBe("consumer");
    expect(out.contributors.length).toBeGreaterThanOrEqual(6);
    expect(out.mismatch).toBe(false);
  });

  it("perfect intermediate profile → intermediate", () => {
    const out = computeTier({
      declaredExperience: "1_3y",
      bodyweightKg: 80,
      e1rmKgByRole: {
        // exactly on the intermediate gates
        squat: 1.0 * 80,
        horizontal_press: 0.75 * 80,
        deadlift: 1.5 * 80,
        vertical_press: 0.5 * 80,
      },
      anchorAdherenceLast12w: 0.85,
      scheduleRegularity: 0.7,
      recoveryInputConsistency: 0.5,
    });
    expect(out.inferred).toBe("intermediate");
    expect(out.tier).toBe("intermediate");
    expect(out.mismatch).toBe(false);
  });

  it("perfect advanced (high_performance) profile → high_performance + high confidence", () => {
    const out = computeTier({
      declaredExperience: "gte_3y",
      bodyweightKg: 80,
      e1rmKgByRole: {
        squat: 1.5 * 80,
        horizontal_press: 1.0 * 80,
        deadlift: 2.0 * 80,
        vertical_press: 0.75 * 80,
      },
      anchorAdherenceLast12w: 0.95,
      scheduleRegularity: 0.9,
      recoveryInputConsistency: 0.8,
    });
    expect(out.inferred).toBe("high_performance");
    expect(out.tier).toBe("high_performance");
    expect(out.confidence).toBe("high");
    expect(out.sessionsUntilNextTier).toBeNull();
  });

  it("declared advanced but observed beginner → declared wins, mismatch flagged (DC-K4)", () => {
    const out = computeTier({
      declaredExperience: "gte_3y",
      bodyweightKg: 80,
      e1rmKgByRole: {
        squat: 50,
        horizontal_press: 30,
        deadlift: 70,
        vertical_press: 20,
      },
      anchorAdherenceLast12w: 0.2,
      scheduleRegularity: 0.1,
      recoveryInputConsistency: 0.0,
    });
    expect(out.declared).toBe("high_performance");
    expect(out.inferred).toBe("consumer");
    expect(out.tier).toBe("high_performance"); // declared wins
    expect(out.mismatch).toBe(true);
  });

  it("mixed signals (intermediate strength + advanced behaviour) picks highest weighted sum", () => {
    const out = computeTier({
      declaredExperience: null,
      bodyweightKg: 80,
      e1rmKgByRole: {
        squat: 1.0 * 80, // intermediate gate
        horizontal_press: 0.75 * 80,
        deadlift: 1.5 * 80,
        vertical_press: 0.5 * 80,
      },
      anchorAdherenceLast12w: 0.95,
      scheduleRegularity: 0.9,
      recoveryInputConsistency: 0.8,
    });
    // 4 strength × 0.2 = 0.8 toward intermediate; 0.1+0.05+0.05=0.2 toward high_performance.
    // Intermediate wins.
    expect(out.inferred).toBe("intermediate");
  });

  it("only one lift + no bodyweight → falls back to absolute threshold", () => {
    const out = computeTier({
      declaredExperience: null,
      bodyweightKg: null,
      e1rmKgByRole: { deadlift: 180 },
      ...NO_BEHAVIOR_SIGNAL,
    });
    expect(out.inferred).toBe("intermediate");
    expect(out.contributors).toHaveLength(1);
    expect(out.contributors[0]?.weight).toBe(0.1); // absolute path = lower weight
  });

  it("bodyweight but no lifts → no strength contributors, behaviour drives", () => {
    const out = computeTier({
      declaredExperience: null,
      bodyweightKg: 80,
      e1rmKgByRole: {},
      anchorAdherenceLast12w: 0.95,
      scheduleRegularity: 0.9,
      recoveryInputConsistency: 0.8,
    });
    // Three behaviour contributors all pointing high_performance.
    expect(out.inferred).toBe("high_performance");
    expect(out.contributors).toHaveLength(3);
    expect(out.confidence).toBe("low"); // top score is 0.2, < 0.4 + < 4 contributors
  });

  it("sessionsUntilNextTier estimates closest gate gap", () => {
    const out = computeTier({
      declaredExperience: null,
      bodyweightKg: 80,
      e1rmKgByRole: {
        // bench 0.7× BW = 56 kg, intermediate gate is 60 kg → 4 kg gap.
        // per-session delta = 2.5 → 2 sessions.
        horizontal_press: 56,
      },
      ...NO_BEHAVIOR_SIGNAL,
    });
    expect(out.inferred).toBe("consumer");
    expect(out.sessionsUntilNextTier).toBe(2);
    expect(out.nextTierGateNote).toMatch(/bench/i);
  });

  it("DECLARED_TO_TIER mapping matches DB enum (lt_1y / 1_3y / gte_3y)", () => {
    expect(DECLARED_TO_TIER.lt_1y).toBe("consumer");
    expect(DECLARED_TO_TIER["1_3y"]).toBe("intermediate");
    expect(DECLARED_TO_TIER.gte_3y).toBe("high_performance");
  });
});
