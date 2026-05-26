/**
 * PR W2 — cardio resolution Surface D (Option α).
 *
 * Verifies `resolveCardioSlugForTier` swaps the prescribed VO2 4×4
 * slug for an easier alternate when the user's declared tier sits
 * below the band where VO2 work is appropriate (tier 0 → easy Z2,
 * tier 1 → tempo).
 */
import { describe, it, expect } from "vitest";
import {
  resolveCardioSlugForTier,
  requiredCardioSlugs,
  ENDURANCE_ANCHOR,
  type CardioDay,
} from "../archetypes";
import { declaredExperienceToTier } from "../experience-tier";

function cardioDay(over: Partial<CardioDay> = {}): CardioDay {
  return {
    kind: "cardio",
    dayIndex: 4,
    role: "vo2_intervals",
    title: "VO2 intervals",
    movementSlug: "run-vo2-4x4",
    movementSlugByExperience: { 0: "run-easy-z2", 1: "run-tempo" },
    cardioKind: "cardio_vo2",
    durationMin: 35,
    priority: "anchor",
    rank: 2,
    ...over,
  };
}

describe("resolveCardioSlugForTier — Option α tier-aware swap", () => {
  it("beginner (tier 0) resolves to run-easy-z2", () => {
    const tier = declaredExperienceToTier("beginner_lt_6m");
    expect(resolveCardioSlugForTier(cardioDay(), tier)).toBe("run-easy-z2");
  });

  it("novice (tier 1) resolves to run-tempo", () => {
    const tier = declaredExperienceToTier("novice_6m_2y");
    expect(resolveCardioSlugForTier(cardioDay(), tier)).toBe("run-tempo");
  });

  it("intermediate (tier 2) resolves to the default run-vo2-4x4", () => {
    const tier = declaredExperienceToTier("intermediate_2y_5y");
    expect(resolveCardioSlugForTier(cardioDay(), tier)).toBe("run-vo2-4x4");
  });

  it("advanced (tier 3) resolves to the default run-vo2-4x4", () => {
    const tier = declaredExperienceToTier("advanced_5y_10y");
    expect(resolveCardioSlugForTier(cardioDay(), tier)).toBe("run-vo2-4x4");
  });

  it("highly advanced (tier 4) resolves to the default run-vo2-4x4", () => {
    const tier = declaredExperienceToTier("highly_advanced_10y_plus");
    expect(resolveCardioSlugForTier(cardioDay(), tier)).toBe("run-vo2-4x4");
  });

  it("null tier (no declaration) resolves to the default slug", () => {
    expect(resolveCardioSlugForTier(cardioDay(), null)).toBe("run-vo2-4x4");
  });

  it("falls back to default when the map omits the user's tier", () => {
    const day = cardioDay({ movementSlugByExperience: { 0: "run-easy-z2" } });
    const tier = declaredExperienceToTier("novice_6m_2y");
    expect(resolveCardioSlugForTier(day, tier)).toBe("run-vo2-4x4");
  });

  it("days without movementSlugByExperience always resolve to the default", () => {
    const plain: CardioDay = {
      kind: "cardio",
      dayIndex: 1,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 45,
      priority: "anchor",
      rank: 1,
    };
    for (const t of [0, 1, 2, 3, 4, null] as const) {
      expect(resolveCardioSlugForTier(plain, t)).toBe("bike-indoor-z2");
    }
  });

  it("requiredCardioSlugs preloads every per-tier alternate into the catalog query", () => {
    const slugs = new Set(requiredCardioSlugs(ENDURANCE_ANCHOR));
    // The VO2 day's defaults + alternates both belong to the lookup pool.
    expect(slugs.has("run-vo2-4x4")).toBe(true);
    expect(slugs.has("run-easy-z2")).toBe(true);
    expect(slugs.has("run-tempo")).toBe(true);
  });
});
