/**
 * Hand-rolled type definitions + validators for the rich equipment
 * inventory stored in `profiles.equipment` (see migration 0040). The
 * validator lives at the boundary between FormData → JSONB write, so
 * we don't pull a new dep just to assert a few shape rules.
 *
 * Storage rules:
 *  - All weights in kilograms.
 *  - `plates` sorted desc; `kettlebells` sorted asc; arrays are
 *    deduplicated by the server action before persisting.
 *  - Empty arrays (rather than null) for "no items" except where the
 *    dumbbell range uses `null` to mark absence (it's a {min,max,step}
 *    triple, not a list). Weighted vest + sandbag are `number[]` (one
 *    chip per vest/bag the user owns; empty array = none).
 */

export type EquipmentPreset =
  | "commercial_gym"
  | "functional_gym"
  | "home_gym"
  | "bodyweight_only"
  | "travel_hotel"
  | "custom";

export type MachineType =
  | "cable_stack"
  | "leg_press"
  | "leg_curl"
  | "leg_extension"
  | "smith_machine"
  | "lat_pulldown"
  | "seated_row"
  | "chest_press"
  | "hack_squat"
  | "hip_thrust";

// Cardio modality is stored but not currently consumed by the planner;
// the value persists for future modality-aware cardio prescriptions.
export type CardioMachineType =
  | "treadmill"
  | "treadmill_curved"
  | "rower"
  | "bike_air"
  | "bike_recumbent"
  | "ski_erg"
  | "elliptical";

export const ALL_MACHINES: readonly MachineType[] = [
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
];

export const ALL_CARDIO: readonly CardioMachineType[] = [
  "treadmill",
  "treadmill_curved",
  "rower",
  "bike_air",
  "bike_recumbent",
  "ski_erg",
  "elliptical",
];

export const MACHINE_LABEL: Record<MachineType, string> = {
  cable_stack: "Cable stack",
  leg_press: "Leg press",
  leg_curl: "Leg curl",
  leg_extension: "Leg extension",
  smith_machine: "Smith machine",
  lat_pulldown: "Lat pulldown",
  seated_row: "Seated row",
  chest_press: "Chest press",
  hack_squat: "Hack squat",
  hip_thrust: "Hip thrust",
};

export const CARDIO_LABEL: Record<CardioMachineType, string> = {
  treadmill: "Treadmill",
  treadmill_curved: "Curved / manual treadmill",
  rower: "Rower",
  bike_air: "Air bike",
  bike_recumbent: "Recumbent bike",
  ski_erg: "Ski erg",
  elliptical: "Elliptical",
};

/**
 * Band-strength bucket. Phase 7 maps these to an approximate kg of
 * assistance for band-assisted negative-rep prescriptions on the BW
 * sub-pull-up nodes. Kept loose — the user picks "what colour band"
 * and the engine reads the assistance ballpark off the bucket.
 */
export type BandStrength = "light" | "medium" | "heavy" | "extra_heavy";

export const ALL_BAND_STRENGTHS: readonly BandStrength[] = [
  "light",
  "medium",
  "heavy",
  "extra_heavy",
];

export const BAND_STRENGTH_LABEL: Record<BandStrength, string> = {
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
  extra_heavy: "Extra-heavy",
};

export type Equipment = {
  preset: EquipmentPreset;
  bars: {
    barbellKg: number;
    trapBarKg: number | null;
    safetyBarKg: number | null;
  };
  plates: number[];
  dumbbells: {
    minKg: number;
    maxKg: number;
    stepKg: number;
  } | null;
  kettlebells: number[];
  machines: MachineType[];
  cardio: CardioMachineType[];
  accessories: {
    /**
     * One chip per vest the user owns, in kg, sorted asc. Empty array
     * = no vest. Legacy `false` / `true` / `<number>` shapes are
     * coerced by `parseEquipment` to `[]` / `[9]` / `[<number>]`.
     */
    weightedVest: number[];
    /**
     * One chip per sandbag, in kg, sorted asc. Empty array = none.
     * Same legacy-coercion rules as `weightedVest`.
     */
    sandbag: number[];
    dipBelt: boolean;
    /**
     * Phase 7 — optional max load the user's dip belt can carry. When
     * present, the loaded-BW suggestion engine caps `externalLoadKg`
     * at this value so it never recommends more weight than the kit
     * can actually hold. `null` = belt present but no cap configured.
     */
    dipBeltMaxKg?: number | null;
    bands: boolean;
    /**
     * Phase 7 — band-strength bucket for the band-assist path (negative
     * pull-up / scapular pull). Maps to an approximate assistance kg
     * in `bw-prescription.ts`. `null` = bands present but strength not
     * configured (engine falls back to "medium" for prescriptions).
     */
    bandStrength?: BandStrength | null;
    /**
     * Phase 7 — ankle-weight pair the user owns, used by the loaded-BW
     * path for single-leg work (split squat / pistol / single-leg RDL)
     * when no vest is present. `kg` = per-pair weight in kg.
     */
    ankleWeights?: { kg: number } | false;
    pullUpBar: boolean;
    rings: boolean;
  };
};

const PRESETS: ReadonlySet<EquipmentPreset> = new Set<EquipmentPreset>([
  "commercial_gym",
  "functional_gym",
  "home_gym",
  "bodyweight_only",
  "travel_hotel",
  "custom",
]);
const MACHINE_SET: ReadonlySet<string> = new Set<string>(ALL_MACHINES);
const CARDIO_SET: ReadonlySet<string> = new Set<string>(ALL_CARDIO);

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function dedupSorted(values: number[], direction: "asc" | "desc"): number[] {
  const cleaned = Array.from(
    new Set(values.filter((v) => isPositive(v)).map((v) => Math.round(v * 100) / 100)),
  );
  cleaned.sort((a, b) => (direction === "asc" ? a - b : b - a));
  return cleaned;
}

/**
 * Coerce a legacy weighted-vest / sandbag value into the new
 * `number[]` shape. Accepts:
 *   - `undefined` / `null` / `false`             → `[]`
 *   - `true`                                     → `[trueDefault]`
 *   - `<number>`                                 → `[<number>]`
 *   - `{ kg: <number> }` (pre-PR shape)          → `[<number>]`
 *   - `number[]`                                 → sorted/deduped
 * Throws on out-of-range values so bad blobs fail loudly.
 */
function coerceKgChips(
  raw: unknown,
  trueDefault: number,
  min: number,
  max: number,
  fieldLabel: string,
): number[] {
  if (raw == null || raw === false) return [];
  if (raw === true) return [trueDefault];
  let values: number[] = [];
  if (typeof raw === "number") {
    values = [raw];
  } else if (Array.isArray(raw)) {
    values = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  } else if (typeof raw === "object") {
    const kg = Number((raw as Record<string, unknown>).kg);
    if (Number.isFinite(kg)) values = [kg];
  }
  for (const v of values) {
    if (!isPositive(v) || v < min || v > max) {
      throw new Error(`${fieldLabel} weight must be ${min}–${max} kg`);
    }
  }
  return dedupSorted(values, "asc");
}

/**
 * Throws on the first invalid field. The editor catches and surfaces
 * the message inline. Mutates nothing — returns a normalised copy.
 */
export function parseEquipment(input: unknown): Equipment {
  if (!input || typeof input !== "object") {
    throw new Error("Equipment payload must be an object");
  }
  const raw = input as Record<string, unknown>;

  const preset = typeof raw.preset === "string" && PRESETS.has(raw.preset as EquipmentPreset)
    ? (raw.preset as EquipmentPreset)
    : "custom";

  const barsRaw = (raw.bars ?? {}) as Record<string, unknown>;
  const barbellKg = Number(barsRaw.barbellKg ?? 20);
  if (!isFiniteNonNegative(barbellKg) || barbellKg > 60) {
    throw new Error("Olympic barbell weight must be between 0 and 60 kg");
  }
  const trapBarKg = barsRaw.trapBarKg == null ? null : Number(barsRaw.trapBarKg);
  if (trapBarKg !== null && (!isFiniteNonNegative(trapBarKg) || trapBarKg > 60)) {
    throw new Error("Trap bar weight must be between 0 and 60 kg");
  }
  const safetyBarKg = barsRaw.safetyBarKg == null ? null : Number(barsRaw.safetyBarKg);
  if (safetyBarKg !== null && (!isFiniteNonNegative(safetyBarKg) || safetyBarKg > 60)) {
    throw new Error("Safety squat bar weight must be between 0 and 60 kg");
  }

  const platesIn = Array.isArray(raw.plates) ? (raw.plates as unknown[]).map(Number) : [];
  if (platesIn.some((p) => p > 100)) {
    throw new Error("Plate weight cannot exceed 100 kg");
  }
  const plates = dedupSorted(platesIn, "desc");

  let dumbbells: Equipment["dumbbells"] = null;
  if (raw.dumbbells && typeof raw.dumbbells === "object") {
    const d = raw.dumbbells as Record<string, unknown>;
    const minKg = Number(d.minKg);
    const maxKg = Number(d.maxKg);
    const stepKg = Number(d.stepKg);
    if (!isPositive(minKg) || !isPositive(maxKg) || !isPositive(stepKg)) {
      throw new Error("Dumbbell range needs positive min/max/step");
    }
    if (maxKg < minKg) {
      throw new Error("Dumbbell max must be ≥ min");
    }
    if (stepKg > maxKg) {
      throw new Error("Dumbbell step must be ≤ max");
    }
    dumbbells = { minKg, maxKg, stepKg };
  }

  const kbIn = Array.isArray(raw.kettlebells)
    ? (raw.kettlebells as unknown[]).map(Number)
    : [];
  const kettlebells = dedupSorted(kbIn, "asc");

  const machinesIn = Array.isArray(raw.machines) ? (raw.machines as unknown[]) : [];
  const machines = Array.from(
    new Set(
      machinesIn.filter((m): m is MachineType => typeof m === "string" && MACHINE_SET.has(m)),
    ),
  );

  const cardioIn = Array.isArray(raw.cardio) ? (raw.cardio as unknown[]) : [];
  const cardio = Array.from(
    new Set(
      cardioIn.filter(
        (c): c is CardioMachineType => typeof c === "string" && CARDIO_SET.has(c),
      ),
    ),
  );

  const accRaw = (raw.accessories ?? {}) as Record<string, unknown>;
  // Weighted vest + sandbag accept legacy shapes silently:
  //   `false` / missing → []
  //   `true`            → [9] (vest) / [25] (sandbag) typical defaults
  //   `<number>`        → [<number>]
  //   `{ kg: <number> }`→ [<number>]            (pre-PR-…shape)
  //   `number[]`        → sorted/deduped
  // The equipment column is jsonb, so the shape change is parse-time;
  // no SQL migration needed.
  const weightedVest = coerceKgChips(accRaw.weightedVest, 9, 0, 100, "Weighted vest");
  const sandbag = coerceKgChips(accRaw.sandbag, 25, 0, 200, "Sandbag");

  // Phase 7 — dipBeltMaxKg / ankleWeights / bandStrength. All optional;
  // parser is permissive — bad values fall back to null/false so legacy
  // blobs without these keys keep working unchanged.
  const dipBeltMaxKgRaw = accRaw.dipBeltMaxKg;
  let dipBeltMaxKg: number | null = null;
  if (dipBeltMaxKgRaw != null) {
    const n = Number(dipBeltMaxKgRaw);
    if (!isPositive(n) || n > 200) {
      throw new Error("Dip-belt max load must be 0–200 kg");
    }
    dipBeltMaxKg = n;
  }
  const ankleWeightsKg =
    accRaw.ankleWeights && typeof accRaw.ankleWeights === "object"
      ? Number((accRaw.ankleWeights as Record<string, unknown>).kg)
      : null;
  if (ankleWeightsKg !== null && (!isPositive(ankleWeightsKg) || ankleWeightsKg > 30)) {
    throw new Error("Ankle-weight (per pair) must be 0–30 kg");
  }
  const bandStrengthRaw = accRaw.bandStrength;
  const bandStrength: BandStrength | null =
    typeof bandStrengthRaw === "string" &&
    (ALL_BAND_STRENGTHS as readonly string[]).includes(bandStrengthRaw)
      ? (bandStrengthRaw as BandStrength)
      : null;

  const accessories: Equipment["accessories"] = {
    weightedVest,
    sandbag,
    dipBelt: Boolean(accRaw.dipBelt),
    dipBeltMaxKg,
    bands: Boolean(accRaw.bands),
    bandStrength,
    ankleWeights: ankleWeightsKg !== null ? { kg: ankleWeightsKg } : false,
    pullUpBar: Boolean(accRaw.pullUpBar),
    rings: Boolean(accRaw.rings),
  };

  return {
    preset,
    bars: { barbellKg, trapBarKg, safetyBarKg },
    plates,
    dumbbells,
    kettlebells,
    machines,
    cardio,
    accessories,
  };
}
