/**
 * Maintenance-floor advisory math tests (ADR 0051 Phase 2). Pure, client-safe.
 */
import { describe, it, expect } from "vitest";
import {
  floorAdvisory,
  floorAdvisoryText,
  balanceSplit,
  MAINTENANCE_FREQUENCY_FLOOR,
  type FloorContext,
} from "../maintenance-floor";

const ctx: FloorContext = {
  cardioBaselineMinPerWk: 180,
  cardioSessionsPerWk: 4,
  strengthSessionsPerWk: 3,
  cardioScalarAtFloor: 0.97,
};

describe("floorAdvisory", () => {
  it("returns a cardio-held floor for a strength-bias block", () => {
    const adv = floorAdvisory("strength_bias", ctx)!;
    expect(adv.heldQuality).toBe("cardio");
    expect(adv.floorSessions).toBe(MAINTENANCE_FREQUENCY_FLOOR);
    expect(adv.floorMinPerWk).toBe(60); // round5(180 × 1/3)
    expect(adv.scalarAtFloor).toBe(0.97);
    expect(adv.severity).toBe("ok"); // 0.97 ≥ 0.9
  });

  it("flags 'watch' when interference at the floor is still material", () => {
    const adv = floorAdvisory("strength_bias", { ...ctx, cardioScalarAtFloor: 0.85 })!;
    expect(adv.severity).toBe("watch");
  });

  it("returns a strength-held (frequency-only) floor for an endurance-bias block", () => {
    const adv = floorAdvisory("endurance_bias", ctx)!;
    expect(adv.heldQuality).toBe("strength");
    expect(adv.floorMinPerWk).toBeNull();
    expect(adv.scalarAtFloor).toBeNull();
  });

  it("returns null for a non-bias emphasis or missing context", () => {
    expect(floorAdvisory("base", ctx)).toBeNull();
    expect(floorAdvisory("build", ctx)).toBeNull();
    expect(floorAdvisory("strength_bias", null)).toBeNull();
  });
});

describe("floorAdvisoryText", () => {
  it("describes the cardio floor with the interference percent", () => {
    const text = floorAdvisoryText(floorAdvisory("strength_bias", ctx)!);
    expect(text).toContain("Hold cardio");
    expect(text).toContain("60 min");
    expect(text).toContain("97%");
  });

  it("warns to trim cardio in the 'watch' case", () => {
    const text = floorAdvisoryText(
      floorAdvisory("strength_bias", { ...ctx, cardioScalarAtFloor: 0.8 })!,
    );
    expect(text.toLowerCase()).toContain("trimming cardio");
  });

  it("handles a user with little cardio gracefully", () => {
    const text = floorAdvisoryText(
      floorAdvisory("strength_bias", { ...ctx, cardioBaselineMinPerWk: 0 })!,
    );
    expect(text.toLowerCase()).toContain("little cardio");
  });

  it("describes the strength-frequency floor for endurance bias", () => {
    const text = floorAdvisoryText(floorAdvisory("endurance_bias", ctx)!);
    expect(text.toLowerCase()).toContain("strength sessions");
  });
});

describe("balanceSplit", () => {
  it("tilts strength-bias to a 60/40 strength split", () => {
    expect(balanceSplit("strength_bias")).toEqual({
      primaryLabel: "Strength",
      primaryPct: 60,
      secondaryLabel: "Endurance",
      secondaryPct: 40,
    });
  });

  it("tilts endurance-bias to a 60/40 endurance split", () => {
    const s = balanceSplit("endurance_bias")!;
    expect(s.primaryLabel).toBe("Endurance");
    expect(s.primaryPct).toBe(60);
  });

  it("returns null for non-bias emphases", () => {
    expect(balanceSplit("base")).toBeNull();
    expect(balanceSplit("recovery")).toBeNull();
  });
});
