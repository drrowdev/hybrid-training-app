import { describe, it, expect } from "vitest";
import { computeTaperRecommendation } from "../taper";

// Anchor "today" so tests are deterministic.
const TODAY = new Date("2026-06-01T12:00:00Z");

function eventOn(daysOut: number, priority: "A" | "B" | "C" = "A") {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + daysOut);
  return {
    name: "Test event",
    date: d.toISOString().slice(0, 10),
    priority,
  };
}

describe("computeTaperRecommendation", () => {
  it("returns null when no event", () => {
    expect(computeTaperRecommendation(null, TODAY)).toBeNull();
  });

  it("returns null for C-priority events (no taper for C)", () => {
    expect(computeTaperRecommendation(eventOn(7, "C"), TODAY)).toBeNull();
  });

  it("returns null when event is more than 14 days out (A)", () => {
    expect(computeTaperRecommendation(eventOn(15, "A"), TODAY)).toBeNull();
  });

  it("returns null when event already past", () => {
    expect(computeTaperRecommendation(eventOn(-1, "A"), TODAY)).toBeNull();
  });

  it("14d out -> approach phase, volume scale 0.8, hold intensity", () => {
    const r = computeTaperRecommendation(eventOn(14, "A"), TODAY)!;
    expect(r.phase).toBe("approach");
    expect(r.volumeScale).toBe(0.8);
    expect(r.intensityAction).toBe("hold");
  });

  it("7d out -> deep phase, volume scale 0.6", () => {
    const r = computeTaperRecommendation(eventOn(7, "A"), TODAY)!;
    expect(r.phase).toBe("deep");
    expect(r.volumeScale).toBe(0.6);
  });

  it("3d out -> polish phase, volume scale 0.4, minimal intensity", () => {
    const r = computeTaperRecommendation(eventOn(3, "A"), TODAY)!;
    expect(r.phase).toBe("polish");
    expect(r.volumeScale).toBe(0.4);
    expect(r.intensityAction).toBe("minimal");
  });

  it("event day -> volume 0, minimal intensity", () => {
    const r = computeTaperRecommendation(eventOn(0, "A"), TODAY)!;
    expect(r.phase).toBe("event_day");
    expect(r.volumeScale).toBe(0);
  });

  it("B events get half the volume cut at the approach phase", () => {
    const a = computeTaperRecommendation(eventOn(7, "A"), TODAY)!;
    const b = computeTaperRecommendation(eventOn(7, "B"), TODAY)!;
    // A is -40% (0.6), B is -20% (0.8)
    expect(a.volumeScale).toBe(0.6);
    expect(b.volumeScale).toBe(0.8);
  });

  it("B events use a tighter 7-day window (not 14)", () => {
    expect(computeTaperRecommendation(eventOn(10, "B"), TODAY)).toBeNull();
    expect(computeTaperRecommendation(eventOn(7, "B"), TODAY)).not.toBeNull();
  });

  it("the event name is preserved in the eventName field", () => {
    const r = computeTaperRecommendation(eventOn(5, "A"), TODAY)!;
    expect(r.eventName).toBe("Test event");
    // Event-day headline does include the name.
    const r0 = computeTaperRecommendation(eventOn(0, "A"), TODAY)!;
    expect(r0.headline).toContain("Test event");
  });
});
