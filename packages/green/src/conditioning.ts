/**
 * Green Protocol — the conditioning session vocabulary.
 *
 * Green Protocol layers structured conditioning (running / rucking / hill work)
 * on top of the Tactical Barbell strength templates. This module is the
 * controlled vocabulary of those conditioning sessions: the GP token, the unit a
 * session is prescribed in, and its target intensity zone.
 *
 * NOTE: several sessions' fine-grained *execution* (e.g. exactly how to run
 * Peggy's Hills, the HIC/Metcon formats, the Strength-Endurance template, the
 * 2/1 Run) are defined in Tactical Barbell II, not in Green Protocol. Those carry
 * a placeholder `note` until the user supplies the descriptions; the GP schedule,
 * session type, and duration/distance target are fully captured regardless.
 */

/** Where a conditioning session sits on the easy→hard intensity spectrum. */
export type IntensityZone =
  | "recovery"
  | "aerobic"
  | "threshold"
  | "anaerobic"
  | "mixed";

/** The unit a session's volume target is expressed in. */
export type ConditioningUnit = "minutes" | "miles" | "rounds";

export interface ConditioningSession {
  /** Stable id used by phase grids and prescriptions. */
  id: string;
  /** The token Green Protocol uses in its tables (e.g. "LSS", "LR", "Hill"). */
  token: string;
  /** Human-facing name. */
  name: string;
  /** Default unit the session is programmed in. */
  unit: ConditioningUnit;
  /** Target intensity zone (drives HR-zone checks on logged cardio). */
  zone: IntensityZone;
  /** Loaded carry (ruck / weight-vest) flag. */
  loaded?: boolean;
  /** Execution note — placeholder where the detail lives in TB2 / is user-supplied. */
  note: string;
}

const PENDING = "Session execution detail pending (Tactical Barbell II / user-supplied).";

export const CONDITIONING_SESSIONS: ConditioningSession[] = [
  { id: "lss", token: "LSS", name: "Low Intensity Steady State Run", unit: "minutes", zone: "aerobic", note: "Easy aerobic run on flat terrain; doubles as active recovery. Stay in the lower aerobic range." },
  { id: "long-run", token: "LR", name: "Long Run", unit: "miles", zone: "aerobic", note: "Off-road / elevation run that extends overall endurance. May be programmed by distance or time." },
  { id: "back-to-back-lr", token: "LR/LR", name: "Back-to-Back Long Runs", unit: "miles", zone: "aerobic", note: "Consecutive-day long runs for a large base-endurance / work-capacity stimulus." },
  { id: "tempo", token: "Tempo", name: "Tempo Run", unit: "miles", zone: "threshold", note: "Sustained threshold effort. Add ~1 mi warm-up and ~1 mi cool-down. Fartlek may be substituted." },
  { id: "fartlek", token: "FK", name: "Fartlek", unit: "minutes", zone: "mixed", note: "Unstructured surges of speed within a continuous run. Program by time or distance." },
  { id: "speed", token: "Speed", name: "Speed Session", unit: "rounds", zone: "anaerobic", note: "Any speed session — mile/400 m/800 m repeats, tempo, or a HIC/Metcon. " + PENDING },
  { id: "intervals-400", token: "400", name: "400 m Repeats", unit: "rounds", zone: "anaerobic", note: PENDING },
  { id: "intervals-800", token: "800", name: "800 m Repeats", unit: "rounds", zone: "anaerobic", note: "800 m repeats (mile repeats may be substituted). " + PENDING },
  { id: "mile-repeats", token: "MR", name: "Mile Repeats", unit: "miles", zone: "threshold", note: PENDING },
  { id: "two-one-run", token: "2/1R", name: "2/1 Run", unit: "minutes", zone: "mixed", note: PENDING },
  { id: "hill", token: "Hill", name: "Continuous Hill Run", unit: "minutes", zone: "mixed", note: "Elevation training — specific strength + work capacity. 30–120 min." },
  { id: "vert-ladder", token: "Hill", name: "Vert Ladder", unit: "minutes", zone: "mixed", note: PENDING },
  { id: "peggy", token: "Peggy", name: "Peggy's Hills", unit: "minutes", zone: "mixed", note: "Hill-based strength-endurance / work-capacity session. " + PENDING },
  { id: "se", token: "SE", name: "Strength-Endurance Training", unit: "rounds", zone: "mixed", note: "High-rep, sub-maximal-load circuit; 2-day template. Improves muscular and cardiovascular endurance. " + PENDING },
  { id: "ruck", token: "Ruck", name: "Ruck", unit: "miles", zone: "aerobic", loaded: true, note: "Loaded march. Program by distance or time." },
  { id: "speed-ruck", token: "S/Ruck", name: "Speed Ruck", unit: "miles", zone: "threshold", loaded: true, note: "Higher-tempo loaded march. " + PENDING },
  { id: "weight-vest-run", token: "WVR", name: "Weight Vest Run", unit: "miles", zone: "aerobic", loaded: true, note: PENDING },
];

const BY_ID = new Map(CONDITIONING_SESSIONS.map((s) => [s.id, s]));

export function getConditioningSession(id: string): ConditioningSession | undefined {
  return BY_ID.get(id);
}
