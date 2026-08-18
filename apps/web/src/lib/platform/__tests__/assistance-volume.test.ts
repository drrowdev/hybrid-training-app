import { describe, expect, it } from "vitest";
import { resolveAssistanceVolume } from "../assistance-volume";

/**
 * Precedence for 5/3/1's per-block assistance volume after it moved out of
 * global settings and into the wizard's Loadout step: wizard → legacy profile
 * column → `standard`.
 */
describe("resolveAssistanceVolume", () => {
  it("takes the wizard's per-block choice when present", () => {
    expect(
      resolveAssistanceVolume({ fromWizard: "high", fromProfile: "low" }),
    ).toBe("high");
    expect(
      resolveAssistanceVolume({ fromWizard: "low", fromProfile: "high" }),
    ).toBe("low");
  });

  it("honours an explicit Balanced wizard choice over the legacy profile value", () => {
    // The wizard writing "standard" is a real user decision, not an absent
    // value — it must not fall through to a stale global preference.
    expect(
      resolveAssistanceVolume({ fromWizard: "standard", fromProfile: "high" }),
    ).toBe("standard");
  });

  it("falls back to the legacy profile preference when the wizard sent nothing", () => {
    // Clients cached from before the field shipped, and edit-mode re-deploys of
    // blocks whose stored setup values have no `assistanceVolume` key.
    expect(
      resolveAssistanceVolume({ fromWizard: undefined, fromProfile: "high" }),
    ).toBe("high");
    expect(
      resolveAssistanceVolume({ fromWizard: null, fromProfile: "low" }),
    ).toBe("low");
  });

  it("defaults to standard when neither source has a usable value", () => {
    expect(
      resolveAssistanceVolume({ fromWizard: undefined, fromProfile: null }),
    ).toBe("standard");
    expect(
      resolveAssistanceVolume({ fromWizard: "", fromProfile: undefined }),
    ).toBe("standard");
  });

  it("ignores unrecognised values from either source", () => {
    expect(
      resolveAssistanceVolume({ fromWizard: "maximum", fromProfile: "harder" }),
    ).toBe("standard");
    expect(
      resolveAssistanceVolume({ fromWizard: 3, fromProfile: "high" }),
    ).toBe("high");
  });
});
