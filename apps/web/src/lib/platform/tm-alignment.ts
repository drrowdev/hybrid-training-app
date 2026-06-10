/**
 * TM-basis alignment (Option A).
 *
 * The app renders a strength set's weight as `1RM × tm_percent × percentTm`,
 * while the engines bake their methodology's own basis into `percentOfTm`. To
 * make the existing "% of TM" renderer show the engine's exact weight, the
 * platform seeds the user's per-movement `training_maxes.tm_percent` to the
 * program's working basis at program creation. After that, the adapter can pass
 * the engine's `percentOfTm` straight through (see adapter.ts / movement-keys.ts).
 *
 * This module computes the per-engine-key `tm_percent` (an integer percentage of
 * the true 1RM) for a freshly set-up instance. Pure — no DB.
 *
 *   - 5/3/1: the working basis is the instance's stored, rounded Training Max, so
 *     tm_percent = round(TM / 1RM × 100). Captures the exact rounding the engine
 *     used (e.g. 0.85 × 142.5 → 121 → 84.9%).
 *   - Tactical Barbell / Zulu/HT: % of the true 1RM by default (tm_percent = 100),
 *     or the instance's TM% when it was set up to load off a derived TM.
 *   - Green Protocol: strength is delegated to TB engines; default basis is the
 *     true 1RM (100). (If a future Green setup enables a derived TM, extend here.)
 */
import type { WendlerInstance } from "@hta/wendler";
import type { TbInstance, ZuluHtInstance } from "@hta/tacticalbarbell";
import { ENGINE_KEY_TO_ROLE } from "./movement-keys";

/** A per-engine-key integer tm_percent (% of true 1RM) to write to training_maxes. */
export type TmAlignment = Partial<Record<string, number>>;

function pct(n: number): number {
  return Math.round(n * 1000) / 10; // one decimal place, e.g. 84.9
}

/**
 * Compute the per-movement tm_percent the platform should seed for a new program
 * instance, so the engine's percentages render correct weights.
 *
 * @param programFamily the engine's `meta.family` (e.g. "531", "tactical-barbell")
 * @param instance      the freshly set-up engine instance
 * @param oneRepMaxes   the user's canonical 1RMs by engine key (for the 5/3/1 ratio)
 */
export function computeTmAlignment(
  programFamily: string,
  instance: unknown,
  oneRepMaxes: Record<string, number>,
): TmAlignment {
  const out: TmAlignment = {};

  if (programFamily === "531") {
    const inst = instance as WendlerInstance;
    for (const [key] of Object.entries(ENGINE_KEY_TO_ROLE)) {
      const tm = inst.trainingMaxes?.[key as keyof WendlerInstance["trainingMaxes"]];
      const oneRm = oneRepMaxes[key];
      if (tm != null && oneRm != null && oneRm > 0) {
        out[key] = pct(tm / oneRm);
      }
    }
    return out;
  }

  if (programFamily === "tactical-barbell" || programFamily === "tactical-barbell-green") {
    // TB and Zulu/HT both expose useTrainingMax + tmPercent; Green delegates to TB.
    const inst = instance as Partial<TbInstance & ZuluHtInstance>;
    const basis = inst.useTrainingMax && typeof inst.tmPercent === "number" ? pct(inst.tmPercent) : 100;
    for (const key of Object.keys(ENGINE_KEY_TO_ROLE)) out[key] = basis;
    return out;
  }

  // Unknown family — default to % of true 1RM.
  for (const key of Object.keys(ENGINE_KEY_TO_ROLE)) out[key] = 100;
  return out;
}
