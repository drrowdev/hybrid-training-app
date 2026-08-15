import { describe, it, expect } from 'vitest';
import {
  buildProgramWarmupSets,
  buildWarmupSets,
  DEFAULT_WARMUP,
  TOP_SET_WARMUP,
  TRAINING_MAX_WARMUP,
} from './warmup';

describe('warmup', () => {
  it('builds default 40/60/80 ramp floored to increment', () => {
    const sets = buildWarmupSets(100, 2.5);
    expect(sets.map((s) => s.weightKg)).toEqual([40, 60, 80]);
    expect(sets.map((s) => s.reps)).toEqual([5, 5, 3]);
    expect(sets.every((s) => s.kind === 'warmup')).toBe(true);
  });

  it('floors awkward weights down so warm-ups never exceed working weight', () => {
    // 87.5 kg working: 35 / 52.5 / 70
    const sets = buildWarmupSets(87.5, 2.5);
    expect(sets.map((s) => s.weightKg)).toEqual([35, 52.5, 70]);
  });

  it('respects a custom config', () => {
    const sets = buildWarmupSets(100, 5, { percents: [0.5, 0.7], reps: [8, 5] });
    expect(sets.map((s) => s.weightKg)).toEqual([50, 70]);
    expect(sets.map((s) => s.reps)).toEqual([8, 5]);
  });

  it('rejects mismatched lengths', () => {
    expect(() => buildWarmupSets(100, 2.5, { percents: [0.4], reps: [5, 5] })).toThrow();
  });

  it('exposes default config', () => {
    expect(DEFAULT_WARMUP.percents).toEqual([0.4, 0.6, 0.8]);
  });
});

describe('program warm-up ramp (fixed % of Training Max)', () => {
  it('is a flat 40/50/60% of TM x 5/5/3 — 200 kg TM ramps 80/100/120 kg', () => {
    expect(TRAINING_MAX_WARMUP.anchor).toBe('training_max');
    expect(TRAINING_MAX_WARMUP.percents).toEqual([0.4, 0.5, 0.6]);
    expect(TRAINING_MAX_WARMUP.reps).toEqual([5, 5, 3]);
    const sets = buildWarmupSets(200, 2.5, TRAINING_MAX_WARMUP);
    expect(sets.map((s) => s.weightKg)).toEqual([80, 100, 120]);
    expect(sets.map((s) => s.reps)).toEqual([5, 5, 3]);
  });

  it('does NOT climb with the top set: 5s / 3s / 5-3-1 weeks share one ramp', () => {
    // 200 kg TM, top sets 85% (170) / 90% (180) / 95% (190).
    const weeks = [170, 180, 190].map((topWorkingWeightKg) =>
      buildProgramWarmupSets({
        trainingMaxKg: 200,
        topWorkingWeightKg,
        roundingKg: 2.5,
      }).map((s) => s.weightKg),
    );
    expect(weeks[0]).toEqual([80, 100, 120]);
    expect(weeks[1]).toEqual(weeks[0]);
    expect(weeks[2]).toEqual(weeks[0]);
  });

  it('the shared app ramp is still top-set anchored and still climbs', () => {
    expect(TOP_SET_WARMUP.anchor).toBe('top_set');
    expect(DEFAULT_WARMUP).toBe(TOP_SET_WARMUP);
    const weeks = [170, 180, 190].map((topWorkingWeightKg) =>
      buildProgramWarmupSets({
        trainingMaxKg: 200,
        topWorkingWeightKg,
        roundingKg: 2.5,
        config: TOP_SET_WARMUP,
      }).map((s) => s.weightKg),
    );
    expect(weeks).toEqual([
      [67.5, 100, 135],
      [70, 107.5, 142.5],
      [75, 112.5, 150],
    ]);
    // ...which is exactly the drift the program ramp avoids.
    expect(weeks[0]).not.toEqual(weeks[2]);
  });

  it('defaults to the program ramp when no config is given', () => {
    expect(
      buildProgramWarmupSets({
        trainingMaxKg: 200,
        topWorkingWeightKg: 190,
        roundingKg: 2.5,
      }).map((s) => s.weightKg),
    ).toEqual([80, 100, 120]);
  });
});
