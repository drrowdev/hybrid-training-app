import { describe, it, expect } from "vitest";
import { STEPS } from "../OnboardingWizard";

/**
 * Step-order contract for the onboarding wizard.
 *
 * The order matters because:
 *  - Profile (identity) → Equipment (environment) → Training maxes
 *    (skill-specific numbers) → Connect Strava (optional value-add) →
 *    Start training (hand-off to the platform program picker).
 *  - Onboarding no longer builds a block; the final step marks
 *    onboarding complete and routes the user to /app/program to pick
 *    their first program (ADR 0046 Phase 2 — clean handoff to picker).
 *  - Connect Strava sits second-to-last so the user has already
 *    invested time before being asked to OAuth out to a third party;
 *    earlier placement risks dropoff when the Strava credentials
 *    aren't handy.
 */
describe("OnboardingWizard step machine", () => {
  it("exposes the expected ordered step labels", () => {
    expect([...STEPS]).toEqual([
      "Welcome",
      "Profile",
      "Equipment",
      "Training maxes",
      "Connect Strava",
      "Start training",
    ]);
  });

  it("places Equipment after Profile and before Training maxes", () => {
    const profile = STEPS.indexOf("Profile");
    const equipment = STEPS.indexOf("Equipment");
    const tms = STEPS.indexOf("Training maxes");
    expect(profile).toBeGreaterThanOrEqual(0);
    expect(equipment).toBe(profile + 1);
    expect(tms).toBe(equipment + 1);
  });

  it("no longer includes the retired block-building steps", () => {
    expect(STEPS).not.toContain("Build your block");
    expect(STEPS).not.toContain("Confirm");
  });

  it("places Connect Strava immediately before the final Start training step", () => {
    const strava = STEPS.indexOf("Connect Strava");
    const start = STEPS.indexOf("Start training");
    expect(strava).toBe(STEPS.length - 2);
    expect(start).toBe(strava + 1);
    expect(start).toBe(STEPS.length - 1);
  });
});
