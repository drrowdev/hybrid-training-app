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

  it("treats apparatus / bodyweight movements as weight-optional (the GHD bug)", () => {
    // The reported bug: GHD Sit-Up is `ghd-machine` — an apparatus, not added load.
    expect(isBodyweightCapableEquipment("ghd-machine")).toBe(true);
    // Other apparatus / bodyweight accessories that carry no inherent load.
    expect(isBodyweightCapableEquipment("bench")).toBe(true); // dragon flag
    expect(isBodyweightCapableEquipment("decline-bench")).toBe(true); // decline sit-up
    expect(isBodyweightCapableEquipment("ab-wheel")).toBe(true);
    expect(isBodyweightCapableEquipment("bar")).toBe(true); // hanging leg raise
    expect(isBodyweightCapableEquipment("dip-bars")).toBe(true);
    expect(isBodyweightCapableEquipment("rings")).toBe(true);
    expect(isBodyweightCapableEquipment("band")).toBe(true);
    expect(isBodyweightCapableEquipment("anchor")).toBe(true); // nordic
  });

  it("still requires a weight for loaded variants of bench / plate / preacher", () => {
    expect(isBodyweightCapableEquipment("decline-bench-plate")).toBe(false); // weighted decline sit-up
    expect(isBodyweightCapableEquipment("bench-dumbbells")).toBe(false);
    expect(isBodyweightCapableEquipment("ez-bar-bench")).toBe(false);
    expect(isBodyweightCapableEquipment("preacher-ez")).toBe(false);
    expect(isBodyweightCapableEquipment("cable-or-band")).toBe(false);
  });

  it("handles null / empty defensively", () => {
    expect(isBodyweightCapableEquipment(null)).toBe(false);
    expect(isBodyweightCapableEquipment(undefined)).toBe(false);
    expect(isBodyweightCapableEquipment("")).toBe(false);
  });
});
