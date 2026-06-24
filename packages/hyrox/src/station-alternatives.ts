/**
 * Per-session station substitutions (ADR 0064).
 *
 * A user may lack the kit for a prescribed HYROX station (no SkiErg, no sled) or
 * want to swap it for another reason. `STATION_ALTERNATIVES` maps each HYROX station
 * to a small curated list of gym-feasible substitutes. A swap is a **relabel**: the
 * station keeps its per-round target (and, for loaded substitutes, the original
 * load/slug for attribution); only the displayed movement and the loaded flag change.
 *
 * `[DEF]`, NOT published fact. Ergs are genuinely interchangeable (ski/row/bike); the
 * loaded-station substitutes are sensible same-pattern swaps. The **sleds have no
 * clean commercial-gym equivalent** — their alternatives are flagged approximate.
 */
import { getStation } from "./divisions";

export interface StationAlternative {
  /** Stable substitute key (not necessarily a HYROX station). */
  key: string;
  /** Display name, e.g. "Bike erg", "DB/KB walking lunge". */
  name: string;
  /** Whether the substitute carries an external load (drives confirm-weight + set-log). */
  loaded: boolean;
  /** When true, no clean equivalent exists — surfaced as an approximate swap (sleds). */
  approximate?: boolean;
}

/** Per-session station override map: original station key → chosen substitute key. */
export type StationOverrides = Record<string, string>;

export const STATION_ALTERNATIVES: Record<string, StationAlternative[]> = {
  skierg: [
    { key: "rowing-erg", name: "Row", loaded: false },
    { key: "bike-erg", name: "Bike erg", loaded: false },
    { key: "echo-bike", name: "Echo / Assault bike", loaded: false },
  ],
  "rowing-erg": [
    { key: "skierg", name: "SkiErg", loaded: false },
    { key: "bike-erg", name: "Bike erg", loaded: false },
    { key: "echo-bike", name: "Echo / Assault bike", loaded: false },
  ],
  "sled-push": [
    { key: "heavy-prowler-free", name: "Heavy DB/KB march", loaded: true, approximate: true },
    { key: "leg-press", name: "Leg press / hack squat", loaded: true, approximate: true },
  ],
  "sled-pull": [
    { key: "heavy-row", name: "Heavy KB/DB row", loaded: true, approximate: true },
    { key: "ring-row", name: "Ring / inverted row", loaded: false, approximate: true },
  ],
  "wall-ball": [
    { key: "db-thruster", name: "DB/KB thruster", loaded: true },
    { key: "goblet-squat", name: "Goblet squat", loaded: true },
  ],
  "sandbag-lunge": [
    { key: "db-walking-lunge", name: "DB/KB walking lunge", loaded: true },
    { key: "bb-lunge", name: "Barbell lunge", loaded: true },
  ],
  "farmers-carry": [
    { key: "db-carry", name: "DB/KB carry", loaded: true },
    { key: "trap-bar-carry", name: "Trap-bar carry", loaded: true },
  ],
  "burpee-broad-jump": [
    { key: "burpees", name: "Burpees (in place)", loaded: false },
    { key: "broad-jumps", name: "Broad jumps", loaded: false },
  ],
};

/** The curated substitutes for a station (empty when none defined). */
export function stationAlternativesFor(stationKey: string): StationAlternative[] {
  return STATION_ALTERNATIVES[stationKey] ?? [];
}

/** Resolve a chosen substitute for an original station, or undefined if not allowed. */
export function findStationAlternative(
  originalKey: string,
  substituteKey: string,
): StationAlternative | undefined {
  return stationAlternativesFor(originalKey).find((a) => a.key === substituteKey);
}

/** True when the substitute chosen for a station carries an external load. */
export function isOverrideLoaded(originalKey: string, overrides?: StationOverrides): boolean {
  const sub = overrides?.[originalKey];
  if (!sub) return getStation(originalKey)?.open != null;
  return findStationAlternative(originalKey, sub)?.loaded ?? false;
}

/** The display name for a (possibly overridden) station movement key. */
export function overriddenStationName(originalKey: string, overrides?: StationOverrides): string {
  const sub = overrides?.[originalKey];
  if (sub) {
    const alt = findStationAlternative(originalKey, sub);
    if (alt) return alt.name;
  }
  return getStation(originalKey)?.name ?? originalKey;
}

/**
 * Apply a per-session override map to engine-built station rows: relabel the name and,
 * for unloaded substitutes, drop the load. The per-round `target` and the row `key`
 * (original station) are preserved so completion/attribution still resolve.
 */
export function applyOverridesToStationRows<
  T extends { name: string; load?: string; target?: string; key?: string },
>(rows: T[], overrides?: StationOverrides): T[] {
  if (!overrides || Object.keys(overrides).length === 0) return rows;
  return rows.map((row) => {
    const sub = row.key ? overrides[row.key] : undefined;
    if (!sub || !row.key) return row;
    const alt = findStationAlternative(row.key, sub);
    if (!alt) return row;
    const next = { ...row, name: alt.name };
    if (!alt.loaded) delete (next as { load?: string }).load;
    return next;
  });
}
