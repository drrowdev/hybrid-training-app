/**
 * Unit coverage for `hybridQuickContextFromInstance` — the seam that makes the
 * Quick Workout generator program-aware. For the native Hybrid program, the
 * resolved context must come from the serialised program INSTANCE (which carries
 * the real archetype + the user's focus muscles), NOT the platform
 * `training_blocks` row (archetype NULL, focus_muscles empty). For every other
 * program it returns null so the caller falls back to the block row unchanged.
 */
import { describe, it, expect } from "vitest";
import { hybridQuickContextFromInstance } from "../quick-generate-resolve";

describe("hybridQuickContextFromInstance", () => {
  it("derives concurrent_hybrid + focus muscles from a Hybrid instance", () => {
    const ctx = hybridQuickContextFromInstance("hybrid", {
      archetypeId: "concurrent_hybrid",
      focusMuscles: ["biceps", "calves"],
      secondaryFocus: "muscle",
      accessoryVolume: "high",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.archetypeId).toBe("concurrent_hybrid");
    expect(ctx!.focusMuscles).toEqual(["biceps", "calves"]);
    expect(ctx!.secondaryFocusRaw).toBe("muscle");
    expect(ctx!.accessoryVolumeRaw).toBe("high");
  });

  it("defaults focus/secondary/volume safely when the instance omits them", () => {
    const ctx = hybridQuickContextFromInstance("hybrid", {
      archetypeId: "concurrent_hybrid",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.archetypeId).toBe("concurrent_hybrid");
    expect(ctx!.focusMuscles).toEqual([]);
    expect(ctx!.secondaryFocusRaw).toBeNull();
    expect(ctx!.accessoryVolumeRaw).toBeNull();
  });

  it("falls back to concurrent_hybrid when the instance archetype is missing or unknown", () => {
    expect(hybridQuickContextFromInstance("hybrid", {})!.archetypeId).toBe(
      "concurrent_hybrid",
    );
    expect(
      hybridQuickContextFromInstance("hybrid", { archetypeId: "not_a_real_archetype" })!
        .archetypeId,
    ).toBe("concurrent_hybrid");
    expect(
      hybridQuickContextFromInstance("hybrid", { archetypeId: "custom" })!.archetypeId,
    ).toBe("concurrent_hybrid");
  });

  it("returns null for non-Hybrid programs so the caller uses the block row", () => {
    const inst = { archetypeId: "concurrent_hybrid", focusMuscles: ["biceps"] };
    expect(hybridQuickContextFromInstance("wendler-531", inst)).toBeNull();
    expect(hybridQuickContextFromInstance("tactical-barbell", inst)).toBeNull();
    expect(hybridQuickContextFromInstance("green-protocol", inst)).toBeNull();
  });

  it("returns null when there is no active program instance", () => {
    expect(hybridQuickContextFromInstance(null, null)).toBeNull();
    expect(hybridQuickContextFromInstance(undefined, undefined)).toBeNull();
    expect(hybridQuickContextFromInstance("hybrid", null)).toBeNull();
    expect(hybridQuickContextFromInstance("hybrid", "not-an-object")).toBeNull();
  });
});
