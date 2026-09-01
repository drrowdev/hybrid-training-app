export type CatalogMovementLoadKind =
  | "barbell"
  | "weighted-bw"
  | "bodyweight"
  | "unanchored";

/**
 * Loading semantics belong to the selected movement, not to the template slot
 * it replaced.
 *
 * `body_weight_loaded` is also what the training-max UI uses to say a saved max
 * includes bodyweight. Keep the wizard and the server-side deploy normalizer on
 * the same rule so a client-supplied/stale kind cannot put a system max on a
 * belt or subtract bodyweight from an ordinary lift.
 */
export function catalogMovementLoadKind(movement: {
  hasOneRm: boolean;
  isLoadable?: boolean;
}): CatalogMovementLoadKind {
  if (!movement.hasOneRm) return "unanchored";
  return movement.isLoadable === true ? "weighted-bw" : "barbell";
}
