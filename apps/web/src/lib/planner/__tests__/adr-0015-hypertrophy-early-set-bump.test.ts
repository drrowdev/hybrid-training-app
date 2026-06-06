/**
 * ADR 0015 — effort-bump the hypertrophy compound's EARLY (non-final) sets.
 *
 * Pins:
 *   - HYPERTROPHY_ANCHOR weekIndex 0/1/2: every non-final primary "main" set
 *     has reps = min(12, waveReps + 2), an intensityCue, and NO targetRir /
 *     targetRpe. percentTm (load) is unchanged from the wave.
 *   - The bump never exceeds the 12-rep cap.
 *   - The ADR 0011 final-set anchor is preserved (reps 12/10/8, RIR, cue).
 *   - Deload week (3): early sets unchanged (reps 8, no cue, no targetRir).
 *   - Regression: STRENGTH_ANCHOR (a non-hypertrophy archetype) gets NO
 *     early-set cue or rep bump — the ADR 0015 transform is hypertrophy-only.
 *   - Folded secondary slot: secondary "main" items get NO early-set cue
 *     (the bump runs only on the primary wave).
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

describe("ADR 0015 — hypertrophy compound early-set effort bump", () => {
  for (const weekIndex of [0, 1, 2]) {
    it(`week ${weekIndex}: early primary sets get reps=min(12, wave+2) + cue, no RIR, unchanged load`, () => {
      const day = firstHypertrophyStrengthDay();
      const items = buildPrescription(HYPERTROPHY_ANCHOR, weekIndex, day, PRIMARY);
      const mains = items.filter((i) => i.kind === "main");
      expect(mains.length).toBeGreaterThan(1);
      const profile = HYPERTROPHY_ANCHOR.weekProfiles.find(
        (w) => w.weekIndex === weekIndex,
      )!;
      const waveReps = profile.setReps as number[];
      const waveIntensities = profile.setIntensities;
      for (let i = 0; i < mains.length - 1; i++) {
        const item = mains[i]!;
        expect(item.reps).toBe(Math.min(12, waveReps[i]! + 2));
        expect(item.reps!).toBeLessThanOrEqual(12);
        expect(item.intensityCue).toBeTruthy();
        expect(item.intensityCue!.length).toBeLessThanOrEqual(80);
        // Honest submaximal cue — NOT a precise RIR/RPE target.
        expect(item.targetRir).toBeUndefined();
        expect(item.targetRpe).toBeUndefined();
        // Load is unchanged.
        expect(item.percentTm).toBe(Math.round(waveIntensities[i]! * 100));
      }
    });
  }

  it("final-set anchor (ADR 0011) is preserved alongside the early-set bump", () => {
    const day = firstHypertrophyStrengthDay();
    const expectations = [
      { weekIndex: 0, reps: 12, rir: { min: 2, max: 2 } },
      { weekIndex: 1, reps: 10, rir: { min: 2, max: 2 } },
      { weekIndex: 2, reps: 8, rir: { min: 1, max: 1 } },
    ];
    for (const { weekIndex, reps, rir } of expectations) {
      const items = buildPrescription(HYPERTROPHY_ANCHOR, weekIndex, day, PRIMARY);
      const mains = items.filter((i) => i.kind === "main");
      const last = mains[mains.length - 1]!;
      expect(last.reps).toBe(reps);
      expect(last.targetRir).toEqual(rir);
      expect(last.isAmrap).toBe(false);
    }
  });

  it("deload week: early sets unchanged — no rep bump, no cue, no RIR", () => {
    const day = firstHypertrophyStrengthDay();
    const deloadWk = HYPERTROPHY_ANCHOR.weekProfiles.find((w) => w.intensityLabel === "Deload")!.weekIndex;
    const items = buildPrescription(HYPERTROPHY_ANCHOR, deloadWk, day, PRIMARY);
    const mains = items.filter((i) => i.kind === "main");
    expect(mains.length).toBeGreaterThan(0);
    for (const item of mains) {
      expect(item.reps).toBe(8);
      expect(item.intensityCue).toBeUndefined();
      expect(item.targetRir).toBeUndefined();
    }
  });

  it("regression: STRENGTH_ANCHOR gets NO early-set cue or rep bump (hypertrophy-only)", () => {
    const day = firstStrengthAnchorDay();
    for (let w = 0; w < STRENGTH_ANCHOR.weekProfiles.length; w++) {
      const items = buildPrescription(STRENGTH_ANCHOR, w, day, PRIMARY);
      const mains = items.filter((i) => i.kind === "main");
      const profile = STRENGTH_ANCHOR.weekProfiles.find((p) => p.weekIndex === w)!;
      for (let i = 0; i < mains.length - 1; i++) {
        const item = mains[i]!;
        // No ADR 0015 cue on a non-hypertrophy archetype's early sets.
        expect(item.intensityCue).toBeUndefined();
        // Reps match the wave exactly (no +2 bump).
        if (Array.isArray(profile.setReps)) {
          expect(item.reps).toBe(profile.setReps[i]);
        } else {
          expect(item.reps).toBe(profile.setReps);
        }
      }
    }
  });

  it("folded secondary slot: secondary main items get NO early-set cue", () => {
    const base = firstHypertrophyStrengthDay();
    const dayWithSecondary: StrengthDay = {
      ...base,
      secondaryRole: "vertical_press",
      secondaryMaxSets: HYPERTROPHY_ANCHOR.foldedSecondaryMaxSets ?? 4,
    };
    const items = buildPrescription(
      HYPERTROPHY_ANCHOR,
      1,
      dayWithSecondary,
      PRIMARY,
      undefined,
      SECONDARY,
    );
    const secondaryMains = items.filter(
      (i) => i.kind === "main" && i.movementId === SECONDARY.id,
    );
    expect(secondaryMains.length).toBeGreaterThan(0);
    for (const item of secondaryMains) {
      expect(item.intensityCue).toBeUndefined();
      expect(item.targetRir).toBeUndefined();
    }
  });
});
