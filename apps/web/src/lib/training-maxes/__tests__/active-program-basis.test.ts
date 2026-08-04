import { describe, expect, it } from "vitest";
import { activeProgramTmPercent } from "../active-program-basis";

describe("activeProgramTmPercent", () => {
  it("uses the true 1RM for default Tactical Barbell programs", () => {
    expect(
      activeProgramTmPercent("tactical-barbell", {
        useTrainingMax: false,
        tmPercent: 0.9,
      }),
    ).toBe(100);
  });

  it("uses the selected Tactical Barbell training-max basis", () => {
    expect(
      activeProgramTmPercent("tactical-barbell", {
        useTrainingMax: true,
        tmPercent: 0.9,
      }),
    ).toBe(90);
  });

  it("does not guess another program family's basis", () => {
    expect(activeProgramTmPercent("531", {})).toBeNull();
  });
});
