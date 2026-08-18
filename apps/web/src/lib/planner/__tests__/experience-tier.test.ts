/**
 * PR W2 — canonical experience-tier mapping.
 *
 * Pin the integer values so the seed migration, the SQL CHECK
 * constraint, and the runtime filter all agree on the scale. The
 * mapping shipped in this file is read by every movement-selection
 * surface (accessory picker, main-lift resolver, power potentiation,
 * cardio resolver) — changing it without updating the migration
 * breaks the band invariants in the catalog.
 */
import { describe, it, expect } from "vitest";
import { declaredExperienceToTier, tierInBand } from "../experience-tier";
import { resolveDeclaredExperience } from "../build-block-assembly-context";

describe("declaredExperienceToTier", () => {
  it("maps beginner_lt_6m → 0", () => {
    expect(declaredExperienceToTier("beginner_lt_6m")).toBe(0);
  });
  it("maps novice_6m_2y → 1", () => {
    expect(declaredExperienceToTier("novice_6m_2y")).toBe(1);
  });
  it("maps intermediate_2y_5y → 2", () => {
    expect(declaredExperienceToTier("intermediate_2y_5y")).toBe(2);
  });
  it("maps advanced_5y_10y → 3", () => {
    expect(declaredExperienceToTier("advanced_5y_10y")).toBe(3);
  });
  it("maps highly_advanced_10y_plus → 4", () => {
    expect(declaredExperienceToTier("highly_advanced_10y_plus")).toBe(4);
  });
  it("null input → null (no-filter sentinel)", () => {
    expect(declaredExperienceToTier(null)).toBeNull();
  });
  it("undefined input → null (no-filter sentinel)", () => {
    expect(declaredExperienceToTier(undefined)).toBeNull();
  });
});

describe("tierInBand", () => {
  it("null tier always passes (no-filter default)", () => {
    expect(tierInBand(null, 2, 4)).toBe(true);
    expect(tierInBand(null, 0, 0)).toBe(true);
  });
  it("tier inside band is allowed", () => {
    expect(tierInBand(2, 0, 4)).toBe(true);
    expect(tierInBand(0, 0, 4)).toBe(true);
    expect(tierInBand(4, 0, 4)).toBe(true);
  });
  it("tier below min is rejected", () => {
    expect(tierInBand(0, 2, 4)).toBe(false);
    expect(tierInBand(1, 2, 4)).toBe(false);
  });
  it("tier above max is rejected", () => {
    expect(tierInBand(3, 0, 2)).toBe(false);
    expect(tierInBand(4, 0, 2)).toBe(false);
  });
});

/**
 * Regression: the event recovery-window path used to hand-roll its own
 * `training_experience` -> tier lookup keyed on `untrained | novice |
 * intermediate | advanced | elite`. Those names stopped being the column's
 * values at migration 0052, so every lookup missed and pinned EVERY user to
 * tier 2 — `computeRecoveryWindow`'s TIER_MULT never varied by experience.
 *
 * It now composes `resolveDeclaredExperience` + `declaredExperienceToTier`.
 * These pins fail if anything reintroduces the legacy scale or drops a tier.
 */
describe("declared experience -> tier, as the recovery-window path resolves it", () => {
  function profileTier(raw: string | null | undefined): number | null {
    return declaredExperienceToTier(resolveDeclaredExperience(raw));
  }

  it("resolves every stored 5-tier value to a distinct tier", () => {
    expect([
      profileTier("beginner_lt_6m"),
      profileTier("novice_6m_2y"),
      profileTier("intermediate_2y_5y"),
      profileTier("advanced_5y_10y"),
      profileTier("highly_advanced_10y_plus"),
    ]).toEqual([0, 1, 2, 3, 4]);
  });

  it("does not resolve the pre-0052 tier names", () => {
    for (const legacy of ["untrained", "novice", "intermediate", "advanced", "elite"]) {
      expect(profileTier(legacy)).toBeNull();
    }
  });

  it("resolves an absent declaration to null so callers apply their own default", () => {
    expect(profileTier(null)).toBeNull();
    expect(profileTier(undefined)).toBeNull();
    expect(profileTier("")).toBeNull();
  });
});
