/**
 * ADR 0016 — user effort dial (`profiles.effort_preference`).
 *
 * Pins the compound EFFORT axis of the hypertrophy-only dial and the
 * cross-archetype regression invariant. (The ADR 0016 accessory VOLUME axis
 * was superseded by ADR 0024's per-block `accessory_volume` level; its tests
 * now live in `adr-0024-accessory-volume-level.test.ts`.)
 *
 *   EFFORT axis (compound, via buildPrescription):
 *     - standard (default) == standard (explicit): byte-identical, so every
 *       existing call site and the golden master are untouched.
 *     - high: early sets reps = min(15, wave+4) + a cue; final-set RIR shifts
 *       DOWN by 1, floored at 1 (never RIR 0 / failure on a concurrent block).
 *     - low: early sets untouched (no bump, no cue); final-set RIR shifts UP
 *       by 1 (more reps in reserve).
 *     - Regression: a non-hypertrophy archetype is byte-identical across all
 *       three dial settings — the compound axis is hypertrophy-only.
 *
 *   Config units: resolver default + effort config magnitudes.
 */
import { describe, it, expect } from "vitest";
import {
  HYPERTROPHY_ANCHOR,
  STRENGTH_ANCHOR,
  buildPrescription,
  type Archetype,
  type StrengthDay,
} from "../archetypes";
import {
  resolveEffortPreference,
  hypertrophyEffortConfig,
  type EffortPreference,
} from "../effort-preference";

const PRIMARY = { id: "p", slug: "p-slug", displayName: "Primary" };

function firstStrengthDay(a: Archetype): StrengthDay {
  return a.days.find((d): d is StrengthDay => d.kind === "strength")!;
}

// ── Effort axis ──────────────────────────────────────────────────────

describe("ADR 0016 effort axis — hypertrophy compound dial", () => {
  it("standard (explicit) is byte-identical to the default (no param)", () => {
    const day = firstStrengthDay(HYPERTROPHY_ANCHOR);
    for (const weekIndex of [0, 1, 2, 3]) {
      const def = buildPrescription(HYPERTROPHY_ANCHOR, weekIndex, day, PRIMARY);
      const explicit = buildPrescription(
        HYPERTROPHY_ANCHOR,
        weekIndex,
        day,
        PRIMARY,
        undefined,
        undefined,
        undefined,
        "standard",
      );
      expect(explicit).toEqual(def);
    }
  });

  it("high: early sets reps=min(15, wave+4) + cue; final RIR base-1 floored at 1", () => {
    const day = firstStrengthDay(HYPERTROPHY_ANCHOR);
    const finalRirByWeek: Record<number, number> = { 0: 1, 1: 1, 2: 1 };
    for (const weekIndex of [0, 1, 2]) {
      const items = buildPrescription(
        HYPERTROPHY_ANCHOR,
        weekIndex,
        day,
        PRIMARY,
        undefined,
        undefined,
        undefined,
        "high",
      );
      const mains = items.filter((i) => i.kind === "main");
      const profile = HYPERTROPHY_ANCHOR.weekProfiles.find(
        (w) => w.weekIndex === weekIndex,
      )!;
      const waveReps = profile.setReps as number[];
      for (let i = 0; i < mains.length - 1; i++) {
        const item = mains[i]!;
        expect(item.reps).toBe(Math.min(15, waveReps[i]! + 4));
        expect(item.reps!).toBeLessThanOrEqual(15);
        expect(item.intensityCue).toBeTruthy();
        expect(item.targetRir).toBeUndefined();
      }
      const last = mains[mains.length - 1]!;
      const rir = finalRirByWeek[weekIndex]!;
      expect(last.targetRir).toEqual({ min: rir, max: rir });
      expect(last.isAmrap).toBe(false);
    }
  });

  it("high never prescribes RIR 0 (failure) on any non-deload week", () => {
    const day = firstStrengthDay(HYPERTROPHY_ANCHOR);
    for (let w = 0; w < HYPERTROPHY_ANCHOR.weekProfiles.length; w++) {
      const items = buildPrescription(
        HYPERTROPHY_ANCHOR,
        w,
        day,
        PRIMARY,
        undefined,
        undefined,
        undefined,
        "high",
      );
      for (const item of items) {
        if (item.targetRir) {
          expect(item.targetRir.min).toBeGreaterThanOrEqual(1);
          expect(item.targetRir.max).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("low: early sets untouched (no bump, no cue); final RIR base+1", () => {
    const day = firstStrengthDay(HYPERTROPHY_ANCHOR);
    const finalRirByWeek: Record<number, number> = { 0: 3, 1: 3, 2: 2 };
    for (const weekIndex of [0, 1, 2]) {
      const items = buildPrescription(
        HYPERTROPHY_ANCHOR,
        weekIndex,
        day,
        PRIMARY,
        undefined,
        undefined,
        undefined,
        "low",
      );
      const mains = items.filter((i) => i.kind === "main");
      const profile = HYPERTROPHY_ANCHOR.weekProfiles.find(
        (w) => w.weekIndex === weekIndex,
      )!;
      const waveReps = profile.setReps as number[];
      for (let i = 0; i < mains.length - 1; i++) {
        const item = mains[i]!;
        expect(item.reps).toBe(waveReps[i]);
        expect(item.intensityCue).toBeUndefined();
        expect(item.targetRir).toBeUndefined();
      }
      const last = mains[mains.length - 1]!;
      const rir = finalRirByWeek[weekIndex]!;
      expect(last.targetRir).toEqual({ min: rir, max: rir });
    }
  });

  it("deload week: dial is a no-op (high == low == standard)", () => {
    const day = firstStrengthDay(HYPERTROPHY_ANCHOR);
    const deloadWk = HYPERTROPHY_ANCHOR.weekProfiles.find((w) => w.intensityLabel === "Deload")!.weekIndex;
    const mk = (p: EffortPreference) =>
      buildPrescription(
        HYPERTROPHY_ANCHOR,
        deloadWk,
        day,
        PRIMARY,
        undefined,
        undefined,
        undefined,
        p,
      );
    expect(mk("high")).toEqual(mk("standard"));
    expect(mk("low")).toEqual(mk("standard"));
  });

  it("regression: a non-hypertrophy archetype is identical across all dials", () => {
    const day = firstStrengthDay(STRENGTH_ANCHOR);
    for (let w = 0; w < STRENGTH_ANCHOR.weekProfiles.length; w++) {
      const std = buildPrescription(
        STRENGTH_ANCHOR,
        w,
        day,
        PRIMARY,
        undefined,
        undefined,
        undefined,
        "standard",
      );
      for (const pref of ["low", "high"] as const) {
        const got = buildPrescription(
          STRENGTH_ANCHOR,
          w,
          day,
          PRIMARY,
          undefined,
          undefined,
          undefined,
          pref,
        );
        expect(got).toEqual(std);
      }
    }
  });
});

// ── Config units ─────────────────────────────────────────────────────

describe("ADR 0016 config helpers", () => {
  it("resolveEffortPreference defaults unknown/null to standard", () => {
    expect(resolveEffortPreference(null)).toBe("standard");
    expect(resolveEffortPreference(undefined)).toBe("standard");
    expect(resolveEffortPreference("")).toBe("standard");
    expect(resolveEffortPreference("bogus")).toBe("standard");
    expect(resolveEffortPreference("low")).toBe("low");
    expect(resolveEffortPreference("high")).toBe("high");
  });

  it("standard config reproduces the shipped ADR 0015/0011 magnitudes", () => {
    const cfg = hypertrophyEffortConfig("standard");
    expect(cfg.earlyRepBonus).toBe(2);
    expect(cfg.earlyRepCap).toBe(12);
    expect(cfg.finalRirDelta).toBe(0);
  });
});
