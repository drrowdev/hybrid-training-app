import { describe, it, expect } from "vitest";
import {
  accessoryRationale,
  humanizeMuscle,
} from "../accessory-rationale";
import { BULLETPROOF_ROLES, FUNCTIONAL_ROLES } from "../accessory-roles";

describe("accessoryRationale", () => {
  it("returns a non-empty plain-English sentence for every durability role", () => {
    for (const role of BULLETPROOF_ROLES) {
      const s = accessoryRationale({ reason: "durability", bulletproofRole: role });
      expect(s.length).toBeGreaterThan(10);
      // No internal bucket jargon leaks to the user.
      expect(s.toLowerCase()).not.toContain("bulletproof");
      expect(s.toLowerCase()).not.toContain("dc-o4");
      expect(s).not.toContain("_");
    }
  });

  it("returns a non-empty sentence for every functional role", () => {
    for (const role of FUNCTIONAL_ROLES) {
      const s = accessoryRationale({ reason: "functional", functionalRole: role });
      expect(s.length).toBeGreaterThan(10);
      expect(s).not.toContain("_");
    }
  });

  it("names the targeted muscle in aesthetic reasons", () => {
    const s = accessoryRationale({ reason: "aesthetic", gapMuscle: "side_delts" });
    expect(s).toContain("side delts");
    expect(s).not.toContain("_");
  });

  it("falls back gracefully when the specific trigger is missing", () => {
    expect(accessoryRationale({ reason: "durability" }).length).toBeGreaterThan(10);
    expect(accessoryRationale({ reason: "functional" }).length).toBeGreaterThan(10);
    expect(accessoryRationale({ reason: "aesthetic" }).length).toBeGreaterThan(10);
  });

  it("has a power reason", () => {
    expect(accessoryRationale({ reason: "power" })).toMatch(/power/i);
  });

  it("humanizeMuscle strips underscores", () => {
    expect(humanizeMuscle("rear_delts")).toBe("rear delts");
    expect(humanizeMuscle("biceps")).toBe("biceps");
  });
});
