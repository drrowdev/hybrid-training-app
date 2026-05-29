/**
 * Smoke coverage for the cardio-modality-label helper. Exercises the
 * two derivation paths (metadata.modality first, slug pattern second)
 * and the null fallback that lets the CardioCard suppress the chip
 * when no signal exists.
 */
import { describe, it, expect } from "vitest";
import { cardioModalityLabel } from "../cardio-modality-label";

describe("cardioModalityLabel", () => {
  it("returns the canonical display label for known metadata.modality values", () => {
    expect(cardioModalityLabel({ modality: "running" }, "treadmill-vo2")).toBe(
      "Run",
    );
    expect(cardioModalityLabel({ modality: "cycling" }, "bike-indoor-z2")).toBe(
      "Bike",
    );
    expect(cardioModalityLabel({ modality: "rowing" }, "row-easy")).toBe("Row");
    expect(cardioModalityLabel({ modality: "swimming" }, null)).toBe("Swim");
    expect(cardioModalityLabel({ modality: "rucking" }, null)).toBe("Ruck");
    expect(cardioModalityLabel({ modality: "ski_erg" }, null)).toBe("Ski erg");
  });

  it("falls back to slug pattern matching when metadata is missing", () => {
    expect(cardioModalityLabel(null, "treadmill-vo2-intervals")).toBe("Run");
    expect(cardioModalityLabel({}, "bike-air-tabata")).toBe("Bike");
    expect(cardioModalityLabel({}, "rower-easy-z2")).toBe("Row");
    expect(cardioModalityLabel({}, "swim-200m-repeats")).toBe("Swim");
    expect(cardioModalityLabel({}, "ruck-march-easy")).toBe("Ruck");
    expect(cardioModalityLabel({}, "ski-erg-vo2-intervals")).toBe("Ski erg");
    expect(cardioModalityLabel({}, "jump-rope-skip-conditioning")).toBe(
      "Jump rope",
    );
  });

  it("returns null when neither metadata nor slug carry a recognisable cue", () => {
    expect(cardioModalityLabel(null, null)).toBeNull();
    expect(cardioModalityLabel({}, "")).toBeNull();
    expect(cardioModalityLabel({ modality: "" }, "mystery-conditioning-thing")).toBeNull();
  });
});
