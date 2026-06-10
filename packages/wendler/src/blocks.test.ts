/**
 * Periodization model — pins for the ported block / assistance-volume / day
 * helpers. Methodology-calibrated values are asserted against 5/3/1 Forever.
 */
import { describe, it, expect } from "vitest";
import {
  ASSISTANCE_VOLUME_PRESETS,
  resolveAssistanceVolume,
  effectiveAssistanceVolumeForPhase,
  defaultAssistanceVolumeForKind,
  DEFAULT_DAY_ORDER,
  groupDays,
  dayGroupIndex,
  initialCursorWeek,
  totalSessionsInBlock,
  advanceCursor,
  weekStartDate,
  tmPercentForLift,
  type ProgramBlock,
} from "./blocks";

function block(over: Partial<ProgramBlock> = {}): ProgramBlock {
  return {
    id: "b1",
    name: "Leader 1",
    kind: "leader",
    weeksBeforeDeload: 3,
    supplementalTemplate: "fsl",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("assistance volume presets", () => {
  it("are calibrated to the Forever weekly totals", () => {
    expect(ASSISTANCE_VOLUME_PRESETS.minimal).toMatchObject({ mainDayReps: 75, accessoryReps: 225, accessoryMovements: 7 });
    expect(ASSISTANCE_VOLUME_PRESETS.standard).toMatchObject({ mainDayReps: 120, accessoryReps: 300, accessoryMovements: 10 });
    expect(ASSISTANCE_VOLUME_PRESETS.high).toMatchObject({ mainDayReps: 150, accessoryReps: 450, accessoryMovements: 14 });
  });

  it("resolveAssistanceVolume maps presets and passes custom through", () => {
    expect(resolveAssistanceVolume("standard")).toMatchObject({ mainDayReps: 120 });
    const custom = { preset: "custom", mainDayReps: 99, accessoryReps: 1, accessoryMovements: 1 } as const;
    expect(resolveAssistanceVolume(custom)).toEqual(custom);
  });

  it("effectiveAssistanceVolumeForPhase shifts by phase", () => {
    expect(effectiveAssistanceVolumeForPhase("high", "normal")).toBe("high");
    expect(effectiveAssistanceVolumeForPhase("high", "deload")).toBe("minimal");
    expect(effectiveAssistanceVolumeForPhase("standard", "taper")).toBe("minimal");
    // peak: only high demotes a tier
    expect(effectiveAssistanceVolumeForPhase("high", "peak")).toBe("standard");
    expect(effectiveAssistanceVolumeForPhase("standard", "peak")).toBe("standard");
    expect(effectiveAssistanceVolumeForPhase("minimal", "peak")).toBe("minimal");
    // custom is never auto-shifted
    const custom = { preset: "custom", mainDayReps: 99, accessoryReps: 1, accessoryMovements: 1 } as const;
    expect(effectiveAssistanceVolumeForPhase(custom, "deload")).toEqual(custom);
  });

  it("defaultAssistanceVolumeForKind mirrors Forever's block shape", () => {
    expect(defaultAssistanceVolumeForKind("leader")).toBe("standard");
    expect(defaultAssistanceVolumeForKind("anchor")).toBe("high");
    expect(defaultAssistanceVolumeForKind("standalone")).toBe("standard");
    expect(defaultAssistanceVolumeForKind("seventh-week")).toBe("minimal");
  });
});

describe("day order + grouping", () => {
  it("default day order is Press, Deadlift, Bench, Squat", () => {
    expect(DEFAULT_DAY_ORDER).toEqual(["press", "deadlift", "bench", "squat"]);
  });

  it("groupDays chunks by liftsPerDay", () => {
    expect(groupDays(DEFAULT_DAY_ORDER, 1)).toEqual([["press"], ["deadlift"], ["bench"], ["squat"]]);
    expect(groupDays(DEFAULT_DAY_ORDER, 2)).toEqual([["press", "deadlift"], ["bench", "squat"]]);
  });

  it("dayGroupIndex maps a per-lift index to its group", () => {
    expect(dayGroupIndex(0, 1)).toBe(0);
    expect(dayGroupIndex(3, 1)).toBe(3);
    expect(dayGroupIndex(3, 2)).toBe(1);
  });
});

describe("cursor + sessions", () => {
  it("initialCursorWeek: 7th-week starts at '7w', else week 1", () => {
    expect(initialCursorWeek({ kind: "leader" })).toBe(1);
    expect(initialCursorWeek({ kind: "seventh-week" })).toBe("7w");
  });

  it("totalSessionsInBlock = weeks × day count", () => {
    expect(totalSessionsInBlock(block({ weeksBeforeDeload: 3 }), DEFAULT_DAY_ORDER)).toBe(12);
  });

  it("advanceCursor walks groups then wraps weeks 1→2→3 then ends", () => {
    const b = { kind: "leader" as const };
    expect(advanceCursor({ week: 1, groupIndex: 0 }, b, 4)).toEqual({ week: 1, groupIndex: 1 });
    expect(advanceCursor({ week: 1, groupIndex: 3 }, b, 4)).toEqual({ week: 2, groupIndex: 0 });
    expect(advanceCursor({ week: 3, groupIndex: 3 }, b, 4)).toBeNull();
  });
});

describe("weekStartDate", () => {
  const anchor = "2026-01-05T00:00:00.000Z"; // a Monday
  it("offsets each week by 7 days from the anchor", () => {
    expect(weekStartDate(anchor, 3, 1)?.toISOString().slice(0, 10)).toBe("2026-01-05");
    expect(weekStartDate(anchor, 3, 2)?.toISOString().slice(0, 10)).toBe("2026-01-12");
    expect(weekStartDate(anchor, 3, 3)?.toISOString().slice(0, 10)).toBe("2026-01-19");
    expect(weekStartDate(anchor, 3, "deload")?.toISOString().slice(0, 10)).toBe("2026-01-26");
  });
  it("returns undefined for '7w' and a missing anchor", () => {
    expect(weekStartDate(anchor, 3, "7w")).toBeUndefined();
    expect(weekStartDate(null, 3, 1)).toBeUndefined();
  });
});

describe("tmPercentForLift", () => {
  it("uses the per-lift override, else the default", () => {
    const b = block({ tmPercentByLift: { squat: 0.9 } });
    expect(tmPercentForLift(b, "squat", 0.85)).toBe(0.9);
    expect(tmPercentForLift(b, "bench", 0.85)).toBe(0.85);
  });
});
