import { describe, expect, it } from "vitest";
import { accountMaxMovementIds, preferredMaxSuggestions, scheduledProgressionCandidates, scheduledProgressionIncrement, suggestedAccountOneRm } from "./scheduled-progression";

const movement = { pattern: "press", primaryRegion: "shoulder_scapular", primaryMuscles: ["chest"] };
const now = new Date("2026-09-28T12:00:00Z");
const eligible = "2026-09-07T12:00:00Z";
const max = { movementId: "bench", oneRmKg: 100, updatedAt: eligible, movement };
const input = {
  now, enabled: true, units: "metric",
  programs: [{ active: true, items: [{ movementId: "bench", percentTm: 80 }] }],
  maxes: [max], suggestions: [],
};

describe("scheduled account 1RM progression", () => {
  it.each(["press", "pull", "row"])("classifies upper-body %s from metadata", (pattern) => {
    expect(scheduledProgressionIncrement({ ...movement, pattern })).toBe(1.5);
  });
  it.each(["squat", "deadlift", "hinge", "lunge"])("classifies lower-body %s from metadata", (pattern) => {
    expect(scheduledProgressionIncrement({ pattern, primaryRegion: "knee", primaryMuscles: ["quads"] })).toBe(2.5);
  });
  it("classifies calf isolation but skips ambiguous and conflicting metadata", () => {
    expect(scheduledProgressionIncrement({ pattern: "isolation", primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] })).toBe(2.5);
    for (const pattern of ["cardio", "olympic", "carry", "unknown", "tendon"]) {
      expect(scheduledProgressionIncrement({ ...movement, pattern })).toBeNull();
    }
    expect(scheduledProgressionIncrement({ ...movement, primaryRegion: "knee" })).toBeNull();
    expect(scheduledProgressionIncrement({ pattern: "isolation", primaryRegion: "foot_ankle_calf", primaryMuscles: [] })).toBeNull();
  });
  it("uses the inclusive 21-day clock and exact increments without plate rounding", () => {
    expect(scheduledProgressionCandidates(input)[0]?.proposedOneRmKg).toBe(101.5);
    expect(scheduledProgressionCandidates({ ...input, maxes: [{ ...max, updatedAt: "2026-09-07T12:00:00.001Z" }] })).toEqual([]);
    expect(scheduledProgressionCandidates({ ...input, maxes: [{ ...max, movement: { ...movement, pattern: "hinge", primaryRegion: "hamstring_posterior" } }] })[0]?.proposedOneRmKg).toBe(102.5);
  });
  it.each(["accepted", "dismissed"])("DC-K4: a %s decision resets this lift's clock without changing its max", (status) => {
    const suggestions = [{ movementId: "bench", source: "derived_rpe", status, resolvedAt: now.toISOString() }];
    expect(scheduledProgressionCandidates({ ...input, suggestions })).toEqual([]);
    expect(scheduledProgressionCandidates({ ...input, suggestions: [{ ...suggestions[0]!, resolvedAt: eligible }] })).toHaveLength(1);
    expect(max.oneRmKg).toBe(100);
  });
  it("is idempotent, defaults safely for invalid data and never invents imperial increments", () => {
    expect(scheduledProgressionCandidates({ ...input, suggestions: [{ movementId: "bench", source: "scheduled_progression", status: "pending", resolvedAt: null }] })).toEqual([]);
    expect(scheduledProgressionCandidates({ ...input, enabled: false })).toEqual([]);
    expect(scheduledProgressionCandidates({ ...input, units: "imperial" })).toEqual([]);
    expect(scheduledProgressionCandidates({ ...input, maxes: [{ ...max, updatedAt: "invalid" }] })).toEqual([]);
  });
  it("DC-R6: requires an active prescription fed by the account 1RM, never an absolute working max", () => {
    expect(accountMaxMovementIds([
      { active: false, items: [{ movementId: "ended", percentTm: 70 }] },
      { active: true, items: [
        { movementId: "absolute", percentTm: 70, meta: { programLoadBasis: { version: 1, kind: "working-max", kg: 100 } } },
        { movementId: "account", percentTm: 70, meta: { programLoadBasis: { version: 1, kind: "one-rm", percent: 90, roundingKg: 2.5 } } },
        { movementId: "unanchored" },
      ] },
    ])).toEqual(new Set(["account"]));
    expect(scheduledProgressionCandidates({ ...input, programs: [] })).toEqual([]);
  });
  it("prefers derived suggestions and keeps only the newest derived line per lift", () => {
    const rows = [
      { movementId: "bench", source: "scheduled_progression", id: "progression" },
      { movementId: "bench", source: "derived_rpe", id: "new" },
      { movementId: "bench", source: "derived_amrap", id: "old" },
      { movementId: "squat", source: "scheduled_progression", id: "squat" },
    ];
    expect(preferredMaxSuggestions(rows).map((row) => row.id)).toEqual(["new", "squat"]);
  });
  it("shows the exact persisted 1RM for each kind of suggestion in the combined list", () => {
    expect(suggestedAccountOneRm(101.5, "scheduled_progression", 90)).toBe(101.5);
    expect(suggestedAccountOneRm(92.5, "derived_amrap", 90)).toBe(102.5);
    expect(suggestedAccountOneRm(100, "derived_rpe", 100)).toBe(100);
  });
  it("DC-R6: skips an owned prescription with no declared basis, and reports malformed metadata", () => {
    expect(accountMaxMovementIds([{ active: true, owned: true, items: [{ movementId: "bench", percentTm: 80 }] }])).toEqual(new Set());
    expect(() => accountMaxMovementIds([{ active: true, items: [{ movementId: "bench", percentTm: 80,
      meta: { programLoadBasis: { version: 99 } } }] }])).toThrow();
  });
  it("considers later workouts in all active program types and does not mutate any max", () => {
    const programs = ["strength", "running", "swimming", "hybrid"].map((kind) => ({
      active: true, items: [{ movementId: kind, percentTm: 75 }],
    }));
    const maxes = programs.map((program) => ({ ...max, movementId: program.items[0]!.movementId }));
    expect(scheduledProgressionCandidates({ ...input, programs, maxes }).map((row) => row.movementId))
      .toEqual(["strength", "running", "swimming", "hybrid"]);
    expect(maxes.every((row) => row.oneRmKg === 100)).toBe(true);
  });
});
