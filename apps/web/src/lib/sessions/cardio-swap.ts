/**
 * Helpers for the per-cardio-item swap picker (feat/cardio-swap).
 *
 * The strength swap reuses the `pattern` column for compatibility
 * filtering. For cardio movements `pattern === "cardio"` is too coarse:
 * the user wants to swap "Indoor Bike — Z2" for another *easy aerobic*
 * option, not for VO2 intervals or sprints. So we classify movements
 * into a `cardioKind` (mirroring `PrescriptionItemKind`) based on their
 * seed `metadata.zone` / `metadata.protocol` / `metadata.emphasis`
 * fields, and into a `modality` ("running" / "cycling" / "rowing" /
 * "other") for picker grouping. Equipment availability is reconciled
 * against the user's `profile.equipment.cardio` array.
 *
 * Pure functions — no DB or React imports. Tested directly.
 */

import type { CardioMachineType } from "@/lib/settings/equipment-schema";

export type CardioKind =
  | "cardio_z2"
  | "cardio_threshold"
  | "cardio_vo2"
  | "cardio_alactic";

export type CardioModality = "running" | "cycling" | "rowing" | "other";

/** Shape of a movement row as returned by `/api/movements/swap-candidates`. */
export type CardioCandidate = {
  id: string;
  slug: string;
  display_name: string;
  pattern: string;
  equipment: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Classify a cardio movement's intensity bucket from its seed metadata.
 *
 * Order matters: alactic and VO2 markers win over zone tags because the
 * VO2 movements still carry a "Z5" zone but we want them grouped under
 * VO2 in the picker, not as a generic high-zone option.
 */
export function classifyCardioKind(
  metadata: Record<string, unknown> | null | undefined,
): CardioKind {
  const m = metadata ?? {};
  const emphasis = String(m.emphasis ?? "").toLowerCase();
  const protocol = String(m.protocol ?? "").toLowerCase();
  const zone = String(m.zone ?? "").toUpperCase();

  if (
    emphasis.includes("alactic") ||
    protocol.includes("alactic") ||
    protocol.includes("tabata") ||
    protocol.includes("30s-on") ||
    protocol.includes("sprint")
  ) {
    return "cardio_alactic";
  }
  if (
    protocol.includes("4x4") ||
    protocol.includes("4×4") ||
    protocol.includes("vo2") ||
    protocol.includes("1km") ||
    protocol.includes("1k") ||
    protocol.includes("400m") ||
    zone === "Z5"
  ) {
    return "cardio_vo2";
  }
  if (zone === "Z3" || zone === "Z4") {
    return "cardio_threshold";
  }
  return "cardio_z2";
}

/** Pick a UI grouping bucket from a movement's modality metadata. */
export function classifyCardioModality(
  metadata: Record<string, unknown> | null | undefined,
): CardioModality {
  const modality = String(metadata?.modality ?? "").toLowerCase();
  if (modality === "running") return "running";
  if (modality === "cycling") return "cycling";
  if (modality === "rowing") return "rowing";
  return "other";
}

/**
 * Maps a movement's `equipment` slug to the CardioMachineType it
 * requires from the user's home gym, or `null` when the movement
 * doesn't need any tracked cardio machine (outdoor running, swimming,
 * rucking, jump rope, ...).
 */
export function cardioMachineRequirement(
  equipment: string | null | undefined,
): CardioMachineType | "any_bike" | "no_match" | null {
  if (!equipment) return null;
  const eq = equipment.toLowerCase();
  if (eq === "treadmill") return "treadmill";
  if (eq === "erg") return "rower";
  if (eq === "stationary-bike" || eq === "spin-bike") return "any_bike";
  if (eq === "ski-erg") return "ski_erg";
  if (eq === "elliptical") return "elliptical";
  // Stair machine has no slot in CardioMachineType — gate it as
  // "no_match" so it only appears when the user owns no cardio gear
  // (i.e. "show everything").
  if (eq === "stair-machine") return "no_match";
  // Outdoor / unrestricted: shoes, road-bike, mountain-bike, track,
  // outdoor-hill, pool, open-water, rucksack, rucksack-outdoor,
  // jump-rope, shoes-track, etc.
  return null;
}

/** True when the user can use a movement given their owned cardio gear. */
export function movementMatchesEquipment(
  equipment: string | null | undefined,
  owned: readonly CardioMachineType[],
): boolean {
  // No cardio gear declared → show everything (running is always
  // available; the user may have a gym membership for the rest).
  if (owned.length === 0) return true;
  const req = cardioMachineRequirement(equipment);
  if (req === null) return true;
  if (req === "no_match") return false;
  if (req === "any_bike") {
    return owned.includes("bike_air") || owned.includes("bike_recumbent");
  }
  return owned.includes(req);
}

export type FilteredCardioGroup = {
  modality: CardioModality;
  movements: CardioCandidate[];
};

const MODALITY_ORDER: CardioModality[] = [
  "running",
  "cycling",
  "rowing",
  "other",
];

/**
 * Filter a flat candidate list to options compatible with the target
 * `cardioKind` and the user's owned cardio equipment. Returns the
 * survivors grouped by modality in a stable order so the picker
 * doesn't reshuffle between renders.
 */
export function filterCardioCandidates(
  candidates: readonly CardioCandidate[],
  options: {
    targetKind: CardioKind;
    ownedCardio: readonly CardioMachineType[];
    excludeMovementId?: string;
  },
): FilteredCardioGroup[] {
  const survivors = candidates.filter((c) => {
    if (c.id === options.excludeMovementId) return false;
    if (c.pattern !== "cardio") return false;
    if (classifyCardioKind(c.metadata) !== options.targetKind) return false;
    if (!movementMatchesEquipment(c.equipment, options.ownedCardio)) return false;
    return true;
  });
  const grouped = new Map<CardioModality, CardioCandidate[]>();
  for (const c of survivors) {
    const mod = classifyCardioModality(c.metadata);
    const arr = grouped.get(mod) ?? [];
    arr.push(c);
    grouped.set(mod, arr);
  }
  const out: FilteredCardioGroup[] = [];
  for (const mod of MODALITY_ORDER) {
    const movements = grouped.get(mod);
    if (movements && movements.length > 0) {
      out.push({ modality: mod, movements });
    }
  }
  return out;
}

export const MODALITY_LABEL: Record<CardioModality, string> = {
  running: "Running",
  cycling: "Cycling",
  rowing: "Rowing",
  other: "Other",
};
