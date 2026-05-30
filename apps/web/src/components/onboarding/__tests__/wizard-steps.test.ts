import { describe, it, expect } from "vitest";
import { STEPS } from "../OnboardingWizard";

/**
 * Step-order contract for the onboarding wizard.
 *
 * The order matters because:
 *  - Profile (identity) → Equipment (environment) → Training maxes
 *    (skill-specific numbers) → Build your block (synthesis) →
 *    Connect Strava (optional value-add) → Confirm.
 *  - The block builder downstream consumes both the equipment and the
 *    TMs collected here; reshuffling these steps would mean the picker
 *    runs without equipment context or the BlockWizard runs without
 *    TM readiness signals.
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
      "Build your block",
      "Connect Strava",
      "Confirm",
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

  it("places Equipment before block creation", () => {
    expect(STEPS.indexOf("Equipment")).toBeLessThan(STEPS.indexOf("Build your block"));
  });

  it("places Connect Strava immediately before Confirm", () => {
    const strava = STEPS.indexOf("Connect Strava");
    const confirm = STEPS.indexOf("Confirm");
    const build = STEPS.indexOf("Build your block");
    expect(strava).toBe(build + 1);
    expect(confirm).toBe(strava + 1);
  });
});
