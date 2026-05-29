/**
 * Two-a-day archetype + planner-helper tests.
 *
 * Covers the behaviour required by the constraints encoded in the
 * design-constraints wiki:
 * - DC-D1: ≥6h modality separation lives in the engine pipeline, but the
 *   archetype-level guarantee is that AM and PM never collide and AM is
 *   ordered before PM in the planning pipeline.
 * - DC-D2: same-day ordering — strength-priority focuses (Strength,
 *   Hypertrophy) always put the lift in the AM slot.
 * - DC-L1: VO2 stays single-session in Endurance Anchor (highest-
 *   interference modality; pairing it with anything magnifies cost).
 * - DC-L4: hypertrophy is robust under concurrent load — the Hypertrophy
 *   focus is comfortable adding PM Z2 to multiple lift days.
 *
 * The Rebuild focus intentionally has no two-a-day variant (capped
 * intensity; no benefit from splitting), so allowsTwoADays=true should
 * still return its single-session days.
 */
import { describe, it, expect } from "vitest";
import {
  ARCHETYPES,
  STRENGTH_ANCHOR,
  HYPERTROPHY_ANCHOR,
  ENDURANCE_ANCHOR,
  REBUILD,
  effectiveDays,
  daysForFrequency,
  daySlot,
  daySlotKey,
  minDaysForArchetype,
  maxDaysForArchetype,
} from "../archetypes";

describe("effectiveDays", () => {
  it("returns single-session days when allowsTwoADays = false", () => {
    expect(effectiveDays(STRENGTH_ANCHOR, false)).toBe(STRENGTH_ANCHOR.days);
    expect(effectiveDays(HYPERTROPHY_ANCHOR, false)).toBe(HYPERTROPHY_ANCHOR.days);
    expect(effectiveDays(ENDURANCE_ANCHOR, false)).toBe(ENDURANCE_ANCHOR.days);
  });

  it("returns twoADayDays when allowsTwoADays = true and variant exists", () => {
    expect(effectiveDays(STRENGTH_ANCHOR, true)).toBe(STRENGTH_ANCHOR.twoADayDays);
    expect(effectiveDays(HYPERTROPHY_ANCHOR, true)).toBe(HYPERTROPHY_ANCHOR.twoADayDays);
    expect(effectiveDays(ENDURANCE_ANCHOR, true)).toBe(ENDURANCE_ANCHOR.twoADayDays);
  });

  it("falls back to default days when no twoADayDays variant exists", () => {
    // Rebuild intentionally has no two-a-day variant — capped intensity,
    // single sessions throughout.
    expect(REBUILD.twoADayDays).toBeUndefined();
    expect(effectiveDays(REBUILD, true)).toBe(REBUILD.days);
  });
});

describe("daySlot helper", () => {
  it("defaults missing slot to 'single'", () => {
    const d = STRENGTH_ANCHOR.days[0]!;
    expect(daySlot(d)).toBe("single");
  });

  it("returns the explicit slot when set", () => {
    const amDay = STRENGTH_ANCHOR.twoADayDays!.find((d) => d.slot === "am");
    expect(amDay).toBeDefined();
    expect(daySlot(amDay!)).toBe("am");
  });

  it("daySlotKey distinguishes AM and PM on the same dayIndex", () => {
    const monAm = STRENGTH_ANCHOR.twoADayDays!.find(
      (d) => d.dayIndex === 0 && d.slot === "am",
    )!;
    const monPm = STRENGTH_ANCHOR.twoADayDays!.find(
      (d) => d.dayIndex === 0 && d.slot === "pm",
    )!;
    expect(monAm).toBeDefined();
    expect(monPm).toBeDefined();
    expect(daySlotKey(monAm)).not.toBe(daySlotKey(monPm));
  });
});

describe("DC-D2: strength-priority focuses put the lift in AM", () => {
  it("Strength Anchor: every strength day in twoADayDays is in the AM slot", () => {
    const strengthSlots = STRENGTH_ANCHOR.twoADayDays!.filter((d) => d.kind === "strength");
    expect(strengthSlots.length).toBeGreaterThan(0);
    for (const d of strengthSlots) {
      expect(d.slot).toBe("am");
    }
  });

  it("Hypertrophy Anchor: every strength day in twoADayDays is in the AM slot", () => {
    const strengthSlots = HYPERTROPHY_ANCHOR.twoADayDays!.filter((d) => d.kind === "strength");
    expect(strengthSlots.length).toBeGreaterThan(0);
    for (const d of strengthSlots) {
      expect(d.slot).toBe("am");
    }
  });

  it("Endurance Anchor: strength maintenance still goes in AM (DC-D2 default ordering)", () => {
    const strengthSlots = ENDURANCE_ANCHOR.twoADayDays!.filter((d) => d.kind === "strength");
    expect(strengthSlots.length).toBeGreaterThan(0);
    for (const d of strengthSlots) {
      expect(d.slot).toBe("am");
    }
  });
});

describe("DC-L1: VO2 stays single-session", () => {
  it("Endurance Anchor: VO2 day is never paired with another slot", () => {
    const vo2 = ENDURANCE_ANCHOR.twoADayDays!.find(
      (d) => d.kind === "cardio" && d.cardioKind === "cardio_vo2",
    );
    expect(vo2).toBeDefined();
    expect(vo2!.slot).toBe("single");
    // No other day at the same dayIndex.
    const sameDay = ENDURANCE_ANCHOR.twoADayDays!.filter(
      (d) => d.dayIndex === vo2!.dayIndex,
    );
    expect(sameDay.length).toBe(1);
  });
});

describe("daySlotKey uniqueness across an archetype's day list", () => {
  it.each([
    ["Strength Anchor", STRENGTH_ANCHOR],
    ["Hypertrophy Anchor", HYPERTROPHY_ANCHOR],
    ["Endurance Anchor", ENDURANCE_ANCHOR],
  ] as const)("%s: every (dayIndex, slot) pair is unique", (_name, a) => {
    const keys = a.twoADayDays!.map(daySlotKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("daysForFrequency: AM ordered before PM within a calendar day", () => {
  it("Strength Anchor two-a-day variant: AM strength precedes PM cardio", () => {
    const out = daysForFrequency(STRENGTH_ANCHOR, 4, true);
    // Find each calendar day with multiple slots and verify AM is first.
    const byDay = new Map<number, typeof out>();
    for (const d of out) {
      const list = byDay.get(d.dayIndex) ?? [];
      list.push(d);
      byDay.set(d.dayIndex, list);
    }
    for (const [, list] of byDay) {
      if (list.length < 2) continue;
      const idxAm = list.findIndex((d) => d.slot === "am");
      const idxPm = list.findIndex((d) => d.slot === "pm");
      if (idxAm >= 0 && idxPm >= 0) {
        expect(idxAm).toBeLessThan(idxPm);
      }
    }
  });
});

describe("minDaysForArchetype / maxDaysForArchetype count distinct calendar days", () => {
  it("Strength Anchor single-session: 2 anchor days = 2 min (ADR 0006), 6 total = 6 max", () => {
    // ADR 0006 — bench + OHP demoted to optional; squat + deadlift remain
    // the only anchors, so min calendar days = 2.
    expect(minDaysForArchetype(STRENGTH_ANCHOR, false)).toBe(2);
    expect(maxDaysForArchetype(STRENGTH_ANCHOR, false)).toBe(6);
  });

  it("Strength Anchor two-a-day: 2 anchor calendar days (ADR 0006), max 4 (cardio absorbed)", () => {
    // ADR 0006 — squat AM (day 0) + deadlift AM (day 3) are the only AM
    // anchors after the bench/OHP demotion, so min = 2 distinct days.
    expect(minDaysForArchetype(STRENGTH_ANCHOR, true)).toBe(2);
    expect(maxDaysForArchetype(STRENGTH_ANCHOR, true)).toBe(4);
  });

  it("Rebuild stays single-session regardless of allowsTwoADays", () => {
    const minA = minDaysForArchetype(REBUILD, false);
    const minB = minDaysForArchetype(REBUILD, true);
    expect(minA).toBe(minB);
    const maxA = maxDaysForArchetype(REBUILD, false);
    const maxB = maxDaysForArchetype(REBUILD, true);
    expect(maxA).toBe(maxB);
  });

  // ── isBodyweightOnly override (PR: fix/bw-wizard-copy-and-min-days) ──
  // BW users don't follow the anchor-day floor because the prescription
  // engine packs ~3 main families per session via bw-family-rotation.ts
  // (PR #93). The min-days gate collapses to a flat floor of 2 so 3-day
  // BW blocks are viable for any archetype while a 1-day block still
  // can't be selected.
  describe("isBodyweightOnly override", () => {
    it("Strength Anchor: BW override returns ≤ 3 (was 4)", () => {
      const min = minDaysForArchetype(STRENGTH_ANCHOR, false, true);
      expect(min).toBeLessThanOrEqual(3);
      expect(min).toBe(2);
    });

    it("Hypertrophy Anchor: BW override returns ≤ 3", () => {
      const min = minDaysForArchetype(HYPERTROPHY_ANCHOR, false, true);
      expect(min).toBeLessThanOrEqual(3);
      expect(min).toBe(2);
    });

    it("Endurance Anchor: BW override returns ≤ 3", () => {
      const min = minDaysForArchetype(ENDURANCE_ANCHOR, false, true);
      expect(min).toBeLessThanOrEqual(3);
      expect(min).toBe(2);
    });

    it("Rebuild: BW override returns ≤ 3", () => {
      const min = minDaysForArchetype(REBUILD, false, true);
      expect(min).toBeLessThanOrEqual(3);
      expect(min).toBe(2);
    });

    it("Non-BW path is unchanged when isBodyweightOnly=false", () => {
      // ADR 0006 — STRENGTH_ANCHOR non-BW min is now 2 (was 4 pre-demotion).
      expect(minDaysForArchetype(STRENGTH_ANCHOR, false, false)).toBe(2);
      expect(minDaysForArchetype(STRENGTH_ANCHOR, false)).toBe(2);
    });

    it("BW override ignores allowsTwoADays (BW users don't run AM/PM splits)", () => {
      expect(minDaysForArchetype(STRENGTH_ANCHOR, true, true)).toBe(2);
      expect(minDaysForArchetype(STRENGTH_ANCHOR, false, true)).toBe(2);
    });
  });
});

describe("daysForFrequency: distinct-day budgeting under two-a-day", () => {
  it("Strength Anchor at min frequency (4 days) returns all anchors including PM pairs", () => {
    const days = daysForFrequency(STRENGTH_ANCHOR, 4, true);
    // All four strength AM days must be present.
    const strengthDays = days.filter((d) => d.kind === "strength");
    expect(strengthDays.length).toBe(4);
    // All present strength days must be in AM slot.
    for (const d of strengthDays) expect(d.slot).toBe("am");
  });

  it("daysForFrequency at full frequency includes both AM lift and PM cardio on doubled days", () => {
    const days = daysForFrequency(STRENGTH_ANCHOR, 4, true);
    // Mon (dayIndex 0) should have both AM lift + PM cardio.
    const mon = days.filter((d) => d.dayIndex === 0);
    expect(mon.length).toBeGreaterThanOrEqual(1);
    const monAm = mon.find((d) => d.slot === "am");
    const monPm = mon.find((d) => d.slot === "pm");
    expect(monAm?.kind).toBe("strength");
    // Mon should pair with PM cardio in the curated variant.
    expect(monPm).toBeDefined();
    expect(monPm?.kind).toBe("cardio");
  });
});

describe("ARCHETYPES registry shape", () => {
  it("ARCHETYPES contains all six curated focuses", () => {
    expect(Object.keys(ARCHETYPES).sort()).toEqual(
      [
        "concurrent_hybrid",
        "endurance_anchor",
        "hypertrophy_anchor",
        "maintenance",
        "rebuild",
        "strength_anchor",
      ].sort(),
    );
  });
});
