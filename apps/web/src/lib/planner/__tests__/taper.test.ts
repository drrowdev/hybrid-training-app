import { describe, it, expect } from "vitest";
import {
  computeTaperRecommendation,
  taperModalityForEvent,
  type TaperModality,
} from "../taper";

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

function eventOnM(
  daysOut: number,
  modality: TaperModality,
  priority: "A" | "B" | "C" = "A",
) {
  return { ...eventOn(daysOut, priority), modality };
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

describe("ADR 0008 — modality-aware taper", () => {
  it("defaults to the endurance curve when modality is absent (backward compat)", () => {
    // No modality → identical to the legacy behaviour pinned above.
    const r = computeTaperRecommendation(eventOn(3, "A"), TODAY)!;
    expect(r.phase).toBe("polish");
    expect(r.volumeScale).toBe(0.4);
    expect(r.intensityAction).toBe("minimal");
  });

  describe("strength events", () => {
    it("HOLDS intensity in the polish phase (the key fix vs endurance)", () => {
      const r = computeTaperRecommendation(eventOnM(3, "strength"), TODAY)!;
      expect(r.phase).toBe("polish");
      // Endurance drops to "minimal" here; strength keeps heavy singles.
      expect(r.intensityAction).toBe("hold");
      // ~50% cut, not the endurance 60%.
      expect(r.volumeScale).toBe(0.5);
    });

    it("uses a shorter 10-day window — 11d out is outside the taper", () => {
      expect(computeTaperRecommendation(eventOnM(11, "strength"), TODAY)).toBeNull();
      expect(computeTaperRecommendation(eventOnM(10, "strength"), TODAY)).not.toBeNull();
    });

    it("grades volume -30% / -45% / -50% across approach/deep/polish", () => {
      expect(computeTaperRecommendation(eventOnM(9, "strength"), TODAY)!.volumeScale).toBe(0.7);
      expect(computeTaperRecommendation(eventOnM(6, "strength"), TODAY)!.volumeScale).toBe(0.55);
      expect(computeTaperRecommendation(eventOnM(2, "strength"), TODAY)!.volumeScale).toBe(0.5);
    });

    it("day 0 holds intensity for openers/activation (not a runner's rest)", () => {
      const r = computeTaperRecommendation(eventOnM(0, "strength"), TODAY)!;
      expect(r.phase).toBe("event_day");
      expect(r.intensityAction).toBe("hold");
    });
  });

  describe("mixed events", () => {
    it("uses the endurance volume curve but HOLDS intensity in polish", () => {
      const r = computeTaperRecommendation(eventOnM(3, "mixed"), TODAY)!;
      expect(r.phase).toBe("polish");
      // Endurance-depth cut...
      expect(r.volumeScale).toBe(0.4);
      // ...but a heavy primer is retained (hold, not minimal).
      expect(r.intensityAction).toBe("hold");
    });

    it("keeps the 14-day endurance window", () => {
      expect(computeTaperRecommendation(eventOnM(14, "mixed"), TODAY)).not.toBeNull();
      expect(computeTaperRecommendation(eventOnM(15, "mixed"), TODAY)).toBeNull();
    });
  });

  describe("taperModalityForEvent mapping", () => {
    it("maps strength → strength, everything else → endurance", () => {
      expect(taperModalityForEvent("strength")).toBe("strength");
      for (const m of ["run", "bike", "swim", "row", "ski", "padel", "other"]) {
        expect(taperModalityForEvent(m)).toBe("endurance");
      }
      expect(taperModalityForEvent(null)).toBe("endurance");
      expect(taperModalityForEvent(undefined)).toBe("endurance");
    });
  });
});
