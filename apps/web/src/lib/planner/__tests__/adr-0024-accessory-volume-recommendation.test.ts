/**
 * ADR 0024 addendum — accessory-volume recommendation + applicability.
 *
 * Pins the advisory layer that pre-selects a wizard default and decides whether
 * the control is interactive:
 *
 *   - applicability is derived from each archetype's OWN aesthetic base (the
 *     same field the engine floors against), so it never drifts from real
 *     prescription behaviour;
 *   - the recommendation never points at an inert level (a `"muscle"` secondary
 *     on a base-1 archetype recommends High, skipping the Low==Medium stops);
 *   - Maintenance (zero accessories) yields `null` → caller renders disabled.
 */
import { describe, it, expect } from "vitest";
import {
  accessoryVolumeApplicability,
  accessoryVolumeRedundancy,
  recommendedAccessoryVolume,
  type RecommendableArchetypeId,
} from "../accessory-volume-recommendation";
import type { SecondaryFocus } from "../secondary-focus";
import type { AccessoryVolumeLevel } from "../accessory-volume";

const REAL_ARCHETYPES: RecommendableArchetypeId[] = [
  "strength_anchor",
  "endurance_anchor",
  "rebuild",
  "hypertrophy_anchor",
  "concurrent_hybrid",
  "maintenance",
];

describe("accessoryVolumeApplicability", () => {
  it("matches the archetype aesthetic bases (single source of truth)", () => {
    expect(accessoryVolumeApplicability("strength_anchor").aestheticBaseItems).toBe(2);
    expect(accessoryVolumeApplicability("hypertrophy_anchor").aestheticBaseItems).toBe(4);
    expect(accessoryVolumeApplicability("concurrent_hybrid").aestheticBaseItems).toBe(2);
    expect(accessoryVolumeApplicability("endurance_anchor").aestheticBaseItems).toBe(1);
    expect(accessoryVolumeApplicability("rebuild").aestheticBaseItems).toBe(1);
    expect(accessoryVolumeApplicability("maintenance").aestheticBaseItems).toBe(0);
  });

  it("disables only Maintenance (base 0)", () => {
    for (const id of REAL_ARCHETYPES) {
      const enabled = accessoryVolumeApplicability(id).enabled;
      expect(enabled).toBe(id !== "maintenance");
    }
  });

  it("never flags Low==Medium — low trims a movement on every enabled archetype", () => {
    expect(accessoryVolumeApplicability("endurance_anchor").lowEqualsMedium).toBe(false);
    expect(accessoryVolumeApplicability("rebuild").lowEqualsMedium).toBe(false);
    expect(accessoryVolumeApplicability("strength_anchor").lowEqualsMedium).toBe(false);
    expect(accessoryVolumeApplicability("hypertrophy_anchor").lowEqualsMedium).toBe(false);
    expect(accessoryVolumeApplicability("concurrent_hybrid").lowEqualsMedium).toBe(false);
    expect(accessoryVolumeApplicability("maintenance").lowEqualsMedium).toBe(false);
  });
});

describe("recommendedAccessoryVolume", () => {
  it("recommends the base level per archetype with no secondary", () => {
    expect(recommendedAccessoryVolume({ archetypeId: "strength_anchor", secondary: "none" })?.level).toBe("medium");
    expect(recommendedAccessoryVolume({ archetypeId: "hypertrophy_anchor", secondary: "none" })?.level).toBe("high");
    expect(recommendedAccessoryVolume({ archetypeId: "concurrent_hybrid", secondary: "none" })?.level).toBe("medium");
    expect(recommendedAccessoryVolume({ archetypeId: "endurance_anchor", secondary: "none" })?.level).toBe("low");
    expect(recommendedAccessoryVolume({ archetypeId: "rebuild", secondary: "none" })?.level).toBe("low");
  });

  it("returns null (disabled) for Maintenance at every secondary", () => {
    const secondaries: SecondaryFocus[] = ["none", "strength", "muscle", "cardio"];
    for (const s of secondaries) {
      expect(recommendedAccessoryVolume({ archetypeId: "maintenance", secondary: s })).toBeNull();
    }
  });

  it("pushes a muscle secondary to High (the level that actually adds volume)", () => {
    expect(recommendedAccessoryVolume({ archetypeId: "strength_anchor", secondary: "muscle" })?.level).toBe("high");
    expect(recommendedAccessoryVolume({ archetypeId: "concurrent_hybrid", secondary: "muscle" })?.level).toBe("high");
    // base-1 archetype: never recommend the inert Medium, jump straight to High
    expect(recommendedAccessoryVolume({ archetypeId: "endurance_anchor", secondary: "muscle" })?.level).toBe("high");
  });

  it("ignores non-muscle secondaries for the amount", () => {
    expect(recommendedAccessoryVolume({ archetypeId: "strength_anchor", secondary: "cardio" })?.level).toBe("medium");
    expect(recommendedAccessoryVolume({ archetypeId: "endurance_anchor", secondary: "strength" })?.level).toBe("low");
  });

  it("never recommends an inert level (Low on a base-1 archetype is allowed; Medium-on-base-1 is not produced)", () => {
    // The only base-1 recommendations the function emits are `low` (no muscle)
    // or `high` (muscle) — never `medium`, which would be a dead pick there.
    const secondaries: SecondaryFocus[] = ["none", "strength", "muscle", "cardio"];
    for (const id of ["endurance_anchor", "rebuild"] as RecommendableArchetypeId[]) {
      for (const s of secondaries) {
        const rec = recommendedAccessoryVolume({ archetypeId: id, secondary: s });
        expect(rec).not.toBeNull();
        expect(rec!.level).not.toBe("medium");
      }
    }
  });

  it("always provides a non-empty reason when it recommends", () => {
    for (const id of REAL_ARCHETYPES) {
      const rec = recommendedAccessoryVolume({ archetypeId: id, secondary: "none" });
      if (rec) expect(rec.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("accessoryVolumeRedundancy", () => {
  const m = (
    low: number | null,
    medium: number | null,
    high: number | null,
  ): Record<AccessoryVolumeLevel, number | null> => ({ low, medium, high });

  it("returns nothing redundant for null / missing estimates", () => {
    expect(accessoryVolumeRedundancy(null).redundant.size).toBe(0);
    expect(accessoryVolumeRedundancy(undefined).redundant.size).toBe(0);
  });

  it("flags High when it equals Medium (the screenshot case 57/62/62)", () => {
    const r = accessoryVolumeRedundancy(m(57, 62, 62));
    expect([...r.redundant]).toEqual(["high"]);
    expect(r.equivalentLevel.high).toBe("medium");
  });

  it("flags Medium AND High when all three are equal (lever fully inert)", () => {
    const r = accessoryVolumeRedundancy(m(62, 62, 62));
    expect(r.redundant.has("medium")).toBe(true);
    expect(r.redundant.has("high")).toBe(true);
    expect(r.redundant.has("low")).toBe(false);
    // Both point at the leanest equivalent (Low).
    expect(r.equivalentLevel.medium).toBe("low");
    expect(r.equivalentLevel.high).toBe("low");
  });

  it("flags nothing when all three levels differ", () => {
    expect(accessoryVolumeRedundancy(m(50, 60, 70)).redundant.size).toBe(0);
  });

  it("does not flag a level whose estimate is null", () => {
    const r = accessoryVolumeRedundancy(m(60, null, 60));
    // High equals Low → redundant; Medium is unknown → not flagged.
    expect(r.redundant.has("high")).toBe(true);
    expect(r.equivalentLevel.high).toBe("low");
    expect(r.redundant.has("medium")).toBe(false);
  });
});
