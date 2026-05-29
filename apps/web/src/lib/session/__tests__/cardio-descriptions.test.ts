import { describe, it, expect } from "vitest";
import {
  CARDIO_DESCRIPTIONS,
  GENERIC_CARDIO_DESCRIPTION,
  describeCardioKind,
} from "../cardio-descriptions";

describe("CARDIO_DESCRIPTIONS lookup", () => {
  it("covers each engine cardio_ kind the planner can emit", () => {
    const expected = [
      "cardio_vo2",
      "cardio_z2",
      "cardio_threshold",
      "cardio_alactic",
      "cardio_external",
    ] as const;
    for (const k of expected) {
      const text = CARDIO_DESCRIPTIONS[k];
      expect(text, `missing description for ${k}`).toBeTypeOf("string");
      expect(text.length, `description for ${k} is too short`).toBeGreaterThan(
        40,
      );
    }
  });

  it("descriptions never start with the bare engine kind code", () => {
    for (const [kind, text] of Object.entries(CARDIO_DESCRIPTIONS)) {
      expect(text.startsWith(kind)).toBe(false);
    }
  });

  describe("describeCardioKind", () => {
    it("resolves each known kind to its mapped description", () => {
      expect(describeCardioKind("cardio_vo2")).toMatch(/90.95%/);
      expect(describeCardioKind("cardio_z2")).toMatch(/conversation/i);
      expect(describeCardioKind("cardio_alactic")).toMatch(/sprint|sharp/i);
    });

    it("falls back to a generic description for unknown / nullish kinds", () => {
      expect(describeCardioKind(undefined)).toBe(GENERIC_CARDIO_DESCRIPTION);
      expect(describeCardioKind(null)).toBe(GENERIC_CARDIO_DESCRIPTION);
      expect(describeCardioKind("warmup")).toBe(GENERIC_CARDIO_DESCRIPTION);
    });
  });
});
