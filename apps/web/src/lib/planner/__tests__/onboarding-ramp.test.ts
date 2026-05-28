import { describe, expect, it } from "vitest";
import type { DeclaredExperience } from "@hta/engine";
import {
  applyScalarToMaxItems,
  applyScalarToTargets,
  onboardingRampScalar,
} from "../onboarding-ramp";

describe("onboardingRampScalar", () => {
  it("returns 1.0 for null experience across all week indices", () => {
    for (const w of [0, 1, 2, 3, 10, 99]) {
      expect(onboardingRampScalar(null, w)).toBe(1.0);
    }
  });

  it("returns 1.0 for intermediate_2y_5y across all week indices", () => {
    const exp: DeclaredExperience = "intermediate_2y_5y";
    for (const w of [0, 1, 2, 3, 10]) {
      expect(onboardingRampScalar(exp, w)).toBe(1.0);
    }
  });

  it("returns 1.0 for advanced_5y_10y across all week indices", () => {
    const exp: DeclaredExperience = "advanced_5y_10y";
    for (const w of [0, 1, 2, 3, 10]) {
      expect(onboardingRampScalar(exp, w)).toBe(1.0);
    }
  });

  it("returns 1.0 for highly_advanced_10y_plus across all week indices", () => {
    const exp: DeclaredExperience = "highly_advanced_10y_plus";
    for (const w of [0, 1, 2, 3, 10]) {
      expect(onboardingRampScalar(exp, w)).toBe(1.0);
    }
  });

  describe("beginner_lt_6m schedule", () => {
    const exp: DeclaredExperience = "beginner_lt_6m";
    it("weekIndex 0 → 0.6", () => {
      expect(onboardingRampScalar(exp, 0)).toBe(0.6);
    });
    it("weekIndex 1 → 0.6", () => {
      expect(onboardingRampScalar(exp, 1)).toBe(0.6);
    });
    it("weekIndex 2 → 0.8", () => {
      expect(onboardingRampScalar(exp, 2)).toBe(0.8);
    });
    it("weekIndex 3 → 1.0", () => {
      expect(onboardingRampScalar(exp, 3)).toBe(1.0);
    });
    it("weekIndex 10 → 1.0", () => {
      expect(onboardingRampScalar(exp, 10)).toBe(1.0);
    });
  });

  describe("novice_6m_2y schedule", () => {
    const exp: DeclaredExperience = "novice_6m_2y";
    it("weekIndex 0 → 0.6", () => {
      expect(onboardingRampScalar(exp, 0)).toBe(0.6);
    });
    it("weekIndex 1 → 0.6", () => {
      expect(onboardingRampScalar(exp, 1)).toBe(0.6);
    });
    it("weekIndex 2 → 0.8", () => {
      expect(onboardingRampScalar(exp, 2)).toBe(0.8);
    });
    it("weekIndex 3 → 1.0", () => {
      expect(onboardingRampScalar(exp, 3)).toBe(1.0);
    });
    it("weekIndex 10 → 1.0", () => {
      expect(onboardingRampScalar(exp, 10)).toBe(1.0);
    });
  });
});

describe("applyScalarToTargets", () => {
  it("floors a single muscle target at scalar 0.6", () => {
    expect(applyScalarToTargets({ chest: 10 }, 0.6)).toEqual({ chest: 6 });
  });

  it("floors multiple muscle targets at scalar 0.8", () => {
    expect(applyScalarToTargets({ chest: 10, lats: 8 }, 0.8)).toEqual({
      chest: 8,
      lats: 6,
    });
  });

  it("clamps small targets up to floor of 1 (pinned)", () => {
    // 3 * 0.6 = 1.8 → floor 1 → clamps to PER_MUSCLE_TARGET_FLOOR = 1
    expect(applyScalarToTargets({ chest: 3 }, 0.6)).toEqual({ chest: 1 });
  });

  it("clamps a value that would floor to 0 up to 1", () => {
    // 1 * 0.6 = 0.6 → floor 0 → clamps to 1
    expect(applyScalarToTargets({ biceps: 1 }, 0.6)).toEqual({ biceps: 1 });
  });

  it("scalar 1.0 is the identity", () => {
    const input = { chest: 10, lats: 8, calves: 0 };
    expect(applyScalarToTargets(input, 1.0)).toEqual(input);
  });

  it("passes through non-positive values unchanged", () => {
    expect(applyScalarToTargets({ chest: 0 }, 0.6)).toEqual({ chest: 0 });
  });
});

describe("applyScalarToMaxItems", () => {
  it("floors with a floor-at-1 guarantee", () => {
    expect(applyScalarToMaxItems(8, 0.6)).toBe(4);
    expect(applyScalarToMaxItems(8, 0.8)).toBe(6);
    expect(applyScalarToMaxItems(2, 0.6)).toBe(1); // 2*0.6=1.2 → 1
    expect(applyScalarToMaxItems(1, 0.6)).toBe(1); // 1*0.6=0.6 → floor 0 → clamps to 1
  });

  it("scalar 1.0 is identity", () => {
    expect(applyScalarToMaxItems(8, 1.0)).toBe(8);
  });

  it("passes through non-positive maxItems", () => {
    expect(applyScalarToMaxItems(0, 0.6)).toBe(0);
  });
});
