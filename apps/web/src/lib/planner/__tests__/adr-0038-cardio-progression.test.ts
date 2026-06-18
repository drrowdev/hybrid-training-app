/**
 * ADR 0038 — cardio mesocycle progression.
 *
 * Implements the engine's own documented aerobic-progression spec (research-v2
 * §4): easy-volume creep on Z2 days + a peak-week VO₂ interval-density bump,
 * both scaled to how cardio-dominant the block is. Strength stays held (TB /
 * 5-3-1). These tests pin the tier mapping, the wave segmentation (waves are
 * detected from the repeating intensity-label pattern, not deload separators),
 * the per-tier magnitudes/caps, and the day-breadth rule.
 */
import { describe, it, expect } from "vitest";
import {
  ENDURANCE_ANCHOR,
  CONCURRENT_HYBRID,
  STRENGTH_ANCHOR,
  cardioProgressionTier,
  cardioWaveContext,
  cardioProgressionPlan,
  type CardioDay,
} from "../archetypes";

const cardioDay = (role: string): CardioDay =>
  ENDURANCE_ANCHOR.days.find(
    (d): d is CardioDay => d.kind === "cardio" && d.role === role,
  )!;

const LONG = cardioDay("long_z2"); // run-long-z2, 100 min
const EASY = cardioDay("easy_z2"); // run-easy-z2, 60 min
const BIKE = cardioDay("z2_plus_alactic"); // bike-indoor-z2, 45 min
const VO2 = cardioDay("vo2_intervals"); // run-vo2-4x4, 35 min, peakWeek 5×4/42

const planFor = (
  day: CardioDay,
  weekIndex: number,
  secondaryFocus: string | null,
) =>
  cardioProgressionPlan({
    day,
    archetype: ENDURANCE_ANCHOR,
    weekIndex,
    secondaryFocus,
  });

describe("ADR 0038 — cardioProgressionTier", () => {
  it("endurance is pure cardio with none/cardio secondary", () => {
    expect(cardioProgressionTier("endurance_anchor", null)).toBe("pure");
    expect(cardioProgressionTier("endurance_anchor", "none")).toBe("pure");
    expect(cardioProgressionTier("endurance_anchor", "cardio")).toBe("pure");
  });
  it("endurance is mixed with a strength/muscle secondary", () => {
    expect(cardioProgressionTier("endurance_anchor", "strength")).toBe("mixed");
    expect(cardioProgressionTier("endurance_anchor", "muscle")).toBe("mixed");
  });
  it("concurrent_hybrid is balanced; strength-led / custom is none", () => {
    expect(cardioProgressionTier("concurrent_hybrid", "none")).toBe("balanced");
    expect(cardioProgressionTier("strength_anchor", "cardio")).toBe("none");
    expect(cardioProgressionTier("custom", null)).toBe("none");
  });
});

describe("ADR 0038 — cardioWaveContext (label-repeat segmentation)", () => {
  it("splits the concatenated build waves at the repeating first label", () => {
    const p = ENDURANCE_ANCHOR.weekProfiles;
    // Weeks 0-2 = wave 1, 3-5 = wave 2 (Maintenance base/build/peak ×2), 6 deload.
    expect(cardioWaveContext(p, 0)).toMatchObject({ positionInWave: 0, isPeakWeek: false, isDeload: false });
    expect(cardioWaveContext(p, 2)).toMatchObject({ positionInWave: 2, isPeakWeek: true });
    expect(cardioWaveContext(p, 3)).toMatchObject({ positionInWave: 0, isPeakWeek: false });
    expect(cardioWaveContext(p, 5)).toMatchObject({ positionInWave: 2, isPeakWeek: true });
    expect(cardioWaveContext(p, 6).isDeload).toBe(true);
  });
});

describe("ADR 0038 — mixed tier (endurance + strength secondary)", () => {
  it("creeps the long Z2 only, +5%/step, resetting each wave", () => {
    expect(planFor(LONG, 0, "strength")).toBeNull(); // base week
    expect(planFor(LONG, 1, "strength")?.durationMinOverride).toBe(105);
    expect(planFor(LONG, 2, "strength")?.durationMinOverride).toBe(110);
    expect(planFor(LONG, 3, "strength")).toBeNull(); // wave 2 base — reset
    expect(planFor(LONG, 4, "strength")?.durationMinOverride).toBe(105);
    expect(planFor(LONG, 5, "strength")?.durationMinOverride).toBe(110);
  });
  it("does NOT creep the short easy days", () => {
    expect(planFor(EASY, 1, "strength")).toBeNull();
    expect(planFor(BIKE, 2, "strength")).toBeNull();
  });
  it("bumps VO₂ density on peak weeks only (4×4 → 5×4)", () => {
    expect(planFor(VO2, 1, "strength")).toBeNull();
    const peak = planFor(VO2, 2, "strength");
    expect(peak?.durationMinOverride).toBe(42);
    expect(peak?.protocolNoteOverride).toContain("5 × 4 min");
  });
});

describe("ADR 0038 — pure tier (endurance, no strength secondary)", () => {
  it("creeps ALL easy Z2 days at +10%/step, capped at +20%", () => {
    expect(planFor(LONG, 1, "none")?.durationMinOverride).toBe(110);
    expect(planFor(LONG, 2, "none")?.durationMinOverride).toBe(120); // +20% cap
    expect(planFor(EASY, 1, "none")?.durationMinOverride).toBe(66);
    expect(planFor(EASY, 2, "none")?.durationMinOverride).toBe(72);
    expect(planFor(BIKE, 2, "none")?.durationMinOverride).toBe(54);
  });
});

describe("ADR 0052 — endurance-bias raises concurrent cardio creep", () => {
  const easyZ2 = CONCURRENT_HYBRID.days.find(
    (d): d is CardioDay => d.kind === "cardio" && d.role === "easy_z2",
  )!;

  it("maps concurrent_hybrid + endurance bias to the endurance_biased tier; else balanced", () => {
    expect(cardioProgressionTier("concurrent_hybrid", "none", "endurance")).toBe("endurance_biased");
    // strength bias is deferred (a no-op this cut) and null is unchanged.
    expect(cardioProgressionTier("concurrent_hybrid", "none", "strength")).toBe("balanced");
    expect(cardioProgressionTier("concurrent_hybrid", "none", null)).toBe("balanced");
  });

  it("creeps the easy Z2 day under endurance bias, but never at baseline", () => {
    let biasedCreeps = 0;
    for (let w = 0; w < CONCURRENT_HYBRID.weekProfiles.length; w++) {
      // Baseline (balanced) never creeps the easy_z2 day (it's not a "long" driver
      // and balanced has includeShortEasy=false) — the byte-identical no-op.
      expect(
        cardioProgressionPlan({ day: easyZ2, archetype: CONCURRENT_HYBRID, weekIndex: w, secondaryFocus: "none" }),
      ).toBeNull();
      const biased = cardioProgressionPlan({
        day: easyZ2,
        archetype: CONCURRENT_HYBRID,
        weekIndex: w,
        secondaryFocus: "none",
        seasonBias: "endurance",
      });
      if (biased?.durationMinOverride != null) {
        expect(biased.durationMinOverride).toBeGreaterThan(easyZ2.durationMin!);
        biasedCreeps++;
      }
    }
    expect(biasedCreeps).toBeGreaterThan(0);
  });

  it("strength bias is a no-op on cardio creep this cut", () => {
    for (let w = 0; w < CONCURRENT_HYBRID.weekProfiles.length; w++) {
      expect(
        cardioProgressionPlan({ day: easyZ2, archetype: CONCURRENT_HYBRID, weekIndex: w, secondaryFocus: "none", seasonBias: "strength" }),
      ).toBeNull();
    }
  });
});

describe("ADR 0038 — invariants", () => {
  it("never progresses on the deload week (ADR 0037 owns it)", () => {
    for (const d of [LONG, EASY, BIKE, VO2]) {
      expect(planFor(d, 6, "none")).toBeNull();
      expect(planFor(d, 6, "strength")).toBeNull();
    }
  });
  it("is a full no-op for a strength-led archetype (tier none)", () => {
    const sCardio = STRENGTH_ANCHOR.days.find(
      (d): d is CardioDay => d.kind === "cardio",
    );
    if (sCardio) {
      for (let w = 0; w < STRENGTH_ANCHOR.weekProfiles.length; w++) {
        expect(
          cardioProgressionPlan({ day: sCardio, archetype: STRENGTH_ANCHOR, weekIndex: w, secondaryFocus: "cardio" }),
        ).toBeNull();
      }
    }
  });
  it("balanced tier (concurrent_hybrid) creeps the long Z2 only, capped at +10%", () => {
    const long = CONCURRENT_HYBRID.days.find(
      (d): d is CardioDay => d.kind === "cardio" && (d.role ?? "").includes("long"),
    );
    if (long && long.durationMin != null) {
      // pos 2 → +5%×2 = +10% (== cap). Base week is null.
      const peakPlan = cardioProgressionPlan({
        day: long,
        archetype: CONCURRENT_HYBRID,
        weekIndex: 2,
        secondaryFocus: "none",
      });
      if (peakPlan?.durationMinOverride != null) {
        expect(peakPlan.durationMinOverride).toBe(Math.round(long.durationMin * 1.1));
      }
    }
  });
});
