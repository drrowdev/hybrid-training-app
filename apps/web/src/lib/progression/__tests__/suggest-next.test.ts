import { describe, it, expect } from "vitest";
import { suggestNextWeight } from "../suggest-next";

describe("suggestNextWeight — progression engine (Phase 2 D1)", () => {
  const mainLiftBase = {
    isMainLift: true,
    targetReps: 5,
    trainingMaxKg: 100,
    plateIncrement: 2.5,
  };

  it("hit prescribed reps + e1RM ≥ TM → +2.5 kg next time", () => {
    const r = suggestNextWeight({
      ...mainLiftBase,
      lastSet: { weightKg: 90, reps: 5, rpe: 8 },
      e1rmKg: 105, // ≥ TM of 100
    });
    expect(r.kind).toBe("increase");
    expect(r.nextWeightKg).toBe(92.5);
    expect(r.nextReps).toBe(5);
    expect(r.rationale).toMatch(/92\.5/);
  });

  it("hit prescribed reps but e1RM < TM → hold weight, chase one more rep", () => {
    const r = suggestNextWeight({
      ...mainLiftBase,
      lastSet: { weightKg: 80, reps: 5, rpe: 9 },
      e1rmKg: 95, // < TM 100
    });
    expect(r.kind).toBe("hold");
    expect(r.nextWeightKg).toBe(80);
    expect(r.nextReps).toBe(6);
    expect(r.rationale).toMatch(/6 reps/);
  });

  it("missed by 1 rep → retry — same weight, same reps", () => {
    const r = suggestNextWeight({
      ...mainLiftBase,
      lastSet: { weightKg: 100, reps: 4, rpe: 10 },
      e1rmKg: 110,
    });
    expect(r.kind).toBe("retry");
    expect(r.nextWeightKg).toBe(100);
    expect(r.nextReps).toBe(5);
  });

  it("missed by 2 reps → retry", () => {
    const r = suggestNextWeight({
      ...mainLiftBase,
      lastSet: { weightKg: 100, reps: 3, rpe: 10 },
      e1rmKg: 105,
    });
    expect(r.kind).toBe("retry");
    expect(r.nextWeightKg).toBe(100);
    expect(r.nextReps).toBe(5);
  });

  it("missed by 3+ reps → reset — drop 5 kg, same target", () => {
    const r = suggestNextWeight({
      ...mainLiftBase,
      lastSet: { weightKg: 100, reps: 2, rpe: 10 },
      e1rmKg: 100,
    });
    expect(r.kind).toBe("reset");
    expect(r.nextWeightKg).toBe(95);
    expect(r.nextReps).toBe(5);
    expect(r.rationale).toMatch(/95/);
  });

  it("reset never falls below one plate increment", () => {
    const r = suggestNextWeight({
      ...mainLiftBase,
      lastSet: { weightKg: 5, reps: 0, rpe: 10 },
      e1rmKg: null,
      trainingMaxKg: 5,
    });
    // 5 - 5 = 0; bounded to one plate increment minimum.
    expect(r.kind).toBe("reset");
    expect(r.nextWeightKg).toBe(2.5);
  });

  it("hit-and-bump rounds to the plate increment", () => {
    const r = suggestNextWeight({
      ...mainLiftBase,
      lastSet: { weightKg: 91, reps: 5, rpe: 8 },
      e1rmKg: 110,
      plateIncrement: 2.5,
    });
    // 91 + 2.5 = 93.5 → round to nearest 2.5 = 92.5 (round-half-to-even).
    // Math.round(93.5/2.5)*2.5 → Math.round(37.4)*2.5 → 37*2.5 = 92.5
    expect(r.kind).toBe("increase");
    expect(r.nextWeightKg).toBe(92.5);
  });

  it("missing e1RM (out-of-window top set) → hold rather than risk a bump", () => {
    const r = suggestNextWeight({
      ...mainLiftBase,
      lastSet: { weightKg: 80, reps: 5, rpe: null },
      e1rmKg: null,
    });
    expect(r.kind).toBe("hold");
    expect(r.nextWeightKg).toBe(80);
    expect(r.nextReps).toBe(6);
  });

  describe("accessory branch (isMainLift = false)", () => {
    const accessoryBase = {
      isMainLift: false,
      targetReps: 10,
      trainingMaxKg: 0,
      plateIncrement: 2.5,
    };

    it("hit target → hold weight, target +1 rep", () => {
      const r = suggestNextWeight({
        ...accessoryBase,
        lastSet: { weightKg: 20, reps: 10, rpe: 8 },
        e1rmKg: null,
      });
      expect(r.kind).toBe("hold");
      expect(r.nextWeightKg).toBe(20);
      expect(r.nextReps).toBe(11);
    });

    it("missed reps → retry same weight + reps target", () => {
      const r = suggestNextWeight({
        ...accessoryBase,
        lastSet: { weightKg: 20, reps: 7, rpe: 10 },
        e1rmKg: null,
      });
      expect(r.kind).toBe("retry");
      expect(r.nextWeightKg).toBe(20);
      expect(r.nextReps).toBe(10);
    });

    it("exceeded reps → keep chasing", () => {
      const r = suggestNextWeight({
        ...accessoryBase,
        lastSet: { weightKg: 20, reps: 12, rpe: 9 },
        e1rmKg: null,
      });
      expect(r.kind).toBe("hold");
      expect(r.nextReps).toBe(13);
    });
  });
});
