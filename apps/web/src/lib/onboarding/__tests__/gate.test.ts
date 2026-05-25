import { describe, it, expect } from "vitest";
import { needsOnboarding, buildProfileUpdate } from "../gate";

describe("needsOnboarding gate", () => {
  it("redirects a brand-new user (no TMs, no onboarded_at)", () => {
    expect(needsOnboarding({ hasAnyTm: false, onboardedAt: null })).toBe(true);
  });

  it("does NOT redirect a user who explicitly completed onboarding", () => {
    expect(
      needsOnboarding({ hasAnyTm: false, onboardedAt: "2026-01-15T10:00:00Z" }),
    ).toBe(false);
  });

  it("does NOT redirect a user with TMs (grandfathered / migrated)", () => {
    expect(needsOnboarding({ hasAnyTm: true, onboardedAt: null })).toBe(false);
  });

  it("does NOT redirect a user with both signals set", () => {
    expect(
      needsOnboarding({ hasAnyTm: true, onboardedAt: "2026-01-15T10:00:00Z" }),
    ).toBe(false);
  });

  it("re-fires on the next visit if the user bailed (skip path leaves onboardedAt null)", () => {
    const beforeSkip = { hasAnyTm: false, onboardedAt: null };
    expect(needsOnboarding(beforeSkip)).toBe(true);
    expect(needsOnboarding(beforeSkip)).toBe(true);
  });
});

describe("buildProfileUpdate (onboarding step 2 persistence)", () => {
  it("maps every field through to its DB column name", () => {
    const out = buildProfileUpdate({
      displayName: "Mira",
      units: "metric",
      trainingExperience: "intermediate_2y_5y",
      bodyweightKg: 72.5,
    });
    expect(out).toEqual({
      display_name: "Mira",
      units: "metric",
      training_experience: "intermediate_2y_5y",
      bodyweight_kg: 72.5,
    });
  });

  it("normalises empty / whitespace-only display name to null", () => {
    expect(buildProfileUpdate({ displayName: "   " }).display_name).toBeNull();
    expect(buildProfileUpdate({ displayName: "" }).display_name).toBeNull();
  });

  it("preserves null display name as null (explicit clear)", () => {
    expect(buildProfileUpdate({ displayName: null }).display_name).toBeNull();
  });

  it("omits fields that weren't supplied (no accidental clear)", () => {
    const out = buildProfileUpdate({ units: "imperial" });
    expect(out).toEqual({ units: "imperial" });
    expect("display_name" in out).toBe(false);
    expect("training_experience" in out).toBe(false);
    expect("bodyweight_kg" in out).toBe(false);
  });

  it("returns an empty object when given no fields", () => {
    expect(buildProfileUpdate({})).toEqual({});
  });

  it("accepts each declared training_experience tier (DC-G5)", () => {
    for (const tier of [
      "beginner_lt_6m",
      "novice_6m_2y",
      "intermediate_2y_5y",
      "advanced_5y_10y",
      "highly_advanced_10y_plus",
    ] as const) {
      expect(buildProfileUpdate({ trainingExperience: tier }).training_experience).toBe(tier);
    }
  });
});
