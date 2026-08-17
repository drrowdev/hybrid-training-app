import { describe, it, expect } from "vitest";
import { STEPS } from "../OnboardingWizard";

/**
 * Step-order contract for the onboarding wizard.
 *
 * The order matters because:
 *  - Profile (identity) -> Equipment (environment) -> Training maxes
 *    (skill-specific numbers) -> Start training (hand-off to the platform
 *    program picker).
 *  - Onboarding no longer builds a block; the final step marks
 *    onboarding complete and routes the user to /app/program to pick
 *    their first program (ADR 0046 Phase 2 - clean handoff to picker).
 *  - The retired third-party-integration connect step used to sit
 *    second-to-last; it was removed when the integration was retired, so
 *    Training maxes now runs straight into Start training.
 */
describe("OnboardingWizard step machine", () => {
  it("exposes the expected ordered step labels", () => {
    expect([...STEPS]).toEqual([
      "Welcome",
      "Profile",
      "Equipment",
      "Training maxes",
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

  it("places Training maxes immediately before the final Start training step", () => {
    const tms = STEPS.indexOf("Training maxes");
    const start = STEPS.indexOf("Start training");
    expect(tms).toBe(STEPS.length - 2);
    expect(start).toBe(tms + 1);
    expect(start).toBe(STEPS.length - 1);
  });

  it("no longer includes a third-party integration connect step", () => {
    expect(STEPS.some((s) => /strava/i.test(s))).toBe(false);
  });
});
