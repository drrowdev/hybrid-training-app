import { GLOBAL_WARMUP_PERCENTS, GLOBAL_WARMUP_REPS } from '@hta/program-core';
import { floorToIncrement } from './rounding';
import type { PrescribedSet, WarmupConfig } from './types';

/**
 * THE 5/3/1 WARM-UP (the one this program actually prescribes).
 *
 * Wendler's ramp is a flat 40 / 50 / 60% **of the Training Max** for 5 / 5 / 3
 * reps, and it does NOT move with the day's top set: the 5s week (85% TM), the
 * 3s week (90%) and the 5/3/1 week (95%) all warm up with the same bar loads.
 * A 200 kg TM deadlift therefore ramps 80 / 100 / 120 kg every single week.
 *
 * This is deliberately NOT the app-wide `GLOBAL_WARMUP_PERCENTS` ramp: that one
 * is a percentage of the work set, so it climbs week to week (68/102/136 →
 * 72/108/144 → 76/114/152 on the same 200 kg TM) and tops out 16–32 kg heavier.
 * The shared ramp stays the app default for programs with no published warm-up;
 * 5/3/1 has one, so it supplies its own (methodology fidelity).
 */
export const TRAINING_MAX_WARMUP: WarmupConfig = {
  anchor: 'training_max',
  percents: [0.4, 0.5, 0.6],
  reps: [5, 5, 3],
};

/**
 * The app-wide shared ramp — a percentage of the TOP WORKING SET (single source
 * of truth lives in @hta/program-core). Retained for callers that deliberately
 * want the shared routine rather than 5/3/1's own.
 */
export const TOP_SET_WARMUP: WarmupConfig = {
  anchor: 'top_set',
  percents: [...GLOBAL_WARMUP_PERCENTS],
  reps: [...GLOBAL_WARMUP_REPS],
};

/**
 * @deprecated Ambiguous name — say which anchor you mean. Kept as an alias of
 * {@link TOP_SET_WARMUP} so existing callers of `buildWarmupSets` are unchanged;
 * the program's own ramp is {@link TRAINING_MAX_WARMUP}.
 */
export const DEFAULT_WARMUP: WarmupConfig = TOP_SET_WARMUP;

/**
 * Build the warm-up ramp for a given anchor weight (the top working weight for
 * a `top_set` config, the Training Max for a `training_max` one — prefer
 * {@link buildProgramWarmupSets}, which picks the right one for you).
 * Each warm-up set is floored to the nearest increment so it's always loadable below the
 * working weight (avoids accidentally overshooting after rounding).
 */
export function buildWarmupSets(
  anchorWeightKg: number,
  roundingKg: number,
  config: WarmupConfig = DEFAULT_WARMUP,
): PrescribedSet[] {
  if (config.percents.length !== config.reps.length) {
    throw new Error('warmup percents and reps must have the same length');
  }
  return config.percents.map((p, i) => ({
    kind: "warmup",
    weightKg: Math.max(0, floorToIncrement(anchorWeightKg * p, roundingKg)),
    reps: config.reps[i] ?? 5,
  }));
}

/**
 * Build a session's warm-up ramp from BOTH candidate anchors, letting the
 * config decide which one it is a percentage of. This is the seam that keeps
 * 5/3/1's fixed TM ramp from being silently re-anchored to the top set.
 */
export function buildProgramWarmupSets(args: {
  trainingMaxKg: number;
  topWorkingWeightKg: number;
  roundingKg: number;
  config?: WarmupConfig;
}): PrescribedSet[] {
  const config = args.config ?? TRAINING_MAX_WARMUP;
  const anchorWeightKg =
    (config.anchor ?? 'top_set') === 'training_max'
      ? args.trainingMaxKg
      : args.topWorkingWeightKg;
  return buildWarmupSets(anchorWeightKg, args.roundingKg, config);
}

