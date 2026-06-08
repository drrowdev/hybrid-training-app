/**
 * wizardStateFromPrefill — reverse-map an archetype (+ optional suggestion flag)
 * into the wizard's initial {goal, secondary, step} state.
 *
 * Guards the next-block-suggestion seeding (`?build=<archetype>`): a hybrid
 * suggestion must pre-select strength + cardio and land the user on the FOCUS
 * step (so they see which two focuses make the block), while the legacy
 * "customize a recent block" flow still jumps to day-layout.
 */
import { describe, it, expect } from "vitest";
import { wizardStateFromPrefill, type BlockWizardPrefill } from "../BlockWizard";

function prefill(over: Partial<BlockWizardPrefill> & { archetype: string }): BlockWizardPrefill {
  return { daysPerWeek: 4, dayIndexOverrides: null, ...over };
}

describe("wizardStateFromPrefill", () => {
  it("hybrid suggestion → strength + cardio, lands on the focus step (2)", () => {
    const s = wizardStateFromPrefill(prefill({ archetype: "concurrent_hybrid", fromSuggestion: true }));
    expect(s.goal).toBe("strength");
    expect(s.secondary).toBe("cardio");
    expect(s.step).toBe(2);
    expect(s.days).toBe(4);
  });

  it("hybrid CUSTOMIZE (not a suggestion) keeps the legacy jump to day-layout (4)", () => {
    const s = wizardStateFromPrefill(prefill({ archetype: "concurrent_hybrid" }));
    expect(s.goal).toBe("strength");
    expect(s.secondary).toBe("cardio");
    expect(s.step).toBe(4);
  });

  it("strength suggestion → strength only, focus step", () => {
    const s = wizardStateFromPrefill(prefill({ archetype: "strength_anchor", fromSuggestion: true }));
    expect(s.goal).toBe("strength");
    expect(s.secondary).toBe("skip");
    expect(s.step).toBe(2);
  });

  it("hypertrophy suggestion → muscle, focus step", () => {
    const s = wizardStateFromPrefill(prefill({ archetype: "hypertrophy_anchor", fromSuggestion: true }));
    expect(s.goal).toBe("muscle");
    expect(s.step).toBe(2);
  });
});
