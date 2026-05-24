/**
 * Equipment-aware filtering for the accessory picker.
 *
 * Two pure helpers:
 *   - `inferRequiredEquipment(movement)` — slug-pattern heuristic that
 *     guesses what gear a movement needs from its slug alone (no schema
 *     change, no per-row catalog metadata). First-match-wins ordered
 *     list of substring tests.
 *   - `isEquipmentAvailable(req, equipment)` — boolean check against the
 *     `Equipment` blob from `profiles.equipment`.
 *
 * Design stance: **conservative**. When a slug doesn't clearly imply a
 * specific implement we return `bodyweight_or_generic` so the movement
 * is always allowed. Better to over-include than over-filter — if we
 * silently drop a movement the user can actually do, they get a thinner
 * accessory pool and don't know why.
 *
 * Slug-shape note: the seed catalog uses kebab-case (`leg-press-45`,
 * `db-bench-flat`). The patterns in this file are written with
 * underscores because that's how the requirement spec phrases them; we
 * normalise hyphens to underscores up front so both shapes match.
 */
import type { Equipment } from "@/lib/settings/equipment-schema";
import type { MachineType } from "@/lib/settings/equipment-schema";

export type EquipmentRequirement =
  | { kind: "barbell" }
  | { kind: "trap_bar" }
  | { kind: "safety_squat_bar" }
  | { kind: "dumbbells" }
  | { kind: "kettlebells" }
  | { kind: "machine"; machine: MachineType }
  | { kind: "cable" }
  | { kind: "bands" }
  | { kind: "weighted_vest" }
  | { kind: "sandbag" }
  | { kind: "dip_belt" }
  | { kind: "pull_up_bar" }
  | { kind: "rings" }
  | { kind: "bodyweight_or_generic" };

const BARBELL_LIFT_TOKENS = [
  "back_squat",
  "front_squat",
  "bench_press",
  "deadlift",
  "overhead_press",
  "bent_over_row",
  "power_clean",
  "power_snatch",
  "clean_pull",
  "snatch_pull",
];

function looksLikeBarbellLift(slug: string): boolean {
  // Direct match, or a "pause_*" variant of any of the canonical lifts.
  if (BARBELL_LIFT_TOKENS.some((t) => slug.includes(t))) return true;
  if (slug.includes("pause_") && BARBELL_LIFT_TOKENS.some((t) => slug.includes(t.replace("_", "")))) {
    return true;
  }
  return false;
}

/**
 * First-match-wins slug → requirement mapping. See
 * `docs/knowledge/log.md` entry for the rationale and the
 * "when in doubt, include" stance.
 */
export function inferRequiredEquipment(movement: {
  slug: string;
  pattern?: string | null;
}): EquipmentRequirement {
  const slug = movement.slug.toLowerCase().replace(/-/g, "_");

  // 1. Cable stack.
  if (slug.includes("cable")) return { kind: "cable" };

  // 2–9. Specific machines (order matters — `hip_thrust_machine`
  // before generic `hip_thrust` since the latter is a barbell move).
  if (slug.includes("leg_press")) return { kind: "machine", machine: "leg_press" };
  if (slug.includes("leg_curl")) return { kind: "machine", machine: "leg_curl" };
  if (slug.includes("leg_extension")) return { kind: "machine", machine: "leg_extension" };
  if (slug.includes("hack_squat")) return { kind: "machine", machine: "hack_squat" };
  if (
    slug.includes("chest_press") &&
    !slug.includes("dumbbell") &&
    !slug.includes("db_") &&
    !slug.includes("_db_") &&
    !slug.endsWith("_db")
  ) {
    return { kind: "machine", machine: "chest_press" };
  }
  if (
    (slug.includes("lat_pulldown") || slug.includes("pulldown")) &&
    !slug.includes("band_") &&
    !slug.includes("_band")
  ) {
    return { kind: "machine", machine: "lat_pulldown" };
  }
  if (slug.includes("seated_row")) return { kind: "machine", machine: "seated_row" };
  if (slug.includes("hip_thrust_machine")) return { kind: "machine", machine: "hip_thrust" };

  // 10. Smith machine.
  if (slug.includes("smith")) return { kind: "machine", machine: "smith_machine" };

  // 11–12. Loaded implements abbreviated as db / kb. The spec lists
  // `_db_`, trailing `_db`, and the full word `dumbbell` — we also
  // accept a leading `db_` because the seed catalog uses kebab-case
  // slugs like `db-bench-flat` (→ `db_bench_flat`).
  if (
    slug.includes("dumbbell") ||
    slug.includes("_db_") ||
    slug.endsWith("_db") ||
    slug.startsWith("db_")
  ) {
    return { kind: "dumbbells" };
  }
  if (
    slug.includes("kettlebell") ||
    slug.includes("_kb_") ||
    slug.endsWith("_kb") ||
    slug.startsWith("kb_")
  ) {
    return { kind: "kettlebells" };
  }

  // 13. Bands.
  if (slug.includes("band_") || slug.includes("_band")) return { kind: "bands" };

  // 14–16. Misc loaded accessories.
  if (slug.includes("weighted_vest") || slug.includes("vest_")) return { kind: "weighted_vest" };
  if (slug.includes("sandbag")) return { kind: "sandbag" };
  if (slug.includes("dip_belt")) return { kind: "dip_belt" };

  // 17–18. Specialty bars.
  if (slug.includes("trap_bar") || slug.includes("hex_bar")) return { kind: "trap_bar" };
  if (slug.includes("safety_squat") || slug.includes("_ssb") || slug.startsWith("ssb_")) {
    return { kind: "safety_squat_bar" };
  }

  // 19–20. Gymnastic hardware.
  if (slug.includes("ring_")) return { kind: "rings" };
  if (
    (slug.includes("pull_up") ||
      slug.includes("pullup") ||
      slug.includes("chin_up") ||
      slug.includes("chinup") ||
      (slug.includes("dip_") && !slug.includes("dip_belt"))) &&
    true
  ) {
    return { kind: "pull_up_bar" };
  }

  // 21. Default barbell lift.
  if (looksLikeBarbellLift(slug)) return { kind: "barbell" };

  // 22. Conservative fallback — always-allowed.
  return { kind: "bodyweight_or_generic" };
}

/**
 * Does the user own / have access to the implement implied by `req`?
 *
 * `bodyweight_or_generic` is always true. Loaded-implement checks read
 * the corresponding section of `equipment` directly — no transitive
 * substitutions (a user with kettlebells but no dumbbells can't do a
 * dumbbell-tagged movement, even if they could "kind of" swap; the
 * picker has plenty of other candidates).
 */
export function isEquipmentAvailable(
  req: EquipmentRequirement,
  equipment: Equipment,
): boolean {
  switch (req.kind) {
    case "bodyweight_or_generic":
      return true;
    case "barbell":
      return equipment.bars.barbellKg > 0;
    case "trap_bar":
      return equipment.bars.trapBarKg !== null;
    case "safety_squat_bar":
      return equipment.bars.safetyBarKg !== null;
    case "dumbbells":
      return equipment.dumbbells !== null;
    case "kettlebells":
      return equipment.kettlebells.length > 0;
    case "machine":
      return equipment.machines.includes(req.machine);
    case "cable":
      return equipment.machines.includes("cable_stack");
    case "bands":
      return equipment.accessories.bands === true;
    case "weighted_vest":
      return equipment.accessories.weightedVest !== false;
    case "sandbag":
      return equipment.accessories.sandbag !== false;
    case "dip_belt":
      return equipment.accessories.dipBelt === true;
    case "pull_up_bar":
      return equipment.accessories.pullUpBar === true;
    case "rings":
      return equipment.accessories.rings === true;
  }
}
