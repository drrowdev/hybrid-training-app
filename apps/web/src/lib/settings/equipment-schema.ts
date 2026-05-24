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
 *    field is "off vs. on with a value" — dumbbells and accessories'
 *    weighted vest / sandbag use `null` / `false` to mark absence.
 */

export type EquipmentPreset =
  | "commercial_gym"
  | "home_gym"
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

export type CardioMachineType =
  | "treadmill"
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
  rower: "Rower",
  bike_air: "Air bike",
  bike_recumbent: "Recumbent bike",
  ski_erg: "Ski erg",
  elliptical: "Elliptical",
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
    weightedVest: { kg: number } | false;
    sandbag: { kg: number } | false;
    dipBelt: boolean;
    bands: boolean;
    pullUpBar: boolean;
    rings: boolean;
  };
};

const PRESETS: ReadonlySet<EquipmentPreset> = new Set<EquipmentPreset>([
  "commercial_gym",
  "home_gym",
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
  const vestKg = accRaw.weightedVest && typeof accRaw.weightedVest === "object"
    ? Number((accRaw.weightedVest as Record<string, unknown>).kg)
    : null;
  const sandbagKg = accRaw.sandbag && typeof accRaw.sandbag === "object"
    ? Number((accRaw.sandbag as Record<string, unknown>).kg)
    : null;
  if (vestKg !== null && (!isPositive(vestKg) || vestKg > 100)) {
    throw new Error("Weighted vest weight must be 0–100 kg");
  }
  if (sandbagKg !== null && (!isPositive(sandbagKg) || sandbagKg > 200)) {
    throw new Error("Sandbag weight must be 0–200 kg");
  }
  const accessories: Equipment["accessories"] = {
    weightedVest: vestKg !== null ? { kg: vestKg } : false,
    sandbag: sandbagKg !== null ? { kg: sandbagKg } : false,
    dipBelt: Boolean(accRaw.dipBelt),
    bands: Boolean(accRaw.bands),
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
