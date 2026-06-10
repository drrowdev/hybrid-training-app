/**
 * @hta/tb-conditioning — types for the Tactical Barbell II conditioning library.
 *
 * A structured, faithful encoding of the named conditioning sessions from
 * Tactical Barbell II (and the TB blog): the HIC sets, General Conditioning (GC)
 * circuits, Power Development, Strength-Endurance circuits, Core/Grip finishers,
 * and the Challenge sessions. These are the concrete workouts that fill Green
 * Protocol's generic Hill/Speed/SE slots.
 *
 * Pure data — no DB, no UI, no deps.
 */

/** Top-level grouping from the TB2 conditioning taxonomy. */
export type TbConditioningCategory =
  | "endurance"
  | "hic"
  | "gc"
  | "power"
  | "core-grip"
  | "challenge";

/** Dominant energy-system / quality the session trains. */
export type TbZone =
  | "aerobic"
  | "threshold"
  | "anaerobic"
  | "mixed"
  | "power"
  | "strength-endurance";

/** How a session is scored / structured. */
export type TbScoring =
  | "rounds" // repeat the work block N times
  | "for-time" // complete the prescribed work as fast as possible
  | "amrap" // as many rounds/reps as possible in a time window
  | "duration" // run/work for a set time
  | "distance" // cover a set distance
  | "ladder"; // ascending/descending rep or distance scheme

/** Equipment a session needs (drives filtering for what the athlete has on hand). */
export type TbEquipment =
  | "bodyweight"
  | "run"
  | "sprint"
  | "hill"
  | "treadmill"
  | "jump-rope"
  | "row"
  | "bike"
  | "kettlebell"
  | "dumbbell"
  | "barbell"
  | "sledgehammer"
  | "weight-vest"
  | "ruck"
  | "pull-up-bar"
  | "box"
  | "med-ball"
  | "farmers"
  | "ab-wheel";

export interface TbNamedSession {
  /** Stable id. */
  id: string;
  /** Display name. */
  name: string;
  /** Alternate name, where the source gives one. */
  aka?: string;
  category: TbConditioningCategory;
  zone: TbZone;
  /** The session's number within the TB2 HIC master list (1–40), where it has one. */
  hicNumber?: number;
  equipment: TbEquipment[];
  /** Loaded carry / weighted work. */
  loaded?: boolean;
  /**
   * Whether the session is a continuous GPS-trackable activity (run/ruck) a
   * Strava import can fulfil automatically. Most metcons/circuits are false —
   * they need manual completion logging.
   */
  trackable?: boolean;
  scoring: TbScoring;
  /** Round / repeat count, where applicable (verbatim, e.g. "6", "3-4", "5-10"). */
  rounds?: string;
  /** AMRAP window in minutes, where applicable. */
  amrapMin?: number;
  /** Ordered work steps (verbatim from the source). */
  steps: string[];
  /** Execution instructions / scaling notes. */
  instructions?: string;
  /** Source attribution. */
  source: string;
}
