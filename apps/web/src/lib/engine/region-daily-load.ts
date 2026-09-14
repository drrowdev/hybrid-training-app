/**
 * Canonical daily region-load derivation shared by the persisted region ledger
 * and the live region-freshness read. Keep all per-log filtering, load math,
 * region weighting, and local-day attribution here.
 */
import { ALL_REGIONS, type Region } from "@hta/domain";
import { ymdInTimezone } from "@/lib/dates";
import { MODALITY_REGION } from "@/lib/cardio/modality-region";
import { structuredSwimRegions } from "@/lib/swim/load";
import {
  CARDIO_LOAD_SCALAR,
  computeSetLoad,
  isCountableSet,
  PRIMARY_REGION_WEIGHT,
  SECONDARY_REGION_WEIGHT,
} from "./set-load";
import { cardioIntensityScalar, normaliseHrZones } from "./cardio-intensity";

type RegionRefs = {
  primary_region: string | null;
  secondary_regions: unknown;
};

export type RegionLoadSet = {
  performedAt: string;
  weightKg: number | string | null;
  reps: number | null;
  rpe: number | string | null;
  setKind: string | null;
  skipped: boolean | null;
  movement: unknown;
};

export type RegionLoadCardio = {
  performedAt: string;
  durationSec: number | null;
  rpe: number | string | null;
  modality: string | null;
  hrZones: unknown;
  swimResult?: unknown;
  movement: unknown;
};

export type DailyRegionLoad = Map<Region, Map<string, number>>;

export function deriveDailyRegionLoad(args: {
  sets: readonly RegionLoadSet[];
  cardio: readonly RegionLoadCardio[];
  userTz: string;
}): DailyRegionLoad {
  const dailyLoad = new Map<Region, Map<string, number>>(
    ALL_REGIONS.map((region) => [region, new Map<string, number>()]),
  );

  for (const set of args.sets) {
    if (!isCountableSet({ setKind: set.setKind, isSkipped: set.skipped })) {
      continue;
    }
    const movement = normaliseMovement(set.movement);
    const date = localYmd(set.performedAt, args.userTz);
    if (!movement || !date) continue;

    const load = computeSetLoad({
      sets: 1,
      reps: Number(set.reps),
      weightKg: Number(set.weightKg),
      rpe: set.rpe == null ? null : Number(set.rpe),
    });
    if (load > 0) creditRegions(dailyLoad, movement, date, load);
  }

  for (const cardio of args.cardio) {
    const swim = structuredSwimRegions(cardio.swimResult);
    const movement = normaliseMovement(cardio.movement) ?? modalityFallback(cardio.modality);
    const date = localYmd(cardio.performedAt, args.userTz);
    const durationSec = Number(cardio.durationSec);
    if ((!swim && !movement) || !date || durationSec <= 0) continue;

    const load =
      (durationSec / 60) *
      cardioIntensityScalar({
        hrZones: normaliseHrZones(cardio.hrZones),
        durationSec,
        rpe: cardio.rpe == null ? null : Number(cardio.rpe),
      }) *
      CARDIO_LOAD_SCALAR;
    if (load > 0 && swim) {
      for (const region of swim.primaryRegions) addLoad(dailyLoad, region, date, load * PRIMARY_REGION_WEIGHT);
      for (const region of swim.secondaryRegions) addLoad(dailyLoad, region, date, load * SECONDARY_REGION_WEIGHT);
    } else if (load > 0 && movement) {
      creditRegions(dailyLoad, movement, date, load);
    }
  }

  return dailyLoad;
}

function normaliseMovement(value: unknown): RegionRefs | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as RegionRefs | undefined) ?? null;
  return value as RegionRefs;
}

function modalityFallback(modality: string | null): RegionRefs | null {
  if (!modality) return null;
  const mapped = MODALITY_REGION[modality];
  if (!mapped) return null;
  return {
    primary_region: mapped.primaryRegion,
    secondary_regions: mapped.secondaryRegions,
  };
}

function localYmd(performedAt: string, userTz: string): string | null {
  const instant = new Date(performedAt);
  if (Number.isNaN(instant.getTime())) return null;
  return ymdInTimezone(instant, userTz);
}

function creditRegions(
  dailyLoad: DailyRegionLoad,
  movement: RegionRefs,
  date: string,
  load: number,
): void {
  if (
    movement.primary_region &&
    ALL_REGIONS.includes(movement.primary_region as Region)
  ) {
    addLoad(
      dailyLoad,
      movement.primary_region as Region,
      date,
      load * PRIMARY_REGION_WEIGHT,
    );
  }

  if (!Array.isArray(movement.secondary_regions)) return;
  for (const secondary of movement.secondary_regions) {
    if (typeof secondary !== "string" || !ALL_REGIONS.includes(secondary as Region)) {
      continue;
    }
    addLoad(
      dailyLoad,
      secondary as Region,
      date,
      load * SECONDARY_REGION_WEIGHT,
    );
  }
}

function addLoad(
  dailyLoad: DailyRegionLoad,
  region: Region,
  date: string,
  load: number,
): void {
  const series = dailyLoad.get(region)!;
  series.set(date, (series.get(date) ?? 0) + load);
}
