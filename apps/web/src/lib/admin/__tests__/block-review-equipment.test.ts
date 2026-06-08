/**
 * Unit coverage for `summariseEquipment` — the equipment line surfaced to the
 * external AI reviewer. Regression guard for the recurring false-positive where
 * the reviewer flagged band-based prehab (Monster Walk etc.) as an "equipment
 * mismatch" because the nested `accessories` object (bands / rings / pull-up
 * bar / dip belt) was omitted from the summary entirely.
 */
import { describe, it, expect } from "vitest";
import { summariseEquipment } from "../block-review-export";

describe("summariseEquipment", () => {
  it("surfaces nested accessories (bands / rings / pull-up bar / dip belt)", () => {
    const out = summariseEquipment({
      preset: "home_gym",
      bars: { barbellKg: 20, trapBarKg: 25 },
      plates: [20, 15, 10, 5, 2.5, 1.25],
      dumbbells: { minKg: 2, maxKg: 50, stepKg: 2 },
      machines: ["lat_pulldown", "leg_press"],
      cardio: ["treadmill", "bike_air"],
      accessories: {
        bands: true,
        bandStrength: "medium",
        pullUpBar: true,
        rings: true,
        dipBelt: true,
        dipBeltMaxKg: 40,
        weightedVest: [],
        sandbag: [],
        ankleWeights: false,
      },
    });
    const joined = out.join(" | ");
    expect(joined).toContain("bands (medium)");
    expect(joined).toContain("pull-up bar");
    expect(joined).toContain("rings");
    expect(joined).toContain("dip belt (+40kg)");
    // Existing top-level groups still surface.
    expect(joined).toContain("plates (6)");
    expect(joined).toContain("cardio (2)");
  });

  it("omits accessories the athlete does not own", () => {
    const out = summariseEquipment({
      accessories: {
        bands: false,
        pullUpBar: false,
        rings: false,
        dipBelt: false,
        ankleWeights: false,
        weightedVest: [],
        sandbag: [],
      },
    });
    expect(out.join(" | ")).not.toMatch(/band|ring|pull-up|dip belt|vest|sandbag/i);
  });

  it("handles a missing / non-object equipment payload", () => {
    expect(summariseEquipment(null)).toEqual([]);
    expect(summariseEquipment(undefined)).toEqual([]);
    expect(summariseEquipment("nope")).toEqual([]);
  });

  it("surfaces bands even without a declared strength", () => {
    const out = summariseEquipment({ accessories: { bands: true } });
    expect(out).toContain("bands");
  });
});
