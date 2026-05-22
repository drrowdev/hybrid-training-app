import { describe, it, expect } from "vitest";
import {
  DEFAULT_BW_RATIOS,
  FALLBACK_BODYWEIGHT_KG,
  seedAllDefaultOneRm,
  seedDefaultOneRm,
} from "../defaults";

describe("seedDefaultOneRm (DC-G5 cold-start defaults)", () => {
  it("returns plate-friendly multiples of 2.5 kg", () => {
    for (const role of ["squat", "horizontal_press", "deadlift", "vertical_press"] as const) {
      const v = seedDefaultOneRm({ role, bodyweightKg: 82, sex: "male" });
      expect(v % 2.5).toBe(0);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("falls back to FALLBACK_BODYWEIGHT_KG when bodyweight is null", () => {
    const v = seedDefaultOneRm({ role: "squat", bodyweightKg: null, sex: null });
    const expected =
      Math.round((FALLBACK_BODYWEIGHT_KG * DEFAULT_BW_RATIOS.squat.neutral) / 2.5) * 2.5;
    expect(v).toBe(expected);
  });

  it("nudges female ratios below male for the same bodyweight (untrained-novice baseline)", () => {
    const male = seedDefaultOneRm({ role: "squat", bodyweightKg: 70, sex: "male" });
    const female = seedDefaultOneRm({ role: "squat", bodyweightKg: 70, sex: "female" });
    expect(female).toBeLessThan(male);
  });

  it("treats unknown sex as neutral fallback", () => {
    const neutral = seedDefaultOneRm({ role: "deadlift", bodyweightKg: 80, sex: null });
    const expected = Math.round((80 * DEFAULT_BW_RATIOS.deadlift.neutral) / 2.5) * 2.5;
    expect(neutral).toBe(expected);
  });

  it("never returns a value below 2.5 kg even for tiny bodyweight", () => {
    const v = seedDefaultOneRm({ role: "vertical_press", bodyweightKg: 1, sex: null });
    expect(v).toBeGreaterThanOrEqual(2.5);
  });

  it("seedAllDefaultOneRm produces a value for every main role", () => {
    const all = seedAllDefaultOneRm({ bodyweightKg: 75, sex: null });
    expect(all.squat).toBeGreaterThan(0);
    expect(all.horizontal_press).toBeGreaterThan(0);
    expect(all.deadlift).toBeGreaterThan(0);
    expect(all.vertical_press).toBeGreaterThan(0);
    // Sanity: deadlift > squat > bench > OHP at 75kg neutral.
    expect(all.deadlift).toBeGreaterThan(all.squat);
    expect(all.squat).toBeGreaterThan(all.horizontal_press);
    expect(all.horizontal_press).toBeGreaterThan(all.vertical_press);
  });
});
