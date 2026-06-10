/**
 * TB2 conditioning library — integrity + helper tests (tests-as-docs).
 */
import { describe, it, expect } from "vitest";
import {
  TB_CONDITIONING_SESSIONS,
  HIC_SESSIONS,
  GC_SESSIONS,
  POWER_SESSIONS,
  getTbSession,
  sessionsByCategory,
  sessionsByEquipment,
  suggestForGreenSlot,
} from "./index";

describe("library integrity", () => {
  it("has unique ids", () => {
    const ids = TB_CONDITIONING_SESSIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every session has at least one step and a source", () => {
    for (const s of TB_CONDITIONING_SESSIONS) {
      expect(s.steps.length).toBeGreaterThan(0);
      expect(s.source.length).toBeGreaterThan(0);
      expect(s.equipment.length).toBeGreaterThan(0);
    }
  });

  it("covers the expected category counts", () => {
    expect(sessionsByCategory("endurance")).toHaveLength(8);
    expect(sessionsByCategory("hic")).toHaveLength(20);
    expect(sessionsByCategory("gc")).toHaveLength(12);
    expect(sessionsByCategory("power")).toHaveLength(4);
    expect(sessionsByCategory("core-grip")).toHaveLength(4);
    expect(sessionsByCategory("challenge")).toHaveLength(5);
  });
});

describe("HIC master numbering", () => {
  it("numbers HICs 1–20 contiguously", () => {
    const nums = HIC_SESSIONS.map((s) => s.hicNumber).sort((a, b) => a! - b!);
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("documents the #21–24 gap (GC resumes at #25, power ends at #40)", () => {
    const all = [...HIC_SESSIONS, ...GC_SESSIONS, ...POWER_SESSIONS]
      .map((s) => s.hicNumber!)
      .sort((a, b) => a - b);
    // #21–24 are intentionally absent until recovered from the TB2 book.
    expect(all).not.toContain(21);
    expect(all).not.toContain(24);
    expect(Math.min(...GC_SESSIONS.map((s) => s.hicNumber!))).toBe(25);
    expect(Math.max(...POWER_SESSIONS.map((s) => s.hicNumber!))).toBe(40);
  });

  it("hicNumbers are unique across the master list", () => {
    const nums = [...HIC_SESSIONS, ...GC_SESSIONS, ...POWER_SESSIONS].map((s) => s.hicNumber!);
    expect(new Set(nums).size).toBe(nums.length);
  });
});

describe("lookups + filters", () => {
  it("getTbSession resolves by id", () => {
    expect(getTbSession("apex-hills")?.name).toBe("Apex Hills");
    expect(getTbSession("nope")).toBeUndefined();
  });

  it("sessionsByEquipment only returns fully-satisfiable sessions", () => {
    const bodyweightOnly = sessionsByEquipment(["bodyweight"]);
    expect(bodyweightOnly.every((s) => s.equipment.every((e) => e === "bodyweight"))).toBe(true);
    expect(bodyweightOnly.map((s) => s.id)).toContain("gc-1-beat-your-face");
  });
});

describe("Green Protocol slot suggestions", () => {
  it("hill slot returns only hill-based sessions (Apex, Bloody Lungs, Short Hills…)", () => {
    const hill = suggestForGreenSlot("hill");
    expect(hill.every((s) => s.equipment.includes("hill"))).toBe(true);
    expect(hill.map((s) => s.id)).toEqual(expect.arrayContaining(["apex-hills", "bloody-lungs", "short-hills"]));
  });

  it("speed slot returns run/sprint intervals, never hill sessions", () => {
    const speed = suggestForGreenSlot("speed");
    expect(speed.every((s) => !s.equipment.includes("hill"))).toBe(true);
    expect(speed.map((s) => s.id)).toEqual(expect.arrayContaining(["600m-resets", "speed-endurance-ladders", "fast-5-tempo"]));
  });

  it("se slot returns strength-endurance + GC circuits", () => {
    const se = suggestForGreenSlot("se");
    expect(se.map((s) => s.id)).toContain("se-circuit");
    expect(se.some((s) => s.category === "gc")).toBe(true);
  });
});
