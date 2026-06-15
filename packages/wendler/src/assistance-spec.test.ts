import { describe, it, expect } from "vitest";
import {
  assistanceLevelForSupplemental,
  buildAssistanceIntent,
  shiftAssistanceLevel,
} from "./assistance-spec";

describe("buildAssistanceIntent — set counts per level", () => {
  it("none → no items", () => {
    expect(buildAssistanceIntent("none")).toEqual([]);
  });

  it("light / standard / high → 3 categories at 2 / 3 / 4 sets", () => {
    expect(buildAssistanceIntent("light").every((i) => i.sets === 2)).toBe(true);
    expect(buildAssistanceIntent("standard").every((i) => i.sets === 3)).toBe(true);
    expect(buildAssistanceIntent("high").every((i) => i.sets === 4)).toBe(true);
    for (const lvl of ["light", "standard", "high"] as const) {
      const items = buildAssistanceIntent(lvl);
      expect(items.map((i) => i.assistanceCategory)).toEqual([
        "push",
        "pull",
        "single_leg_or_core",
      ]);
    }
  });
});

describe("shiftAssistanceLevel — global accessory-volume preference", () => {
  it("Balanced (standard) is the identity for every base", () => {
    for (const base of ["none", "light", "standard", "high"] as const) {
      expect(shiftAssistanceLevel(base, "standard")).toBe(base);
    }
  });

  it("Easier (low) shifts one notch lighter, floored at light", () => {
    expect(shiftAssistanceLevel("high", "low")).toBe("standard");
    expect(shiftAssistanceLevel("standard", "low")).toBe("light");
    expect(shiftAssistanceLevel("light", "low")).toBe("light"); // floor
  });

  it("Harder (high) shifts one notch heavier, capped at high", () => {
    expect(shiftAssistanceLevel("light", "high")).toBe("standard");
    expect(shiftAssistanceLevel("standard", "high")).toBe("high");
    expect(shiftAssistanceLevel("high", "high")).toBe("high"); // cap
  });

  it("never resurrects assistance from none (jack-shit stays none)", () => {
    expect(shiftAssistanceLevel("none", "low")).toBe("none");
    expect(shiftAssistanceLevel("none", "high")).toBe("none");
  });

  it("composes with the template base — Easier trims a standard template to light", () => {
    // A default (non-BBB) template is standard; Easier should drop it to light.
    const base = assistanceLevelForSupplemental("fsl");
    expect(base).toBe("standard");
    expect(shiftAssistanceLevel(base, "low")).toBe("light");
    // BBB is already light; Easier floors there (no change).
    expect(shiftAssistanceLevel(assistanceLevelForSupplemental("bbb"), "low")).toBe("light");
  });
});
