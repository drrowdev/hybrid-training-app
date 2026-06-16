/**
 * Equipment presets + the read-time fallback helper used everywhere
 * the app needs to know what kit the user has.
 *
 * Why presets over a wizard:
 *  - The 80% case (commercial gym member, home garage, hotel gym) is
 *    short-circuited to a single click. Custom users still get the
 *    full form.
 *  - Manually editing any field after selecting a preset auto-flips
 *    the preset to "Custom" in the editor — that logic lives in the
 *    editor, not here. Here we only describe what each preset is.
 *
 * Read-time fallback (`resolveEquipment`):
 *  - `profile.equipment` present → returned as-is (after a defensive
 *    parse so legacy partial blobs don't break callers).
 *  - `profile.equipment` NULL but legacy fields exist → lift the
 *    legacy bar weights + plate inventory into the new shape with
 *    `preset = "custom"` so the user doesn't get silently swapped
 *    onto the Commercial-gym preset on their next save.
 *  - Both NULL → Commercial-gym preset (the most-likely-correct
 *    default for a new user).
 */

import {
  parseEquipment,
  type Equipment,
  type EquipmentPreset,
} from "./equipment-schema";

export const COMMERCIAL_GYM_PRESET: Equipment = {
  preset: "commercial_gym",
  bars: { barbellKg: 20, trapBarKg: 25, safetyBarKg: 25 },
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
  dumbbells: { minKg: 1, maxKg: 50, stepKg: 2.5 },
  kettlebells: [8, 12, 16, 20, 24, 28, 32, 40],
  machines: [
    "cable_stack",
    "leg_press",
    "leg_curl",
    "leg_extension",
    "smith_machine",
    "lat_pulldown",
    "seated_row",
    "chest_press",
    "hack_squat",
    "hip_thrust",
  ],
  cardio: ["treadmill", "rower", "bike_air", "bike_recumbent", "ski_erg", "elliptical"],
  accessories: {
    weightedVest: [],
    sandbag: [],
    dipBelt: true,
    dipBeltMaxKg: null,
    bands: true,
    bandStrength: "medium",
    ankleWeights: false,
    pullUpBar: true,
    rings: false,
    sled: false,
    wallBall: false,
  },
};

/**
 * Functional / cross-training-style gym: full barbell + bumper plate
 * setup, full dumbbell + kettlebell range, no isolation machines,
 * conditioning ergs (rower / ski-erg / air bike / curved treadmill),
 * pull-up bar + rings, a vest and a sandbag.
 */
export const FUNCTIONAL_GYM_PRESET: Equipment = {
  preset: "functional_gym",
  bars: { barbellKg: 20, trapBarKg: null, safetyBarKg: null },
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
  dumbbells: { minKg: 5, maxKg: 50, stepKg: 2.5 },
  kettlebells: [8, 12, 16, 20, 24, 28, 32],
  machines: [],
  cardio: ["rower", "ski_erg", "bike_air", "treadmill"],
  accessories: {
    weightedVest: [9],
    sandbag: [25],
    dipBelt: false,
    dipBeltMaxKg: null,
    bands: true,
    bandStrength: "medium",
    ankleWeights: false,
    pullUpBar: true,
    rings: true,
    sled: true,
    wallBall: true,
  },
};

export const HOME_GYM_PRESET: Equipment = {
  preset: "home_gym",
  bars: { barbellKg: 20, trapBarKg: null, safetyBarKg: null },
  plates: [20, 15, 10, 5, 2.5, 1.25],
  dumbbells: null,
  kettlebells: [16, 24, 32],
  machines: [],
  cardio: [],
  accessories: {
    weightedVest: [10],
    sandbag: [20],
    dipBelt: true,
    dipBeltMaxKg: 40,
    bands: true,
    bandStrength: "medium",
    ankleWeights: false,
    pullUpBar: true,
    rings: false,
    sled: false,
    wallBall: false,
  },
};

/**
 * Bodyweight-only: no loadable kit. We keep a pull-up bar as the
 * realistic floor — most bodyweight programmes assume one — but
 * everything else is off. Detection of "should we ask for training
 * maxes?" downstream keys off `bars.barbellKg === 0 && trapBarKg ===
 * null && safetyBarKg === null && dumbbells === null`, which matches
 * this shape exactly.
 */
export const BODYWEIGHT_ONLY_PRESET: Equipment = {
  preset: "bodyweight_only",
  bars: { barbellKg: 0, trapBarKg: null, safetyBarKg: null },
  plates: [],
  dumbbells: null,
  kettlebells: [],
  machines: [],
  cardio: [],
  accessories: {
    weightedVest: [],
    sandbag: [],
    dipBelt: false,
    dipBeltMaxKg: null,
    bands: false,
    bandStrength: null,
    ankleWeights: false,
    pullUpBar: true,
    rings: false,
    sled: false,
    wallBall: false,
  },
};

export const TRAVEL_HOTEL_PRESET: Equipment = {
  preset: "travel_hotel",
  // No bar in a hotel gym — barbellKg = 0 signals "no bar" without
  // making the field nullable on a type that's expected to be present.
  bars: { barbellKg: 0, trapBarKg: null, safetyBarKg: null },
  plates: [],
  dumbbells: { minKg: 5, maxKg: 25, stepKg: 2.5 },
  kettlebells: [],
  machines: ["cable_stack"],
  cardio: ["treadmill", "elliptical", "bike_recumbent"],
  accessories: {
    weightedVest: [],
    sandbag: [],
    dipBelt: false,
    dipBeltMaxKg: null,
    bands: true,
    bandStrength: "light",
    ankleWeights: false,
    pullUpBar: false,
    rings: false,
    sled: false,
    wallBall: false,
  },
};

export const CUSTOM_EMPTY_PRESET: Equipment = {
  preset: "custom",
  bars: { barbellKg: 20, trapBarKg: null, safetyBarKg: null },
  plates: [],
  dumbbells: null,
  kettlebells: [],
  machines: [],
  cardio: [],
  accessories: {
    weightedVest: [],
    sandbag: [],
    dipBelt: false,
    dipBeltMaxKg: null,
    bands: false,
    bandStrength: null,
    ankleWeights: false,
    pullUpBar: false,
    rings: false,
    sled: false,
    wallBall: false,
  },
};

export const PRESET_BY_KEY: Record<EquipmentPreset, Equipment> = {
  commercial_gym: COMMERCIAL_GYM_PRESET,
  functional_gym: FUNCTIONAL_GYM_PRESET,
  home_gym: HOME_GYM_PRESET,
  bodyweight_only: BODYWEIGHT_ONLY_PRESET,
  travel_hotel: TRAVEL_HOTEL_PRESET,
  custom: CUSTOM_EMPTY_PRESET,
};

export const PRESET_LABEL: Record<EquipmentPreset, string> = {
  commercial_gym: "Commercial gym",
  functional_gym: "Functional gym",
  home_gym: "Home gym",
  bodyweight_only: "Bodyweight only",
  travel_hotel: "Travel / hotel",
  custom: "Custom",
};

export const PRESET_HINT: Record<EquipmentPreset, string> = {
  commercial_gym: "Full barbell + machines + cardio. The 80% gym member case.",
  functional_gym:
    "Barbells, bumper plates, kettlebells, rower / ski-erg / curved treadmill. No isolation machines.",
  home_gym: "Barbell, plates, kettlebells, pull-up bar. No machines.",
  bodyweight_only: "Pull-up bar only. No loadable kit.",
  travel_hotel: "Hotel-gym dumbbells + treadmill. No barbell.",
  custom: "Start from an empty inventory and add only what you have.",
};

/**
 * Does this equipment configuration imply at least one loadable main
 * lift (barbell, trap bar, safety squat bar, or dumbbell range)?
 *
 * Used by the onboarding step machine to skip the Training Maxes step
 * for bodyweight-only setups (no number to multiply against), and by
 * the planner / UI to surface the soft "bodyweight programming is in
 * early support" messaging.
 */
export function hasLoadableMainLift(equipment: Equipment): boolean {
  return (
    equipment.bars.barbellKg > 0 ||
    equipment.bars.trapBarKg !== null ||
    equipment.bars.safetyBarKg !== null ||
    equipment.dumbbells !== null
  );
}

/**
 * Reverse-lookup: which preset best describes this stored equipment
 * shape? Compares the canonical fingerprint (bars empty / loadable,
 * dumbbells, kettlebells, machines) rather than trusting the saved
 * `preset` field — that way users who pruned every barbell out of a
 * "commercial gym" save are still recognised as bodyweight.
 *
 * Returns the matched preset key or `"custom"` when nothing fits.
 */
export function presetKeyForScheme(equipment: Equipment): EquipmentPreset {
  const noBars =
    equipment.bars.barbellKg === 0 &&
    equipment.bars.trapBarKg === null &&
    equipment.bars.safetyBarKg === null;
  if (
    noBars &&
    equipment.plates.length === 0 &&
    equipment.dumbbells === null &&
    equipment.kettlebells.length === 0 &&
    equipment.machines.length === 0
  ) {
    return "bodyweight_only";
  }
  return equipment.preset;
}

export type LegacyProfile = {
  equipment?: unknown;
  barbell_kg?: number | string | null;
  trap_bar_kg?: number | string | null;
  plate_inventory_kg?: unknown;
};

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Single canonical resolver. UI imports; never re-derive elsewhere.
 *
 * Returns a fully-typed `Equipment` for any profile shape we'd find
 * in the wild — fresh user (everything null), pre-PR-71 (legacy
 * defaults from migration 0038), post-PR-71 user that already saved
 * a plate inventory, or post-this-PR user with a JSONB equipment
 * blob.
 */
export function resolveEquipment(profile: LegacyProfile | null | undefined): Equipment {
  if (profile?.equipment && typeof profile.equipment === "object") {
    try {
      return parseEquipment(profile.equipment);
    } catch {
      // Fall through to legacy lift / preset default if the blob is
      // corrupt rather than throwing into the render path.
    }
  }

  const legacyBarbell = num(profile?.barbell_kg);
  const legacyTrapBar = num(profile?.trap_bar_kg);
  const legacyPlatesRaw = Array.isArray(profile?.plate_inventory_kg)
    ? (profile?.plate_inventory_kg as Array<{ weight_kg?: number; pair_count?: number }>)
    : null;

  const hasLegacyData =
    legacyBarbell !== null ||
    legacyTrapBar !== null ||
    (legacyPlatesRaw && legacyPlatesRaw.length > 0);

  if (!hasLegacyData) {
    return COMMERCIAL_GYM_PRESET;
  }

  // Migration-0038 defaults look identical to a "I never touched this"
  // row. Treat those as Commercial-gym so the new editor doesn't
  // present a half-empty Custom form to someone who never opted in.
  const legacyPlates = (legacyPlatesRaw ?? [])
    .map((p) => Number(p.weight_kg))
    .filter((n) => Number.isFinite(n) && n > 0);

  const onlyDefaults =
    legacyBarbell === 20 &&
    (legacyTrapBar === null || legacyTrapBar === 25) &&
    legacyPlates.length === 7 &&
    [25, 20, 15, 10, 5, 2.5, 1.25].every((w) => legacyPlates.includes(w));
  if (onlyDefaults) {
    return COMMERCIAL_GYM_PRESET;
  }

  return {
    preset: "custom",
    bars: {
      barbellKg: legacyBarbell ?? 20,
      trapBarKg: legacyTrapBar ?? null,
      safetyBarKg: null,
    },
    plates: Array.from(new Set(legacyPlates)).sort((a, b) => b - a),
    dumbbells: COMMERCIAL_GYM_PRESET.dumbbells,
    kettlebells: [...COMMERCIAL_GYM_PRESET.kettlebells],
    machines: [...COMMERCIAL_GYM_PRESET.machines],
    cardio: [...COMMERCIAL_GYM_PRESET.cardio],
    accessories: { ...COMMERCIAL_GYM_PRESET.accessories },
  };
}
