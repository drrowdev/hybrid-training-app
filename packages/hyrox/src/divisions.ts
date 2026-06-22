/**
 * HYROX — race format & division station standards (ADR 0050).
 *
 * This is PUBLISHED FACT, not calibration: the 8 stations, their order, distances
 * and rep counts, and the Open / Pro / Doubles loads are HYROX competition-rule
 * standards. They are data, not engine coefficients — CP-1…CP-5 do not apply.
 *
 * VERIFIED against the official HYROX 2025/26 Singles Rulebook §9 (Movement
 * Standards, Distances and Weights), maintain.hyrox.com/rulebooks/
 * HYROX_RulebookSingles_EN.pdf (retrieved 2026-06-15). The rulebook's three
 * singles weight tiers map onto our open/pro × men/women matrix exactly:
 *   - "Women"            → Open women
 *   - "Women Pro / Men"  → Open men  AND  Pro women   (the shared middle tier)
 *   - "Men Pro"          → Pro men
 * Loads are still surfaced to the athlete as a reference to CONFIRM at logging
 * time (HYROX can revise standards season to season), never as a silently-
 * authoritative number. Doubles uses Open loads with the work shared between two
 * athletes.
 */

import type { HyroxDivision } from "./types";

/** A per-gender load (kg). `perHand` carries (e.g. farmers) state the single-hand load. */
export interface StationLoad {
  /** Men's standard (kg). */
  men: number;
  /** Women's standard (kg). */
  women: number;
  /** True when the value is the load PER HAND (farmers carry). */
  perHand?: boolean;
}

export interface HyroxStation {
  /** Race order (1–8). */
  order: number;
  /** Movement catalog key. */
  movement: string;
  name: string;
  /** Distance in meters, when the station is distance-based. */
  distanceM?: number;
  /** Rep count, when the station is rep-based. */
  reps?: number;
  /** Open-division load (absent = bodyweight / unloaded ergo). */
  open?: StationLoad;
  /** Pro-division load. */
  pro?: StationLoad;
  /** A short note (target height, technique cue). */
  note?: string;
}

/**
 * The 8 stations in race order, each preceded by a 1 km run. Doubles loads = Open
 * (work split between partners). Loads are competition standards — confirm at log.
 */
export const HYROX_STATIONS: HyroxStation[] = [
  {
    order: 1,
    movement: "skierg",
    name: "SkiErg",
    distanceM: 1000,
    note: "1000 m on the SkiErg — full-body double-pole. No added load.",
  },
  {
    order: 2,
    movement: "sled-push",
    name: "Sled Push",
    distanceM: 50,
    open: { men: 152, women: 102 },
    pro: { men: 202, women: 152 },
    note: "50 m (4 × 12.5 m lengths). Load INCLUDES the sled. Stay low, drive through the legs.",
  },
  {
    order: 3,
    movement: "sled-pull",
    name: "Sled Pull",
    distanceM: 50,
    open: { men: 103, women: 78 },
    pro: { men: 153, women: 103 },
    note: "50 m hand-over-hand pull. Load includes the sled. Hips back, big pulls.",
  },
  {
    order: 4,
    movement: "burpee-broad-jump",
    name: "Burpee Broad Jumps",
    distanceM: 80,
    note: "80 m of burpee → broad jump. Bodyweight. Pace it — a notorious heart-rate spike.",
  },
  {
    order: 5,
    movement: "rowing-erg",
    name: "Row",
    distanceM: 1000,
    note: "1000 m on the rower. No added load. Legs–hips–arms sequencing.",
  },
  {
    order: 6,
    movement: "farmers-carry",
    name: "Farmers Carry",
    distanceM: 200,
    open: { men: 24, women: 16, perHand: true },
    pro: { men: 32, women: 24, perHand: true },
    note: "200 m carry, load PER HAND (two kettlebells). Grip + postural endurance.",
  },
  {
    order: 7,
    movement: "sandbag-lunge",
    name: "Sandbag Lunges",
    distanceM: 100,
    open: { men: 20, women: 10 },
    pro: { men: 30, women: 20 },
    note: "100 m walking lunges with the sandbag on the back/shoulders.",
  },
  {
    order: 8,
    movement: "wall-ball",
    name: "Wall Balls",
    reps: 100,
    open: { men: 6, women: 4 },
    pro: { men: 9, women: 6 },
    note: "100 reps to the target. Squat depth + full extension each rep.",
  },
];

const BY_MOVEMENT = new Map(HYROX_STATIONS.map((s) => [s.movement, s]));

export function getStation(movement: string): HyroxStation | undefined {
  return BY_MOVEMENT.get(movement);
}

/** Human "Open: 152 kg — confirm yours" reference for a loaded station. When the
 *  athlete's `gender` is known, only their standard is shown; otherwise both are
 *  surfaced ("M 152 / W 102") to confirm at log time. "" if unloaded. */
export function stationLoadLabel(
  station: HyroxStation,
  division: HyroxDivision,
  gender?: "male" | "female",
): string {
  // Doubles uses Open loads (shared between partners).
  const load = division === "pro" ? station.pro : station.open;
  if (!load) return "";
  const per = load.perHand ? "/hand" : "";
  const tier = division === "pro" ? "Pro" : division === "doubles" ? "Open (shared)" : "Open";
  if (gender === "male") return `${tier}: ${load.men} kg${per} — confirm yours`;
  if (gender === "female") return `${tier}: ${load.women} kg${per} — confirm yours`;
  return `${tier}: M ${load.men} kg${per} / W ${load.women} kg${per} — confirm yours`;
}

/** Wall-ball target height by competition standard: 3.0 m men / 2.7 m women. */
export function wallBallTargetLabel(gender?: "male" | "female"): string {
  if (gender === "male") return "target 3.0 m";
  if (gender === "female") return "target 2.7 m";
  return "target 3.0 m men / 2.7 m women";
}

/**
 * Compact race-load summary for the LOADED stations among a set of movement keys
 * (sled push/pull, farmers, sandbag lunge, wall ball). Used to surface the
 * gender-correct weights on every station session — intervals, circuits,
 * compromised runs — not just simulations. Unloaded movements (run / ski / row /
 * burpee) contribute nothing. Returns "" when no loaded station is present.
 */
export function stationLoadsSummary(
  movements: readonly string[],
  division: HyroxDivision,
  gender?: "male" | "female",
): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const m of movements) {
    if (seen.has(m)) continue;
    seen.add(m);
    const st = getStation(m);
    if (!st) continue;
    const load = division === "pro" ? st.pro : st.open;
    if (!load) continue; // unloaded ergo / bodyweight station
    const per = load.perHand ? "/hand" : "";
    if (gender === "male") parts.push(`${st.name} ${load.men} kg${per}`);
    else if (gender === "female") parts.push(`${st.name} ${load.women} kg${per}`);
    else parts.push(`${st.name} ${load.men}/${load.women} kg${per}`);
  }
  if (parts.length === 0) return "";
  const tier = division === "pro" ? "Pro" : division === "doubles" ? "Open (shared)" : "Open";
  return `${tier} race loads — ${parts.join(", ")} (confirm yours).`;
}

/** A station's distance/reps/height target as a short label (e.g. "50 m", "100 reps"). */
export function stationTargetLabel(station: HyroxStation, gender?: "male" | "female"): string {
  if (station.movement === "wall-ball") {
    const height = gender === "female" ? "2.7 m" : gender === "male" ? "3.0 m" : "3.0/2.7 m";
    return station.reps != null ? `${station.reps} reps · target ${height}` : `target ${height}`;
  }
  if (station.reps != null) return `${station.reps} reps`;
  if (station.distanceM != null) return `${station.distanceM} m`;
  return "";
}

/** A station's gender/division-correct working load as a bare label (e.g. "152 kg", "24 kg/hand"). "" when unloaded. */
export function stationLoadValue(
  station: HyroxStation,
  division: HyroxDivision,
  gender?: "male" | "female",
): string {
  const load = division === "pro" ? station.pro : station.open;
  if (!load) return "";
  const per = load.perHand ? " kg/hand" : " kg";
  if (gender === "male") return `${load.men}${per}`;
  if (gender === "female") return `${load.women}${per}`;
  return `${load.men}/${load.women}${per}`;
}

/**
 * Structured per-station rows (name + gender-correct load + target) for a set of
 * movement keys, in the order given. Drives the clean station list in
 * CardioPlanView. Unknown/non-station movements are skipped.
 */
export function stationRows(
  movements: readonly string[],
  division: HyroxDivision,
  gender?: "male" | "female",
): { name: string; load?: string; target?: string }[] {
  const seen = new Set<string>();
  const rows: { name: string; load?: string; target?: string }[] = [];
  for (const m of movements) {
    if (seen.has(m)) continue;
    seen.add(m);
    const st = getStation(m);
    if (!st) continue;
    const load = stationLoadValue(st, division, gender);
    const target = stationTargetLabel(st, gender);
    rows.push({
      name: st.name,
      ...(load ? { load } : {}),
      ...(target ? { target } : {}),
    });
  }
  return rows;
}
