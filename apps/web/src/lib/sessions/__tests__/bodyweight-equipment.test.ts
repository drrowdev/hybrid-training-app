import { describe, it, expect } from "vitest";
import { isBodyweightCapableEquipment } from "../bodyweight-equipment";

describe("isBodyweightCapableEquipment", () => {
  it("treats a plain bodyweight movement as weight-optional", () => {
    expect(isBodyweightCapableEquipment("bodyweight")).toBe(true);
  });

  it("treats 'or-bodyweight' / 'or-loaded' options as weight-optional", () => {
    // The reported bug: Single-Leg Calf Raise is bodyweight-or-loaded.
    expect(isBodyweightCapableEquipment("bodyweight-or-loaded")).toBe(true);
    expect(isBodyweightCapableEquipment("bodyweight-or-band")).toBe(true);
    expect(isBodyweightCapableEquipment("barbell-or-bodyweight")).toBe(true);
    expect(isBodyweightCapableEquipment("bodyweight-wall")).toBe(true);
    expect(isBodyweightCapableEquipment("bodyweight-anchor")).toBe(true);
  });

  it("recognises the abbreviated 'bw' token", () => {
    expect(isBodyweightCapableEquipment("dumbbell-or-bw")).toBe(true);
    expect(isBodyweightCapableEquipment("machine-or-bw")).toBe(true);
  });

  it("still requires a weight for load-only equipment", () => {
    expect(isBodyweightCapableEquipment("barbell")).toBe(false);
    expect(isBodyweightCapableEquipment("dumbbells")).toBe(false);
    expect(isBodyweightCapableEquipment("machine")).toBe(false);
    expect(isBodyweightCapableEquipment("cable")).toBe(false);
    expect(isBodyweightCapableEquipment("trap-bar")).toBe(false);
  });

  it("handles null / empty defensively", () => {
    expect(isBodyweightCapableEquipment(null)).toBe(false);
    expect(isBodyweightCapableEquipment(undefined)).toBe(false);
    expect(isBodyweightCapableEquipment("")).toBe(false);
  });
});
