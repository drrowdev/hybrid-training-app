/**
 * Canonical home (plan §6.9) for "how big is one tap of the ± weight
 * stepper for this movement?".
 *
 * The logger used to hard-code 2.5 kg / 5 lb everywhere, which is the
 * right jump for a bar (the smallest pair of plates) but wrong for a
 * dumbbell rack — DB movements go up in 1 kg, and a rehab-scale wrist
 * movement prescribed at 5.5 kg can't sensibly jump to 8 kg.
 *
 * Implement detection reuses `resolveRequiredEquipment`, which prefers
 * the authoritative `movements.equipment` tag and falls back to the slug
 * heuristic — so `hammer-curl` (tagged `dumbbells`, slug says nothing)
 * and `supported-wrist-radial-deviation-db` (slug suffix) both resolve.
 *
 * Imperial note: the display layer rounds pounds to whole numbers
 * (`roundDisplayWeight`), so a fractional lb step could not be honoured
 * exactly — the dumbbell step is therefore 2 lb, the closest whole-pound
 * analogue of 1 kg.
 */
import { resolveRequiredEquipment } from "@/lib/planner/equipment-requirements";
import type { EquipmentRequirement } from "@/lib/planner/equipment-requirements";
import { DEFAULT_WEIGHT_STEP, type WeightStep } from "@/lib/stats/units";

export type { WeightStep };

/** Hand-held implements step by the rack, not by a pair of plates. */
export const DUMBBELL_WEIGHT_STEP: WeightStep = { kg: 1, lb: 2 };

export function loadIncrementForRequirement(
  requirement: EquipmentRequirement,
): WeightStep {
  if (requirement.kind === "any_of" || requirement.kind === "all_of") {
    return loadIncrementForRequirement(requirement.requirements[0]);
  }
  return requirement.kind === "dumbbells"
    ? DUMBBELL_WEIGHT_STEP
    : DEFAULT_WEIGHT_STEP;
}

/**
 * Resolve the ± stepper increment for a catalog movement. Pass whatever
 * the caller has: the `movements.equipment` tag wins, the slug is the
 * fallback, and an empty movement yields the plate default.
 */
export function resolveLoadIncrement(movement: {
  slug?: string | null;
  equipment?: string | null;
}): WeightStep {
  if (!movement.slug && !movement.equipment) return DEFAULT_WEIGHT_STEP;
  return loadIncrementForRequirement(
    resolveRequiredEquipment({
      slug: movement.slug ?? "",
      equipment: movement.equipment ?? null,
    }),
  );
}
