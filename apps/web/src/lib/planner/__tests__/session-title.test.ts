import { describe, it, expect } from "vitest";
import { descriptiveSessionTitle } from "../session-title";

describe("descriptiveSessionTitle", () => {
  it("prefixes strength days with the modality and the main lift(s)", () => {
    expect(descriptiveSessionTitle("strength", "Front Squat", false)).toBe(
      "Strength · Front Squat",
    );
    expect(
      descriptiveSessionTitle(
        "strength",
        "Front Squat + Standing Overhead Press",
        false,
      ),
    ).toBe("Strength · Front Squat + Standing Overhead Press");
  });

  it("prefixes cardio and tendon days with their modality", () => {
    expect(descriptiveSessionTitle("cardio", "VO2 intervals", false)).toBe(
      "Cardio · VO2 intervals",
    );
    expect(descriptiveSessionTitle("tendon", "HSR — knee", false)).toBe(
      "Tendon · HSR — knee",
    );
  });

  it("keeps the (deload) suffix after the focus", () => {
    expect(descriptiveSessionTitle("strength", "Front Squat", true)).toBe(
      "Strength · Front Squat (deload)",
    );
  });
});
