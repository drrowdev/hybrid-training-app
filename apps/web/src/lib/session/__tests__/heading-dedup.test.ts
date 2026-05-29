import { describe, it, expect } from "vitest";
import {
  normalizeTitleForDedup,
  stripShorthandSuffix,
  makeShouldHideHeading,
} from "../heading-dedup";

describe("heading-dedup helper", () => {
  describe("normalizeTitleForDedup", () => {
    it("lowercases and trims", () => {
      expect(normalizeTitleForDedup("  Strength A  ")).toBe("strength a");
    });

    it("strips em-dash / en-dash / hyphen-separated suffixes", () => {
      expect(normalizeTitleForDedup("VO2 Intervals — 4×4")).toBe(
        "vo2 intervals",
      );
      expect(normalizeTitleForDedup("VO2 intervals – 4x4")).toBe(
        "vo2 intervals",
      );
      expect(normalizeTitleForDedup("Z2 base - 30 min")).toBe("z2 base");
    });

    it("returns empty string for nullish / empty input", () => {
      expect(normalizeTitleForDedup(null)).toBe("");
      expect(normalizeTitleForDedup(undefined)).toBe("");
      expect(normalizeTitleForDedup("")).toBe("");
    });
  });

  describe("stripShorthandSuffix", () => {
    it("drops the protocol shorthand from a movement name", () => {
      expect(stripShorthandSuffix("VO2 Intervals — 4×4")).toBe(
        "VO2 Intervals",
      );
      expect(stripShorthandSuffix("Z2 base — 30 min")).toBe("Z2 base");
    });

    it("returns the original name when there is no suffix", () => {
      expect(stripShorthandSuffix("Front Squat")).toBe("Front Squat");
    });
  });

  describe("makeShouldHideHeading", () => {
    it("matches case-insensitively + ignores shorthand suffix", () => {
      const should = makeShouldHideHeading("VO2 intervals");
      expect(should("VO2 Intervals — 4×4")).toBe(true);
      expect(should("VO2 Intervals")).toBe(true);
      expect(should("Front Squat")).toBe(false);
    });

    it("returns false for any input when the page title is missing", () => {
      const should = makeShouldHideHeading(null);
      expect(should("Anything")).toBe(false);
      expect(should("")).toBe(false);
    });
  });
});
