import { describe, expect, it } from "vitest";
import { highStrainPowerBlocked } from "./movement-safety";

describe("DC-D5/DC-O3 existing tendinopathy power gate", () => {
  it.each([
    [true, true, true, true],
    [false, true, true, false],
    [true, false, true, false],
    [true, true, false, false],
  ])("high strain %s, power %s, active tendinopathy %s blocks %s", (highStrainTendon, power, tendinopathyActive, blocked) => {
    expect(highStrainPowerBlocked({ highStrainTendon, power, tendinopathyActive })).toBe(blocked);
  });
});
