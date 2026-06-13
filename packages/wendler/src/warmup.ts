import { GLOBAL_WARMUP_PERCENTS, GLOBAL_WARMUP_REPS } from '@hta/program-core';
import { floorToIncrement } from './rounding';
import type { PrescribedSet, WarmupConfig } from './types';

// Mirrors the app-wide global warm-up ramp (single source of truth lives in
// @hta/program-core) so 5/3/1 stays in lockstep with every other program.
export const DEFAULT_WARMUP: WarmupConfig = {
  percents: [...GLOBAL_WARMUP_PERCENTS],
  reps: [...GLOBAL_WARMUP_REPS],
};

/**
 * Build the warm-up ramp for a given top working weight.
 * Each warm-up set is floored to the nearest increment so it's always loadable below the
 * working weight (avoids accidentally overshooting after rounding).
 */
export function buildWarmupSets(
  topWorkingWeightKg: number,
  roundingKg: number,
  config: WarmupConfig = DEFAULT_WARMUP,
): PrescribedSet[] {
  if (config.percents.length !== config.reps.length) {
    throw new Error('warmup percents and reps must have the same length');
  }
  return config.percents.map((p, i) => ({
    kind: "warmup",
    weightKg: Math.max(0, floorToIncrement(topWorkingWeightKg * p, roundingKg)),
    reps: config.reps[i] ?? 5,
  }));
}
