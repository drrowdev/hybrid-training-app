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
 *     or the instance's TM% when it was set up to load off a derived TM. Those
 *     engines round the derived TM to a loadable weight BEFORE taking the
 *     session percentage, so the seeded percentage is that rounded Training Max
 *     over the 1RM — seeding the raw TM% renders a plate step heavy.
 *   - Green Protocol: strength is delegated to nested TB / Zulu-HT instances, so
 *     the basis is read from those (`greenStrengthBasis`), not off the Green
 *     instance — which carries no basis of its own.
 */
import type { WendlerInstance } from "@hta/wendler";
import type { TbInstance, ZuluHtInstance } from "@hta/tacticalbarbell";
import { greenStrengthBasis, type GreenInstance, type GreenStrengthBasis } from "@hta/green";
import { isRepMaxEngineKey } from "@hta/domain";
import { ENGINE_KEY_TO_ROLE } from "./movement-keys";

/** A per-engine-key integer tm_percent (% of true 1RM) to write to training_maxes. */
export type TmAlignment = Partial<Record<string, number>>;

/** The default plate step, matching the engines' own `ctx.roundingKg` default. */
const DEFAULT_ROUNDING_KG = 2.5;

function pct(n: number): number {
  return Math.round(n * 1000) / 10; // one decimal place, e.g. 84.9
}

function roundToIncrement(kg: number, incrementKg: number): number {
  return incrementKg > 0 ? Math.round(kg / incrementKg) * incrementKg : kg;
}

/** TB and Zulu/HT both carry the basis on the instance itself. */
function tbBasis(inst: Partial<TbInstance & ZuluHtInstance>): GreenStrengthBasis {
  return inst.useTrainingMax && typeof inst.tmPercent === "number"
    ? { kind: "training-max", tmPercent: inst.tmPercent }
    : { kind: "one-rm" };
}

/**
 * Compute the per-movement tm_percent the platform should seed for a new program
 * instance, so the engine's percentages render correct weights.
 *
 * @param programFamily the engine's `meta.family` (e.g. "531", "tactical-barbell")
 * @param instance      the freshly set-up engine instance
 * @param oneRepMaxes   the user's canonical 1RMs by engine key (for the 5/3/1 ratio)
 * @param roundingKg    the lifter's plate step, so the seeded percentage carries
 *                      the same Training Max rounding the engine applied
 */
export function computeTmAlignment(
  programFamily: string,
  instance: unknown,
  oneRepMaxes: Record<string, number>,
  roundingKg: number = DEFAULT_ROUNDING_KG,
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
    const basis =
      programFamily === "tactical-barbell-green"
        ? greenStrengthBasis(instance as GreenInstance)
        : tbBasis(instance as Partial<TbInstance & ZuluHtInstance>);
    // A Green instance that no single basis describes is the one case where
    // there is no honest answer. Seeding anything renders a wrong weight, so
    // seed nothing and leave every movement on its own saved percentage.
    if (basis == null) return out;
    // Include exact program movements (rows, rack pulls, reverse hypers, etc.),
    // not only the four broad StrengthRole keys. The logger computes target load
    // as 1RM × tm_percent × prescription %, so every anchored TB movement must
    // share the engine's basis.
    const keys = new Set([
      ...Object.keys(ENGINE_KEY_TO_ROLE),
      ...Object.keys(oneRepMaxes),
    ]);
    for (const key of keys) {
      // A rep-max anchor is a rep count sharing the 1RM column. A percentage OF
      // it is meaningless, and rendering `reps × tm_percent` as kilograms puts a
      // fabricated weight in front of the lifter.
      if (isRepMaxEngineKey(key)) continue;
      if (basis.kind === "one-rm") {
        out[key] = 100;
        continue;
      }
      const oneRm = oneRepMaxes[key];
      // The engine derives its Training Max as round(1RM × TM%) and takes the
      // session percentage off THAT. Seeding the raw TM% makes the renderer
      // multiply in the other order and land a plate step away.
      out[key] =
        oneRm != null && oneRm > 0
          ? pct(roundToIncrement(oneRm * basis.tmPercent, roundingKg) / oneRm)
          : pct(basis.tmPercent);
    }
    return out;
  }

  // Unknown family — default to % of true 1RM.
  for (const key of Object.keys(ENGINE_KEY_TO_ROLE)) out[key] = 100;
  return out;
}
