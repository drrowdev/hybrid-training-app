/**
 * Green Protocol ↔ TB2 library bridge tests.
 */
import { describe, it, expect } from "vitest";
import { suggestTbSessions, isGenericSlot } from "./tb-suggestions";

describe("TB2 session suggestions for Green Protocol slots", () => {
  it("a Hill day offers hill-based TB2 sessions", () => {
    const ids = suggestTbSessions("hill").map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["apex-hills", "bloody-lungs", "short-hills"]));
    expect(suggestTbSessions("hill").every((s) => s.equipment.includes("hill"))).toBe(true);
  });

  it("Peggy and Vert Ladder are hill slots too", () => {
    expect(suggestTbSessions("peggy").length).toBeGreaterThan(0);
    expect(suggestTbSessions("vert-ladder").length).toBeGreaterThan(0);
  });

  it("a Speed day offers run/sprint intervals, never hill sessions", () => {
    const speed = suggestTbSessions("speed");
    expect(speed.length).toBeGreaterThan(0);
    expect(speed.every((s) => !s.equipment.includes("hill"))).toBe(true);
  });

  it("an SE day offers strength-endurance + GC circuits", () => {
    const se = suggestTbSessions("se");
    expect(se.map((s) => s.id)).toContain("se-circuit");
  });

  it("specific sessions (LSS, Long Run, Tempo) get no substitutions", () => {
    expect(suggestTbSessions("lss")).toEqual([]);
    expect(suggestTbSessions("long-run")).toEqual([]);
    expect(suggestTbSessions("tempo")).toEqual([]);
    expect(isGenericSlot("lss")).toBe(false);
    expect(isGenericSlot("hill")).toBe(true);
  });
});
