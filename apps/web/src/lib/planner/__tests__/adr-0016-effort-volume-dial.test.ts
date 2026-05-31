/**
 * ADR 0016 — user effort/volume dial (`profiles.effort_preference`).
 *
 * Pins both axes of the hypertrophy-only dial and the cross-archetype
 * regression invariant:
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
 *   VOLUME axis (accessory, via assemblePrescriptionItems):
 *     - hypertrophy aesthetic accessories carry setsPerItem 2 / 3 / 4 for
 *       low / standard / high.
 *     - Regression: a non-hypertrophy archetype's accessory sets are
 *       unchanged across all three dial settings.
 *
 *   Config units: resolver default + setsPerItem scaling/floor.
 */
import { describe, it, expect } from "vitest";
import {
  HYPERTROPHY_ANCHOR,
  STRENGTH_ANCHOR,
  buildPrescription,
  type Archetype,
  type StrengthDay,
} from "../archetypes";
import { assemblePrescriptionItems } from "../assemble-prescription";
import type { CatalogMovement, WeekAccessoryHistoryItem } from "../accessory-picker";
import {
  resolveEffortPreference,
  hypertrophyEffortConfig,
  hypertrophyAccessorySetsPerItem,
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

  it("week 3 (deload): dial is a no-op (high == low == standard)", () => {
    const day = firstStrengthDay(HYPERTROPHY_ANCHOR);
    const mk = (p: EffortPreference) =>
      buildPrescription(
        HYPERTROPHY_ANCHOR,
        3,
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

// ── Volume axis ──────────────────────────────────────────────────────

const VOL_CATALOG: CatalogMovement[] = [
  {
    id: "lr1", slug: "db-lateral-raise", displayName: "DB Lateral Raise",
    primaryMuscles: ["side_delts"], secondaryMuscles: [], primaryRegion: "shoulder_scapular",
    secondaryRegions: [], bulletproofRoles: [], functionalRoles: [], isSupported: false,
    isCompound: false, eccentricLoadScore: null, stimToFatigueScore: null, highStrainTendon: false,
  },
  {
    id: "bi1", slug: "db-curl", displayName: "DB Curl",
    primaryMuscles: ["biceps"], secondaryMuscles: [], primaryRegion: "elbow_forearm",
    secondaryRegions: [], bulletproofRoles: [], functionalRoles: [], isSupported: false,
    isCompound: false, eccentricLoadScore: null, stimToFatigueScore: null, highStrainTendon: false,
  },
  {
    id: "tri1", slug: "rope-pushdown", displayName: "Rope Pushdown",
    primaryMuscles: ["triceps"], secondaryMuscles: [], primaryRegion: "elbow_forearm",
    secondaryRegions: [], bulletproofRoles: [], functionalRoles: [], isSupported: true,
    isCompound: false, eccentricLoadScore: null, stimToFatigueScore: null, highStrainTendon: false,
  },
  {
    id: "calf1", slug: "standing-calf-raise", displayName: "Standing Calf Raise",
    primaryMuscles: ["calves"], secondaryMuscles: [], primaryRegion: "foot_ankle_calf",
    secondaryRegions: [], bulletproofRoles: [], functionalRoles: [], isSupported: false,
    isCompound: false, eccentricLoadScore: null, stimToFatigueScore: null, highStrainTendon: false,
  },
];

function aestheticSets(archetype: Archetype, pref: EffortPreference): number[] {
  const day = firstStrengthDay(archetype);
  const weekAccessoryHistory: WeekAccessoryHistoryItem[] = [];
  const items = assemblePrescriptionItems(
    archetype,
    0,
    day,
    PRIMARY,
    undefined,
    new Map(),
    VOL_CATALOG,
    weekAccessoryHistory,
    1.0, // weekDeloadScale — no deload scaling
    false,
    undefined,
    undefined,
    false,
    null,
    undefined,
    undefined,
    [],
    1.0,
    new Set(),
    pref,
  );
  return items
    .filter((i) => i.kind === "accessory" && i.intensityLabel === "aesthetic")
    .map((i) => i.sets!);
}

describe("ADR 0016 volume axis — hypertrophy accessory sets-per-movement", () => {
  it("hypertrophy aesthetic accessories scale 2 / 3 / 4 for low / standard / high", () => {
    const low = aestheticSets(HYPERTROPHY_ANCHOR, "low");
    const standard = aestheticSets(HYPERTROPHY_ANCHOR, "standard");
    const high = aestheticSets(HYPERTROPHY_ANCHOR, "high");
    expect(low.length).toBeGreaterThan(0);
    expect(standard.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    for (const s of low) expect(s).toBe(2);
    for (const s of standard) expect(s).toBe(3);
    for (const s of high) expect(s).toBe(4);
  });

  it("regression: a non-hypertrophy archetype's accessory sets are unchanged across dials", () => {
    const std = aestheticSets(STRENGTH_ANCHOR, "standard");
    expect(aestheticSets(STRENGTH_ANCHOR, "low")).toEqual(std);
    expect(aestheticSets(STRENGTH_ANCHOR, "high")).toEqual(std);
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

  it("hypertrophyAccessorySetsPerItem scales by ±1 and floors at 1", () => {
    expect(hypertrophyAccessorySetsPerItem("low", 3)).toBe(2);
    expect(hypertrophyAccessorySetsPerItem("standard", 3)).toBe(3);
    expect(hypertrophyAccessorySetsPerItem("high", 3)).toBe(4);
    expect(hypertrophyAccessorySetsPerItem("low", 1)).toBe(1); // floor
  });
});
