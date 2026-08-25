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
  /**
   * A movement tagged as machine-only in the DB `equipment` column whose
   * specific implement isn't one of the ten tracked `MachineType`s (e.g.
   * reverse pec deck, pendulum squat, hip abduction/adduction). We can't
   * map it to a single owned machine, so it's satisfied iff the user owns
   * *any* machine at all. Better than the legacy slug heuristic, which let
   * every such movement through regardless of machine ownership.
   */
  | { kind: "machine_generic" }
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
  // Mirror the dumbbell heuristic for explicit barbell suffix/prefix
  // (catalog uses kebab-case slugs like `rdl-bb`, `bb-row-overhand`).
  // The downstream BARBELL_LIFT_TOKENS check catches `back_squat` /
  // `deadlift` etc. but misses non-canonical-lift barbell movements
  // such as Romanian-deadlift-bb or BB shrug.
  if (
    slug.includes("_bb_") ||
    slug.endsWith("_bb") ||
    slug.startsWith("bb_")
  ) {
    return { kind: "barbell" };
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
 * Map the authoritative DB `movements.equipment` tag to a hard
 * machine/cable requirement, taking precedence over the slug heuristic.
 *
 * The slug heuristic in `inferRequiredEquipment` only recognises a
 * handful of machine slugs (leg press / curl / extension / hack /
 * chest press) and lets every *other* machine movement through as
 * `bodyweight_or_generic` — so a user with no machines was still being
 * prescribed reverse pec deck, pendulum squat, hip abduction, etc. The
 * `equipment` column tags these explicitly (`machine-reverse-pec`,
 * `machine-pendulum`, `machine-abduction`, …), so we use it as the
 * source of truth for the machine/cable family.
 *
 * Returns `null` (→ caller falls back to slug inference) for:
 *   - a missing tag,
 *   - any tag offering a non-machine alternative (`*-or-bw`,
 *     `*-or-bodyweight`, `bodyweight-or-*`) — those movements have a
 *     free/bodyweight option and must stay broadly available,
 *   - any implement we don't track against the user's inventory
 *     (plate / gripper / erg / sled …).
 *
 * Machine, cable AND free-weight implements (barbell / dumbbell / kettlebell /
 * specialty bars / bands / vest / sandbag / dip-belt) all map to a hard
 * requirement here: the DB tag is authoritative, so a movement whose slug hides
 * its implement (e.g. `hammer-curl` tagged `dumbbells`) is no longer wrongly
 * offered to a user who lacks the kit.
 */
export function requirementFromEquipmentTag(
  tag: string | null | undefined,
): EquipmentRequirement | null {
  if (!tag) return null;
  const t = tag.toLowerCase();

  // Escape hatch: any movement whose tag offers a bodyweight / free
  // alternative is never a hard machine requirement.
  if (tagOffersBodyweight(tag)) {
    return null;
  }

  // Specific machines we can match against the user's tracked inventory.
  if (t.includes("leg-press")) return { kind: "machine", machine: "leg_press" };
  if (t.includes("leg-curl")) return { kind: "machine", machine: "leg_curl" };
  if (t.includes("leg-ext")) return { kind: "machine", machine: "leg_extension" };
  if (t.includes("hack")) return { kind: "machine", machine: "hack_squat" };
  if (t.includes("chest-press")) return { kind: "machine", machine: "chest_press" };
  if (t.includes("smith")) return { kind: "machine", machine: "smith_machine" };
  if (t.includes("seated-row") || t === "machine-row") {
    return { kind: "machine", machine: "seated_row" };
  }
  if (t.includes("hip-thrust")) return { kind: "machine", machine: "hip_thrust" };

  // Cable stack.
  if (t === "cable" || t.startsWith("cable-") || t.includes("-cable")) {
    return { kind: "cable" };
  }

  // Any other machine-tagged movement — satisfied iff the user owns a
  // machine of some kind.
  if (t === "machine" || t.startsWith("machine-") || t.includes("-machine")) {
    return { kind: "machine_generic" };
  }

  // Free-weight & specialty-bar implements. The DB `equipment` tag is the
  // authoritative source of what a movement needs — even when the slug doesn't
  // name the implement (e.g. `hammer-curl` tagged `dumbbells`, which the slug
  // heuristic would otherwise pass through as bodyweight and wrongly offer to a
  // bodyweight-only user). For an either/or tag with no bodyweight option (e.g.
  // `dumbbell-or-kb`) we require the first-listed implement.
  const base = t.includes("-or-") ? (t.split("-or-")[0] ?? t) : t;
  if (base.includes("trap-bar") || base.includes("hex-bar")) return { kind: "trap_bar" };
  if (base.includes("safety-squat") || base.includes("ssb")) return { kind: "safety_squat_bar" };
  if (base.includes("kettlebell")) return { kind: "kettlebells" };
  if (base.includes("dumbbell")) return { kind: "dumbbells" };
  if (base.includes("-ez") || base.includes("ez-") || base === "ez") return { kind: "barbell" };
  if (base.includes("barbell")) return { kind: "barbell" };
  if (base.includes("band")) return { kind: "bands" };
  if (base.includes("weighted-vest") || base.includes("vest")) return { kind: "weighted_vest" };
  if (base.includes("sandbag")) return { kind: "sandbag" };
  if (base.includes("dip-belt")) return { kind: "dip_belt" };

  return null;
}

/**
 * True when the DB tag explicitly offers a bodyweight / free option
 * (`bodyweight`, `bodyweight-anchor`, `dumbbell-or-bw`, `bw-or-band`, …).
 */
function tagOffersBodyweight(tag: string | null | undefined): boolean {
  if (!tag) return false;
  const t = tag.toLowerCase();
  return t.includes("bodyweight") || t.includes("or-bw") || t.includes("bw-or");
}

/** Machines and cable stacks — a facility you either have access to or don't. */
function isFacilityRequirement(req: EquipmentRequirement): boolean {
  return req.kind === "machine" || req.kind === "machine_generic" || req.kind === "cable";
}

/**
 * Resolve the equipment requirement for a catalog movement, preferring
 * the authoritative DB `equipment` tag for the machine/cable family and
 * falling back to the slug heuristic for everything else.
 */
export function resolveRequiredEquipment(movement: {
  slug: string;
  pattern?: string | null;
  equipment?: string | null;
}): EquipmentRequirement {
  const fromTag = requirementFromEquipmentTag(movement.equipment);
  if (fromTag) return fromTag;

  const inferred = inferRequiredEquipment(movement);

  // A tag that explicitly offers bodyweight cannot require a FACILITY.
  //
  // `requirementFromEquipmentTag` returns null both for "no opinion" (missing
  // or untracked tag) and for "explicitly bodyweight", and the slug heuristic
  // then decides either way — so an explicit bodyweight tag could be overruled
  // by a substring. `sliding-leg-curl` normalises to `sliding_leg_curl`, hits
  // the `leg_curl` branch, and demanded a leg-curl MACHINE: a movement whose
  // whole point is needing no machine was hidden from everyone without one, and
  // no equipment tag could rescue it.
  //
  // Owning a machine is binary, so "can be done with bodyweight" and "requires
  // a machine" is a flat contradiction and the tag wins. Slug-inferred
  // FREE-WEIGHT requirements are deliberately left alone: for a tag like
  // `dumbbell-or-bw` which implement is primary is a catalog judgement rather
  // than a contradiction, and changing it would alter which movements an
  // equipment-poor lifter is offered — a separate decision from this one.
  if (tagOffersBodyweight(movement.equipment) && isFacilityRequirement(inferred)) {
    return { kind: "bodyweight_or_generic" };
  }

  return inferred;
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
    case "machine_generic":
      return equipment.machines.length > 0;
    case "cable":
      return equipment.machines.includes("cable_stack");
    case "bands":
      return equipment.accessories.bands === true;
    case "weighted_vest":
      return equipment.accessories.weightedVest.length > 0;
    case "sandbag":
      return equipment.accessories.sandbag.length > 0;
    case "dip_belt":
      return equipment.accessories.dipBelt === true;
    case "pull_up_bar":
      return equipment.accessories.pullUpBar === true;
    case "rings":
      return equipment.accessories.rings === true;
  }
}
