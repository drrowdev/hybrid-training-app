/**
 * ADR 0020 — secondary-focus volume tilt (unit).
 *
 * Pins the resolver coercion and the (primary, secondary) tilt matrix:
 *   - resolveSecondaryFocus collapses skip / maintenance / null / junk → none.
 *   - Only `muscle` on strength_anchor / endurance_anchor tilts (+1 item / +1 set).
 *   - Every other combination is the byte-identical NO_TILT identity —
 *     the engine-regression guarantee for existing blocks.
 */
import { describe, it, expect } from "vitest";
import {
  resolveSecondaryFocus,
  secondaryVolumeTilt,
  isActiveTilt,
  NO_TILT,
  SECONDARY_FOCUS_VALUES,
  SECONDARY_HYPERTROPHY_ITEM_DELTA,
  SECONDARY_HYPERTROPHY_SET_DELTA,
  type SecondaryFocus,
} from "../secondary-focus";
import type { ArchetypeId } from "../archetypes";

describe("resolveSecondaryFocus", () => {
  it("passes through valid engine values", () => {
    for (const v of SECONDARY_FOCUS_VALUES) {
      expect(resolveSecondaryFocus(v)).toBe(v);
    }
  });

  it("collapses the wizard skip / maintenance channels to none", () => {
    expect(resolveSecondaryFocus("skip")).toBe("none");
    expect(resolveSecondaryFocus("maintenance")).toBe("none");
  });

  it("collapses null / undefined / junk to none", () => {
    expect(resolveSecondaryFocus(null)).toBe("none");
    expect(resolveSecondaryFocus(undefined)).toBe("none");
    expect(resolveSecondaryFocus("")).toBe("none");
    expect(resolveSecondaryFocus("resilience")).toBe("none");
    expect(resolveSecondaryFocus("NONE")).toBe("none");
  });
});

describe("secondaryVolumeTilt — v1 volume-direction matrix", () => {
  it("tilts Strength + Muscle (strength_anchor) by +1 item / +1 set", () => {
    const tilt = secondaryVolumeTilt("strength_anchor", "muscle");
    expect(tilt.itemsPerSessionDelta).toBe(SECONDARY_HYPERTROPHY_ITEM_DELTA);
    expect(tilt.setsPerItemDelta).toBe(SECONDARY_HYPERTROPHY_SET_DELTA);
    expect(tilt).toEqual({ itemsPerSessionDelta: 1, setsPerItemDelta: 1 });
    expect(isActiveTilt(tilt)).toBe(true);
  });

  it("tilts Cardio + Muscle (endurance_anchor) by +1 item / +1 set", () => {
    const tilt = secondaryVolumeTilt("endurance_anchor", "muscle");
    expect(tilt).toEqual({ itemsPerSessionDelta: 1, setsPerItemDelta: 1 });
    expect(isActiveTilt(tilt)).toBe(true);
  });
});

describe("secondaryVolumeTilt — no-op guarantees", () => {
  const everyArchetype: ArchetypeId[] = [
    "strength_anchor",
    "endurance_anchor",
    "concurrent_hybrid",
    "hypertrophy_anchor",
    "maintenance",
    "rebuild",
  ];

  it("is a no-op for secondary=none on every archetype", () => {
    for (const id of everyArchetype) {
      expect(secondaryVolumeTilt(id, "none")).toEqual(NO_TILT);
      expect(isActiveTilt(secondaryVolumeTilt(id, "none"))).toBe(false);
    }
  });

  it("does not tilt intensity-direction secondaries (strength / cardio) — deferred", () => {
    const deferred: SecondaryFocus[] = ["strength", "cardio"];
    for (const id of everyArchetype) {
      for (const sec of deferred) {
        expect(secondaryVolumeTilt(id, sec)).toEqual(NO_TILT);
      }
    }
  });

  it("does not tilt muscle secondary on already-hypertrophy / flipped / light archetypes", () => {
    // hypertrophy_anchor owns its own ADR 0016 volume dial; the others either
    // already flip the archetype honestly or are intentionally light.
    expect(secondaryVolumeTilt("hypertrophy_anchor", "muscle")).toEqual(NO_TILT);
    expect(secondaryVolumeTilt("concurrent_hybrid", "muscle")).toEqual(NO_TILT);
    expect(secondaryVolumeTilt("maintenance", "muscle")).toEqual(NO_TILT);
    expect(secondaryVolumeTilt("rebuild", "muscle")).toEqual(NO_TILT);
  });
});
