import { describe, expect, it } from "vitest";
import {
  getAdaptationGuidance,
  getAdaptationGuidanceForArchetype,
} from "../adaptation-guidance";

describe("getAdaptationGuidance", () => {
  it("returns null when no goal is chosen", () => {
    expect(getAdaptationGuidance(null, null)).toBeNull();
    expect(getAdaptationGuidance(null, "muscle")).toBeNull();
  });

  it("returns the named (goal, secondary) combinations with the expected blocks/weeks", () => {
    const cases: Array<{
      goal: Parameters<typeof getAdaptationGuidance>[0];
      secondary: Parameters<typeof getAdaptationGuidance>[1];
      blocks: [number, number];
      weeks: [number, number];
    }> = [
      { goal: "strength", secondary: "muscle", blocks: [2, 3], weeks: [8, 12] },
      { goal: "strength", secondary: "cardio", blocks: [2, 3], weeks: [8, 12] },
      { goal: "strength", secondary: "skip", blocks: [2, 2], weeks: [8, 8] },
      { goal: "muscle", secondary: "strength", blocks: [2, 4], weeks: [8, 16] },
      { goal: "muscle", secondary: "cardio", blocks: [3, 4], weeks: [12, 16] },
      { goal: "muscle", secondary: "skip", blocks: [2, 3], weeks: [8, 12] },
      { goal: "cardio", secondary: "strength", blocks: [3, 4], weeks: [12, 16] },
      { goal: "cardio", secondary: "muscle", blocks: [3, 4], weeks: [12, 16] },
      { goal: "cardio", secondary: "skip", blocks: [3, 3], weeks: [12, 12] },
    ];
    for (const c of cases) {
      const g = getAdaptationGuidance(c.goal, c.secondary);
      expect(g, `${c.goal}/${c.secondary}`).not.toBeNull();
      expect(g!.blocks).toEqual({ min: c.blocks[0], max: c.blocks[1] });
      expect(g!.weeks).toEqual({ min: c.weeks[0], max: c.weeks[1] });
      expect(g!.rotates).toBe(false);
      expect(g!.decayWeeks).toBe(4);
    }
  });

  it("treats null secondary as a single-focus preview before Step 3", () => {
    const g = getAdaptationGuidance("strength", null);
    expect(g).not.toBeNull();
    expect(g!.blocks).toEqual({ min: 2, max: 2 });
    expect(g!.weeks).toEqual({ min: 8, max: 8 });
  });

  it("treats the maintenance shortcut as the single-focus row", () => {
    const a = getAdaptationGuidance("muscle", "maintenance");
    const b = getAdaptationGuidance("muscle", "skip");
    expect(a).toEqual(b);
  });

  it("returns the tendon row for resilience regardless of secondary", () => {
    const g = getAdaptationGuidance("resilience", null);
    expect(g).not.toBeNull();
    expect(g!.rotates).toBe(true);
    expect(g!.blocks.min).toBe(4);
    expect(g!.blocks.max).toBe(Infinity);
    expect(g!.weeks.min).toBe(16);
    expect(g!.summary).toMatch(/tendon/i);
    expect(getAdaptationGuidance("resilience", "skip")).toEqual(g);
  });

  it("summary contains both the block count and the week range", () => {
    const g = getAdaptationGuidance("muscle", "strength")!;
    expect(g.summary).toContain("2–4 blocks");
    expect(g.summary).toContain("~8–16 weeks");
  });

  it("summary mentions the decay window when present", () => {
    const g = getAdaptationGuidance("strength", "muscle")!;
    expect(g.summary).toMatch(/hold ~4 weeks/);
  });

  it("derives concurrent guidance from concurrent_hybrid archetype, tendon from rebuild, and null for maintenance", () => {
    const conc = getAdaptationGuidanceForArchetype("concurrent_hybrid")!;
    expect(conc.rotates).toBe(true);
    expect(conc.summary).toMatch(/rotate/i);

    const reb = getAdaptationGuidanceForArchetype("rebuild")!;
    expect(reb.rotates).toBe(true);
    expect(reb.summary).toMatch(/tendon/i);

    expect(getAdaptationGuidanceForArchetype("maintenance")).toBeNull();
    expect(getAdaptationGuidanceForArchetype("custom")).toBeNull();

    const str = getAdaptationGuidanceForArchetype("strength_anchor")!;
    expect(str.blocks).toEqual({ min: 2, max: 2 });
  });
});
