import { describe, it, expect } from "vitest";
import {
  displayWeight,
  weightUnitLabel,
  roundDisplayWeight,
  toKg,
  epleyOneRm,
} from "../units";

describe("weight unit helpers", () => {
  it("displayWeight converts kg → lb only for imperial", () => {
    expect(displayWeight(100, "metric")).toBe(100);
    expect(displayWeight(100, "imperial")).toBeCloseTo(220.462, 2);
  });

  it("weightUnitLabel maps to kg / lb", () => {
    expect(weightUnitLabel("metric")).toBe("kg");
    expect(weightUnitLabel("imperial")).toBe("lb");
  });

  it("roundDisplayWeight snaps to 0.5 kg / whole lb", () => {
    expect(roundDisplayWeight(125.3, "metric")).toBe(125.5);
    expect(roundDisplayWeight(125.1, "metric")).toBe(125);
    expect(roundDisplayWeight(262.5, "imperial")).toBe(263);
    expect(roundDisplayWeight(262.4, "imperial")).toBe(262);
  });

  it("toKg converts display value back to a clean 0.5-kg value", () => {
    // metric passes through (already kg), snapped to 0.5
    expect(toKg(125, "metric")).toBe(125);
    expect(toKg(125.3, "metric")).toBe(125.5);
    // 276 lb ≈ 125.19 kg → 125.0
    expect(toKg(276, "imperial")).toBe(125);
    // 225 lb ≈ 102.06 kg → 102.0
    expect(toKg(225, "imperial")).toBe(102);
  });

  it("kg → display → kg round-trips without drift for plate-clean values", () => {
    // 125 kg shows as 276 lb (rounded); entering 276 lb stores 125 kg again.
    const lb = roundDisplayWeight(displayWeight(125, "imperial"), "imperial");
    expect(lb).toBe(276);
    expect(toKg(lb, "imperial")).toBe(125);
  });

  it("epleyOneRm applies weight × (1 + reps/30) and guards bad input", () => {
    expect(epleyOneRm(100, 5)).toBeCloseTo(116.667, 2);
    expect(epleyOneRm(225, 5)).toBeCloseTo(262.5, 2);
    expect(epleyOneRm(0, 5)).toBe(0);
    expect(epleyOneRm(100, 0)).toBe(0);
    expect(epleyOneRm(Number.NaN, 5)).toBe(0);
  });
});
