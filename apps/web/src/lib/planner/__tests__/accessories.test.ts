/**
 * Hypertrophy accessory tests.
 *
 * Two strands:
 *  1. Pool integrity — every slug references a movement that the seed
 *     scripts actually emit (lint via the seeds export so the test fails
 *     when someone deletes a movement without updating the pool).
 *  2. Inclusion logic — shouldIncludeAccessories honours both archetype-
 *     default and per-day override.
 */
import { describe, it, expect } from "vitest";
import { SEED_MOVEMENTS } from "@hta/db/seeds/movements";
import {
  ACCESSORY_POOLS,
  accessoryPoolFor,
  allAccessorySlugs,
} from "../accessories";
import {
  ARCHETYPES,
  HYPERTROPHY_ANCHOR,
  STRENGTH_ANCHOR,
  shouldIncludeAccessories,
  type StrengthDay,
} from "../archetypes";

describe("Accessory pool integrity", () => {
  it("every accessory slug exists in the seed catalog", () => {
    const seededSlugs = new Set(SEED_MOVEMENTS.map((m) => m.slug));
    for (const slug of allAccessorySlugs()) {
      expect(seededSlugs.has(slug), `slug missing from catalog: ${slug}`).toBe(true);
    }
  });

  it("every strength role has at least 3 curated accessories", () => {
    for (const role of ["squat", "horizontal_press", "deadlift", "vertical_press"] as const) {
      expect(accessoryPoolFor(role).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("each pool entry has plain-language muscle target + sane sets/reps", () => {
    for (const pool of Object.values(ACCESSORY_POOLS)) {
      for (const a of pool) {
        expect(a.muscleTarget.length).toBeGreaterThan(0);
        expect(a.sets).toBeGreaterThanOrEqual(2);
        expect(a.sets).toBeLessThanOrEqual(5);
        expect(a.reps).toMatch(/^\d+(-\d+)?$/);
      }
    }
  });

  it("squat pool covers hamstrings, calves, abs (per design doc §5)", () => {
    const muscles = accessoryPoolFor("squat").map((a) => a.muscleTarget);
    expect(muscles.some((m) => m.includes("ham"))).toBe(true);
    expect(muscles.some((m) => m.includes("calves"))).toBe(true);
    expect(muscles.some((m) => m.includes("abs"))).toBe(true);
  });

  it("horizontal_press pool covers side delts (rationale: nothing from press)", () => {
    const muscles = accessoryPoolFor("horizontal_press").map((a) => a.muscleTarget);
    expect(muscles.some((m) => m.includes("side delts"))).toBe(true);
  });
});

describe("shouldIncludeAccessories", () => {
  const fakeDay: StrengthDay = {
    kind: "strength",
    dayIndex: 0,
    role: "squat",
    title: "test",
    candidateSlugs: ["back-squat-high-bar"],
    priority: "anchor",
    rank: 1,
  };

  it("Hypertrophy Focus defaults to ON", () => {
    expect(shouldIncludeAccessories(HYPERTROPHY_ANCHOR, fakeDay)).toBe(true);
  });

  it("Strength Focus defaults to OFF", () => {
    expect(shouldIncludeAccessories(STRENGTH_ANCHOR, fakeDay)).toBe(false);
  });

  it("Per-day includeAccessories=true overrides archetype default off", () => {
    const day: StrengthDay = { ...fakeDay, includeAccessories: true };
    expect(shouldIncludeAccessories(STRENGTH_ANCHOR, day)).toBe(true);
  });

  it("Per-day includeAccessories=false overrides archetype default on", () => {
    const day: StrengthDay = { ...fakeDay, includeAccessories: false };
    expect(shouldIncludeAccessories(HYPERTROPHY_ANCHOR, day)).toBe(false);
  });

  it("Rebuild + Endurance default to OFF", () => {
    expect(shouldIncludeAccessories(ARCHETYPES.rebuild, fakeDay)).toBe(false);
    expect(shouldIncludeAccessories(ARCHETYPES.endurance_anchor, fakeDay)).toBe(false);
  });
});
