/**
 * ADR 0007 — autoregulated AMRAP top set on strength-goal archetypes.
 *
 * Pins:
 *   - STRENGTH_ANCHOR + CONCURRENT_HYBRID non-deload weeks: the primary
 *     top set carries isAmrap === true plus a non-empty, brand-pure cue.
 *   - STRENGTH_ANCHOR deload week: the top set is explicitly isAmrap === false
 *     with no AMRAP cue (deload never solicits an open AMRAP).
 *   - ENDURANCE_ANCHOR + MAINTENANCE (non-soliciting): the top set is
 *     isAmrap === false (fixed top set protects the shared recovery budget).
 *   - HYPERTROPHY_ANCHOR: excluded — the final set is RIR-anchored
 *     (isAmrap === false), governed by ADR 0011.
 *   - Folded secondary slot never carries isAmrap === true.
 */
import { describe, it, expect } from "vitest";
import {
  STRENGTH_ANCHOR,
  ENDURANCE_ANCHOR,
  HYPERTROPHY_ANCHOR,
  CONCURRENT_HYBRID,
  MAINTENANCE,
  buildPrescription,
  type Archetype,
  type StrengthDay,
} from "../archetypes";

const PRIMARY = { id: "p", slug: "p-slug", displayName: "Primary" };
const SECONDARY = { id: "s", slug: "s-slug", displayName: "Secondary" };

const FORBIDDEN = /wendler|531|5\/3\/1|joker|fsl|smolov|stronglifts|gzcl|gvt/i;

function firstStrengthDay(a: Archetype): StrengthDay {
  return a.days.find((d): d is StrengthDay => d.kind === "strength")!;
}

function lastPrimaryMain(items: ReturnType<typeof buildPrescription>) {
  const mains = items.filter(
    (i) => i.kind === "main" && i.movementId === PRIMARY.id,
  );
  return mains[mains.length - 1]!;
}

describe("ADR 0007 — AMRAP top set marker", () => {
  it("STRENGTH_ANCHOR non-deload: primary top set is a true AMRAP with a brand-pure cue", () => {
    const day = firstStrengthDay(STRENGTH_ANCHOR);
    // weekProfiles: last is the deload; iterate non-deload weeks.
    for (let w = 0; w < STRENGTH_ANCHOR.weekProfiles.length - 1; w++) {
      const items = buildPrescription(STRENGTH_ANCHOR, w, day, PRIMARY);
      const last = lastPrimaryMain(items);
      expect(last.isAmrap).toBe(true);
      expect(last.intensityCue).toBeTruthy();
      expect(last.intensityCue!.length).toBeLessThanOrEqual(80);
      expect(last.intensityCue!).not.toMatch(FORBIDDEN);
      // Non-top primary sets are never AMRAP.
      const primaryMains = items.filter(
        (i) => i.kind === "main" && i.movementId === PRIMARY.id,
      );
      for (let i = 0; i < primaryMains.length - 1; i++) {
        expect(primaryMains[i]!.isAmrap).not.toBe(true);
      }
    }
  });

  it("STRENGTH_ANCHOR deload: top set is explicitly NOT an AMRAP and has no AMRAP cue", () => {
    const day = firstStrengthDay(STRENGTH_ANCHOR);
    const deloadWeek = STRENGTH_ANCHOR.weekProfiles.length - 1;
    const items = buildPrescription(STRENGTH_ANCHOR, deloadWeek, day, PRIMARY);
    const last = lastPrimaryMain(items);
    expect(last.isAmrap).toBe(false);
    expect(last.intensityCue).toBeUndefined();
  });

  it("CONCURRENT_HYBRID non-deload: primary top set is a true AMRAP", () => {
    const day = firstStrengthDay(CONCURRENT_HYBRID);
    for (let w = 0; w < CONCURRENT_HYBRID.weekProfiles.length - 1; w++) {
      const items = buildPrescription(CONCURRENT_HYBRID, w, day, PRIMARY);
      const last = lastPrimaryMain(items);
      expect(last.isAmrap).toBe(true);
      expect(last.intensityCue).toBeTruthy();
    }
  });

  it("ENDURANCE_ANCHOR non-deload: top set is explicitly NOT an AMRAP", () => {
    const day = firstStrengthDay(ENDURANCE_ANCHOR);
    const items = buildPrescription(ENDURANCE_ANCHOR, 0, day, PRIMARY);
    const last = lastPrimaryMain(items);
    expect(last.isAmrap).toBe(false);
  });

  it("MAINTENANCE non-deload: top set is explicitly NOT an AMRAP", () => {
    const day = firstStrengthDay(MAINTENANCE);
    const items = buildPrescription(MAINTENANCE, 0, day, PRIMARY);
    const last = lastPrimaryMain(items);
    expect(last.isAmrap).toBe(false);
  });

  it("HYPERTROPHY_ANCHOR non-deload: top set is RIR-anchored, NOT an AMRAP (ADR 0011)", () => {
    const day = firstStrengthDay(HYPERTROPHY_ANCHOR);
    const items = buildPrescription(HYPERTROPHY_ANCHOR, 0, day, PRIMARY);
    const last = lastPrimaryMain(items);
    expect(last.isAmrap).toBe(false);
    expect(last.targetRir).toBeTruthy();
  });

  it("folded secondary slot is never marked as an AMRAP", () => {
    const base = firstStrengthDay(STRENGTH_ANCHOR);
    const dayWithSecondary: StrengthDay = {
      ...base,
      secondaryRole: "vertical_press",
      secondaryMaxSets: STRENGTH_ANCHOR.foldedSecondaryMaxSets ?? 4,
    };
    const items = buildPrescription(
      STRENGTH_ANCHOR,
      0,
      dayWithSecondary,
      PRIMARY,
      undefined,
      SECONDARY,
    );
    const secondaryMains = items.filter(
      (i) => i.kind === "main" && i.movementId === SECONDARY.id,
    );
    expect(secondaryMains.length).toBeGreaterThan(0);
    for (const it of secondaryMains) {
      expect(it.isAmrap).not.toBe(true);
    }
  });
});
