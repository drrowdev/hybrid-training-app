/**
 * ADR 0011 — effort-anchor hypertrophy compound final working set.
 *
 * Pins:
 *   - HYPERTROPHY_ANCHOR weekIndex 0/1/2: final primary "main" item has
 *     the expected reps (12/10/8) + targetRir ({2,2}/{2,2}/{1,1}) and a
 *     non-empty intensityCue. Non-final sets have NO targetRir/cue and
 *     their reps + percentTm are unchanged from the wave.
 *   - HYPERTROPHY_ANCHOR weekIndex 3 (Deload): NO targetRir on any item.
 *   - HYPERTROPHY_ANCHOR is excluded from the ADR 0007 AMRAP marker — its
 *     final set carries isAmrap:false (RIR-anchored, not open AMRAP).
 *   - Regression: STRENGTH_ANCHOR main sets carry NO RIR anchor
 *     (targetRir/targetRpe) — the ADR 0011 effort anchor is hypertrophy-only.
 *     (STRENGTH_ANCHOR's top set DOES carry the ADR 0007 AMRAP cue; that is
 *     covered by the ADR 0007 test, not here.)
 *   - Folded secondary: a hypertrophy day with a secondary slot leaves
 *     the secondary "main" items untouched (only the primary final set
 *     carries the RIR anchor).
 */
import { describe, it, expect } from "vitest";
import {
  HYPERTROPHY_ANCHOR,
  STRENGTH_ANCHOR,
  buildPrescription,
  type StrengthDay,
} from "../archetypes";

const PRIMARY = { id: "p", slug: "p-slug", displayName: "Primary" };
const SECONDARY = { id: "s", slug: "s-slug", displayName: "Secondary" };

function firstHypertrophyStrengthDay(): StrengthDay {
  return HYPERTROPHY_ANCHOR.days.find(
    (d): d is StrengthDay => d.kind === "strength",
  )!;
}

function firstStrengthAnchorDay(): StrengthDay {
  return STRENGTH_ANCHOR.days.find(
    (d): d is StrengthDay => d.kind === "strength",
  )!;
}

describe("ADR 0011 — hypertrophy compound effort anchor (final set)", () => {
  const expectations: Array<{
    weekIndex: number;
    reps: number;
    rir: { min: number; max: number };
  }> = [
    { weekIndex: 0, reps: 12, rir: { min: 2, max: 2 } },
    { weekIndex: 1, reps: 10, rir: { min: 2, max: 2 } },
    { weekIndex: 2, reps: 8, rir: { min: 1, max: 1 } },
  ];

  for (const { weekIndex, reps, rir } of expectations) {
    it(`week ${weekIndex}: final primary main set has reps=${reps}, targetRir=${rir.min}/${rir.max}, non-empty cue`, () => {
      const day = firstHypertrophyStrengthDay();
      const items = buildPrescription(HYPERTROPHY_ANCHOR, weekIndex, day, PRIMARY);
      const mains = items.filter((i) => i.kind === "main");
      expect(mains.length).toBeGreaterThan(1);
      const last = mains[mains.length - 1]!;
      expect(last.reps).toBe(reps);
      expect(last.targetRir).toEqual(rir);
      expect(last.intensityCue).toBeTruthy();
      expect(last.intensityCue!.length).toBeLessThanOrEqual(80);
      // Load unchanged on the anchored set — still %TM-driven.
      expect(last.percentTm).toBeTypeOf("number");
      expect(last.intensityLabel).toMatch(/% TM$/);
      // Still tagged top set.
      expect(last.notes).toBe("top set");
      // ADR 0007 — hypertrophy is RIR-anchored, never an open AMRAP.
      expect(last.isAmrap).toBe(false);
    });

    it(`week ${weekIndex}: NON-final primary main sets get the ADR 0015 early-set bump (cue + bounded reps), NO targetRir`, () => {
      const day = firstHypertrophyStrengthDay();
      const items = buildPrescription(HYPERTROPHY_ANCHOR, weekIndex, day, PRIMARY);
      const mains = items.filter((i) => i.kind === "main");
      const profile = HYPERTROPHY_ANCHOR.weekProfiles.find(
        (w) => w.weekIndex === weekIndex,
      )!;
      const waveReps = profile.setReps as number[];
      const waveIntensities = profile.setIntensities;
      for (let i = 0; i < mains.length - 1; i++) {
        const item = mains[i]!;
        // ADR 0015 — early sets are effort-bumped, not RIR-anchored.
        expect(item.targetRir).toBeUndefined();
        expect(item.targetRpe).toBeUndefined();
        expect(item.intensityCue).toBeTruthy();
        expect(item.intensityCue!.length).toBeLessThanOrEqual(80);
        // Bounded rep bump: +2 over the wave, capped at 12.
        expect(item.reps).toBe(Math.min(12, waveReps[i]! + 2));
        // Load is unchanged — still %TM-driven at the wave intensity.
        expect(item.percentTm).toBe(Math.round(waveIntensities[i]! * 100));
      }
    });
  }

  it("week 3 (Deload): NO targetRir/intensityCue on any main item, reps unchanged", () => {
    const day = firstHypertrophyStrengthDay();
    const items = buildPrescription(HYPERTROPHY_ANCHOR, 3, day, PRIMARY);
    const mains = items.filter((i) => i.kind === "main");
    expect(mains.length).toBeGreaterThan(0);
    for (const it of mains) {
      expect(it.targetRir).toBeUndefined();
      expect(it.targetRpe).toBeUndefined();
      expect(it.intensityCue).toBeUndefined();
      // Deload prescribes a flat 8 reps.
      expect(it.reps).toBe(8);
    }
    // ADR 0007 — deload top set is explicitly NOT an AMRAP.
    expect(mains[mains.length - 1]!.isAmrap).toBe(false);
  });

  it("regression: STRENGTH_ANCHOR main sets get NO RIR anchor (ADR 0011 is hypertrophy-only)", () => {
    const day = firstStrengthAnchorDay();
    // Every non-deload week (and deload) of the strength archetype.
    for (let w = 0; w < STRENGTH_ANCHOR.weekProfiles.length; w++) {
      const items = buildPrescription(STRENGTH_ANCHOR, w, day, PRIMARY);
      const mains = items.filter((i) => i.kind === "main");
      expect(mains.length).toBeGreaterThan(0);
      for (const it of mains) {
        // The RIR/RPE effort anchor is hypertrophy-only; strength uses AMRAP.
        expect(it.targetRir).toBeUndefined();
        expect(it.targetRpe).toBeUndefined();
      }
      // Non-top sets never carry an intensity cue.
      for (let i = 0; i < mains.length - 1; i++) {
        expect(mains[i]!.intensityCue).toBeUndefined();
      }
    }
  });

  it("folded secondary slot: secondary main items carry NO targetRir on a hypertrophy day", () => {
    // Build a synthetic strength day that opts into the dual-main-lift
    // fold so we can prove the anchor does NOT leak onto the secondary.
    const base = firstHypertrophyStrengthDay();
    const dayWithSecondary: StrengthDay = {
      ...base,
      secondaryRole: "vertical_press",
      secondaryMaxSets: HYPERTROPHY_ANCHOR.foldedSecondaryMaxSets ?? 4,
    };
    const items = buildPrescription(
      HYPERTROPHY_ANCHOR,
      1, // non-deload week — anchor IS active for primary
      dayWithSecondary,
      PRIMARY,
      undefined,
      SECONDARY,
    );
    const mains = items.filter((i) => i.kind === "main");
    const primaryMains = mains.filter((i) => i.movementId === PRIMARY.id);
    const secondaryMains = mains.filter((i) => i.movementId === SECONDARY.id);
    expect(primaryMains.length).toBeGreaterThan(0);
    expect(secondaryMains.length).toBeGreaterThan(0);
    // Primary final set IS anchored.
    const primaryLast = primaryMains[primaryMains.length - 1]!;
    expect(primaryLast.targetRir).toEqual({ min: 2, max: 2 });
    // Secondary items: NONE carry an RIR anchor — folded secondaries
    // stay fixed-rep volume per ADR 0011.
    for (const it of secondaryMains) {
      expect(it.targetRir).toBeUndefined();
      expect(it.targetRpe).toBeUndefined();
      expect(it.intensityCue).toBeUndefined();
    }
  });
});
