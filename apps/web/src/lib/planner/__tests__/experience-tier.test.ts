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
