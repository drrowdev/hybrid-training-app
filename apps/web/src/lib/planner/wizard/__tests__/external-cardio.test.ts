import { describe, it, expect } from "vitest";
import { initialWizardState, wizardReducer } from "../wizard-state";

/**
 * Phase 1 "external cardio" — wizard-state coverage. The reducer is
 * the single source of truth for the step-3 toggle + the optional
 * program-name field. Pre-fill from `profile.preferred_cardio_source`
 * is handled at the component layer (BlockWizard's initializer) — see
 * the BlockWizard prop-shape test below.
 */
describe("wizardReducer — externalCardio", () => {
  it("defaults to externalCardio=false with an empty program name", () => {
    expect(initialWizardState.externalCardio).toBe(false);
    expect(initialWizardState.externalCardioName).toBe("");
  });

  it("toggle-external-cardio flips the boolean without touching other fields", () => {
    const after = wizardReducer(initialWizardState, { type: "toggle-external-cardio" });
    expect(after.externalCardio).toBe(true);
    // Sanity: didn't disturb step / goal / secondary etc.
    expect(after.step).toBe(initialWizardState.step);
    expect(after.goal).toBe(initialWizardState.goal);
    expect(after.secondary).toBe(initialWizardState.secondary);
    const toggledOff = wizardReducer(after, { type: "toggle-external-cardio" });
    expect(toggledOff.externalCardio).toBe(false);
  });

  it("set-external-cardio-name replaces the stored label", () => {
    const after = wizardReducer(initialWizardState, {
      type: "set-external-cardio-name",
      name: "Runna",
    });
    expect(after.externalCardioName).toBe("Runna");
    const renamed = wizardReducer(after, {
      type: "set-external-cardio-name",
      name: "Hal Higdon",
    });
    expect(renamed.externalCardioName).toBe("Hal Higdon");
  });

  it("toggling external cardio off preserves the typed program name in state", () => {
    // The wizard only sends the name to the server when the toggle is
    // on; keeping it in local state means the user doesn't lose their
    // typed program name if they toggle off and back on by accident.
    const named = wizardReducer(initialWizardState, {
      type: "set-external-cardio-name",
      name: "Garmin Coach",
    });
    const on = wizardReducer(named, { type: "toggle-external-cardio" });
    const off = wizardReducer(on, { type: "toggle-external-cardio" });
    expect(off.externalCardio).toBe(false);
    expect(off.externalCardioName).toBe("Garmin Coach");
  });
});
