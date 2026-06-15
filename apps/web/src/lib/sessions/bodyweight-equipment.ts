/**
 * Whether a movement's catalog `equipment` string offers a BODYWEIGHT option —
 * i.e. it can be performed with no external load, so an added weight is optional
 * (a 0 kg "pure bodyweight" set is valid). Used alongside the `body_weight_loaded`
 * flag to decide whether the logger requires a weight.
 *
 * The catalog encodes equipment as kebab tokens, sometimes as an "or" of options
 * (e.g. `bodyweight`, `bodyweight-or-loaded`, `bodyweight-or-band`,
 * `barbell-or-bodyweight`, `dumbbell-or-bw`, `machine-or-bw`). Any movement whose
 * equipment carries a `bodyweight` or `bw` token can be done bodyweight, so the
 * weight field is optional. Movements that REQUIRE external load (`barbell`,
 * `dumbbells`, `machine`, …) return false and still demand a weight.
 */
export function isBodyweightCapableEquipment(equipment: string | null | undefined): boolean {
  if (!equipment) return false;
  // Split on the "or" / separator tokens and look for a bodyweight option.
  const tokens = equipment.toLowerCase().split(/[-_]/);
  return tokens.includes("bodyweight") || tokens.includes("bw");
}
