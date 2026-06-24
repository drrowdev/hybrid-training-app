/**
 * HYROX completion → actuals materialization (ADR 0050 step 7, pure core).
 *
 * When a user completes a structured HYROX session (a run/erg/interval/circuit/
 * compromised/simulation — NOT a strength session, which uses the normal
 * per-movement logger), they enter ONE total time + ONE session RPE and confirm
 * the loaded-station weights. This module turns that into the ACTUAL log rows the
 * freshness/load engine reads — so muscle/region freshness moves only AFTER
 * completion (ADR 0050), exactly like any other logged session.
 *
 * The model (a documented heuristic — reuses the existing CP-2 load engine, adds
 * NO new physiological constant; it only ROUTES the standardized prescription into
 * the existing actuals shapes):
 *
 *   1. One `cardio_logs` row capturing the whole-session conditioning load:
 *      duration = total time, rpe = session RPE, modality = a raw MODALITY_REGION
 *      key (run/ski/row/bike/other_cardio) so the region-ledger + 2-factor
 *      load/interference engine (sRPE×duration — Foster 2001) attribute it. HR-zone
 *      data from a Strava import sharpens the intensity downstream.
 *   2. One `set_logs` row per LOADED station physically performed (sled push/pull,
 *      farmers carry, sandbag lunge, wall ball) at the confirmed weight + the
 *      station's standardized reps/distance + the session RPE. These add the
 *      station-specific muscle attribution (legs / back / delts / grip) via the
 *      movements catalog tags seeded in migration 0107.
 *
 * Bodyweight stations (burpee broad jumps) and the ergs (ski/row) are captured by
 * the session-modality fanout rather than separate rows — they carry no external
 * load to confirm. This is intentionally simple; richer per-erg attribution can
 * be layered later without changing this contract.
 */
import { getHyroxSession, getStation, type HyroxSession } from "@hta/hyrox";

/** HR-zone distribution shape Strava import produces (seconds per zone). */
export type HrZones = Record<string, number>;

export interface HyroxCompletionInput {
  /** Total session time in seconds (manual entry or Strava-filled). */
  totalDurationSec: number;
  /** Session-level RPE, 1–10. */
  sessionRpe: number;
  /** Confirmed/adjusted loaded-station weights (engine station key → kg). */
  confirmedWeightsKg?: Record<string, number>;
  /** Optional HR-zone distribution from a linked Strava activity. */
  hrZones?: HrZones;
  /** Optional average HR from a linked Strava activity. */
  avgHrBpm?: number;
}

export interface HyroxCardioLogSpec {
  blockIndex: number;
  modality: string;
  durationSec: number;
  rpe: number;
  avgHrBpm?: number;
  hrZones?: HrZones;
}

export interface HyroxSetLogSpec {
  /** Catalog slug to resolve to a movement id at persist time. */
  slug: string;
  setIndex: number;
  reps?: number;
  distanceM?: number;
  weightKg?: number;
  rpe: number;
  setKind: "accessory";
}

export interface HyroxActuals {
  cardioLogs: HyroxCardioLogSpec[];
  setLogs: HyroxSetLogSpec[];
}

/**
 * Per-session conditioning modality → a raw `MODALITY_REGION` key (run / ski / row
 * / bike / other_cardio), so the region-ledger (and the 2-factor load/interference
 * engine that reads it) attributes the aerobic load correctly. This matches how
 * the app stores `cardio_logs.modality` everywhere else (Strava → run/bike/row).
 *
 * Muscle-grid specificity comes from the loaded-station set_logs below (their
 * movement muscle tags), not from this cardio modality — consistent with the
 * app's existing cardio behaviour. Mixed circuits use `other_cardio`. `[DEF]`.
 */
const SESSION_CARDIO_MODALITY: Record<string, string> = {
  "easy-run": "run",
  "long-run": "run",
  "threshold-run": "run",
  "vo2-intervals": "run",
  "easy-ski": "ski",
  "easy-row": "row",
  "easy-bike": "bike",
  "compromised-run": "run",
  "station-intervals": "other_cardio",
  "se-circuit": "other_cardio",
  "sim-half": "run",
  "sim-full": "run",
};

/** Loaded-station engine key → catalog slug for the materialized set_logs. */
const STATION_SLUG: Record<string, string> = {
  "sled-push": "sled-push-heavy",
  "sled-pull": "sled-pull",
  "farmers-carry": "farmer-carry-kb",
  "sandbag-lunge": "sandbag-lunge",
  "wall-ball": "wall-ball",
};

/** A station is "loaded" (gets a confirmable weight) iff it has a division load. */
function isLoadedStation(movementKey: string): boolean {
  return getStation(movementKey)?.open != null;
}

/** The conditioning modality for a session (fallback `other_cardio`). */
export function sessionCardioModality(sessionId: string): string {
  return SESSION_CARDIO_MODALITY[sessionId] ?? "other_cardio";
}

/**
 * Build the actual log rows for a completed structured HYROX session. Strength
 * sessions (per-movement logged) are not handled here and yield no rows.
 */
export function buildHyroxActuals(
  session: HyroxSession,
  input: HyroxCompletionInput,
  /**
   * The stations actually performed this session. For the focused station rotation
   * (ADR 0062) this is the week's focused subset, so we don't log set rows for
   * loaded stations the athlete didn't do. Defaults to the session's full list.
   */
  performedMovements?: readonly string[],
): HyroxActuals {
  if (session.category === "strength") {
    // Strength sessions use the normal per-movement logger, not this path.
    return { cardioLogs: [], setLogs: [] };
  }

  const rpe = input.sessionRpe;
  const cardioLogs: HyroxCardioLogSpec[] = [
    {
      blockIndex: 0,
      modality: sessionCardioModality(session.id),
      durationSec: Math.max(0, Math.round(input.totalDurationSec)),
      rpe,
      ...(input.avgHrBpm != null ? { avgHrBpm: input.avgHrBpm } : {}),
      ...(input.hrZones ? { hrZones: input.hrZones } : {}),
    },
  ];

  const weights = input.confirmedWeightsKg ?? {};
  const setLogs: HyroxSetLogSpec[] = [];
  let setIndex = 0;
  for (const movementKey of performedMovements ?? session.movements) {
    if (!isLoadedStation(movementKey)) continue;
    const slug = STATION_SLUG[movementKey];
    const station = getStation(movementKey);
    if (!slug || !station) continue;
    const weightKg = weights[movementKey];
    setLogs.push({
      slug,
      setIndex: setIndex++,
      ...(station.reps != null ? { reps: station.reps } : {}),
      ...(station.distanceM != null ? { distanceM: station.distanceM } : {}),
      ...(weightKg != null && weightKg > 0 ? { weightKg } : {}),
      rpe,
      setKind: "accessory",
    });
  }

  return { cardioLogs, setLogs };
}

/** Convenience: resolve the session by id then materialize. Returns empty for unknown ids. */
export function buildHyroxActualsById(
  sessionId: string,
  input: HyroxCompletionInput,
  performedMovements?: readonly string[],
): HyroxActuals {
  const session = getHyroxSession(sessionId);
  if (!session) return { cardioLogs: [], setLogs: [] };
  return buildHyroxActuals(session, input, performedMovements);
}

/** The loaded stations in a session that need a confirmable weight (for the form). */
export function loadedStationsForSession(sessionId: string): { key: string; slug: string }[] {
  const session = getHyroxSession(sessionId);
  if (!session || session.category === "strength") return [];
  const out: { key: string; slug: string }[] = [];
  for (const movementKey of session.movements) {
    if (!isLoadedStation(movementKey)) continue;
    const slug = STATION_SLUG[movementKey];
    if (slug) out.push({ key: movementKey, slug });
  }
  return out;
}
