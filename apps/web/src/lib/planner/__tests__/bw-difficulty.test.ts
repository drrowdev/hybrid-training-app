import { describe, expect, it } from "vitest";
import { effectiveDifficulty } from "../bw-difficulty";

const node = { difficultyAnchor: 35, tutPerRepSeconds: 4 } as const;

describe("effectiveDifficulty", () => {
  it("returns 0 when reps is 0", () => {
    expect(
      effectiveDifficulty({
        node,
        reps: 0,
        tempoSec: 4,
        rir: 2,
        externalLoadKg: 0,
        userBodyweightKg: 80,
      }),
    ).toBe(0);
  });

  it("scales roughly 2x with bodyweight-equivalent external load", () => {
    const base = effectiveDifficulty({
      node,
      reps: 5,
      tempoSec: 4,
      rir: 0,
      externalLoadKg: 0,
      userBodyweightKg: 80,
    });
    const loaded = effectiveDifficulty({
      node,
      reps: 5,
      tempoSec: 4,
      rir: 0,
      externalLoadKg: 80,
      userBodyweightKg: 80,
    });
    expect(loaded / base).toBeCloseTo(2, 5);
  });

  it("floors the RIR proximity factor at 0.4 for very-easy sets", () => {
    // rir = 100 would imply 1 - 10 = -9 without the floor.
    const sloppy = effectiveDifficulty({
      node,
      reps: 5,
      tempoSec: 4,
      rir: 100,
      externalLoadKg: 0,
      userBodyweightKg: 80,
    });
    const failure = effectiveDifficulty({
      node,
      reps: 5,
      tempoSec: 4,
      rir: 0,
      externalLoadKg: 0,
      userBodyweightKg: 80,
    });
    expect(sloppy).toBeGreaterThan(0);
    expect(sloppy / failure).toBeCloseTo(0.4, 5);
  });

  it("scales up with slow tempo above the catalog default", () => {
    const fast = effectiveDifficulty({
      node,
      reps: 5,
      tempoSec: 4,
      rir: 0,
      externalLoadKg: 0,
      userBodyweightKg: 80,
    });
    const slow = effectiveDifficulty({
      node,
      reps: 5,
      tempoSec: 8,
      rir: 0,
      externalLoadKg: 0,
      userBodyweightKg: 80,
    });
    expect(slow / fast).toBeCloseTo(2, 5);
  });

  it("floors the tempo-scale at 0.6 for cheaty-fast tempos", () => {
    // tempoSec 0 with default 4 would yield 0 without the floor.
    const cheaty = effectiveDifficulty({
      node,
      reps: 5,
      tempoSec: 0,
      rir: 0,
      externalLoadKg: 0,
      userBodyweightKg: 80,
    });
    expect(cheaty / (node.difficultyAnchor * 5)).toBeCloseTo(0.6, 5);
  });

  it("safely no-ops external-load factor when userBodyweightKg is 0", () => {
    // Defensive: division-by-zero would otherwise produce Infinity.
    const v = effectiveDifficulty({
      node,
      reps: 5,
      tempoSec: 4,
      rir: 0,
      externalLoadKg: 20,
      userBodyweightKg: 0,
    });
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBe(node.difficultyAnchor * 5);
  });
});
