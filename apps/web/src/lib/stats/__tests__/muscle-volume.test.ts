/**
 * Muscle volume helper tests — pure functions, no DB calls.
 */
import { describe, it, expect } from "vitest";
import { BAND_LABEL, BAND_COLOR, type VolumeBand } from "../muscle-volume";

describe("BAND_LABEL", () => {
  it("every band has a plain-English user-facing label", () => {
    const bands: VolumeBand[] = [
      "untouched",
      "below-maintenance",
      "maintaining",
      "building",
      "high-volume",
      "overreaching",
    ];
    for (const b of bands) {
      expect(BAND_LABEL[b]).toBeDefined();
      expect(BAND_LABEL[b].length).toBeGreaterThan(0);
      // No research-jargon leakage.
      expect(BAND_LABEL[b]).not.toMatch(/MV|MEV|MAV|MRV/);
    }
  });

  it("every band has a color token", () => {
    const bands: VolumeBand[] = [
      "untouched",
      "below-maintenance",
      "maintaining",
      "building",
      "high-volume",
      "overreaching",
    ];
    for (const b of bands) {
      expect(BAND_COLOR[b]).toMatch(/^var\(--cp-/);
    }
  });
});
