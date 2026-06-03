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
  recommendedAccessoryVolume,
  type RecommendableArchetypeId,
} from "../accessory-volume-recommendation";
import type { SecondaryFocus } from "../secondary-focus";

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

  it("flags Low==Medium exactly on the base-1 archetypes", () => {
    expect(accessoryVolumeApplicability("endurance_anchor").lowEqualsMedium).toBe(true);
    expect(accessoryVolumeApplicability("rebuild").lowEqualsMedium).toBe(true);
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
