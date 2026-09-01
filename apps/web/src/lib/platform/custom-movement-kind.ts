import { isRepMaxMovementSlug, isSystemLoadMovementSlug } from "@hta/domain";

export type CatalogMovementLoadKind =
  | "barbell"
  | "weighted-bw"
  | "bodyweight"
  | "unanchored";


/**
 * Loading semantics belong to the selected movement, not to the template slot
 * it replaced.
 *
 * `isLoadable` (the catalog's `body_weight_loaded`) only says external load is
 * OPTIONAL — true for lunges, step-ups, push-ups and inverted rows as well as
 * for weighted pull-ups. Treating all of those as system-load maths subtracts
 * bodyweight from an ordinary lift: 70% of a 100 kg forward lunge becomes 0 kg
 * for an 80 kg lifter. Only the movements whose saved max genuinely counts
 * bodyweight get `weighted-bw`, and only those whose max is a rep count get
 * `bodyweight` (see `@hta/domain`'s movement load identity).
 */
export function catalogMovementLoadKind(movement: {
  hasOneRm: boolean;
  slug?: string | null;
}): CatalogMovementLoadKind {
  if (!movement.hasOneRm) return "unanchored";
  if (isSystemLoadMovementSlug(movement.slug)) return "weighted-bw";
  if (isRepMaxMovementSlug(movement.slug)) return "bodyweight";
  return "barbell";
}
