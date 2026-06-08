/**
 * Plyometric floor suppression for running blocks (review fix).
 *
 * A runner already accumulates abundant reactive ground-contact loading several
 * sessions a week, so the low-impact plyometric durability floor is redundant
 * impact volume. `effectiveDurabilityFloor` drops the plyometric requirement
 * when the block's cardio is running-impact (mirroring the tendinopathy
 * suppression) — gated on `runningCardio`, so non-running blocks are unchanged.
 */
import { describe, expect, it } from "vitest";
import { effectiveDurabilityFloor, EMPTY_ACCESSORY_PROFILE } from "../accessory-roles";

describe("effectiveDurabilityFloor — plyometric suppression", () => {
  it("keeps the plyometric floor for a non-running block", () => {
    const floor = effectiveDurabilityFloor(EMPTY_ACCESSORY_PROFILE, false, false);
    expect(floor.plyometric_low).toBeGreaterThan(0);
  });

  it("drops the plyometric floor when the block's cardio is running", () => {
    const floor = effectiveDurabilityFloor(EMPTY_ACCESSORY_PROFILE, false, true);
    expect(floor.plyometric_low).toBe(0);
    expect(floor.plyometric_high).toBe(0);
  });

  it("still drops it for an active tendinopathy flag (unchanged behaviour)", () => {
    const floor = effectiveDurabilityFloor(EMPTY_ACCESSORY_PROFILE, true, false);
    expect(floor.plyometric_low).toBe(0);
  });

  it("keeps the rest of the floor intact when plyo is suppressed", () => {
    const floor = effectiveDurabilityFloor(EMPTY_ACCESSORY_PROFILE, false, true);
    expect(floor.heavy_isometric).toBeGreaterThan(0);
    expect(floor.hsr).toBeGreaterThan(0);
    expect(floor.carry).toBeGreaterThan(0);
  });
});
