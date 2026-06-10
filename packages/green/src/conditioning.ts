/**
 * Green Protocol — the conditioning session vocabulary.
 *
 * Green Protocol layers structured conditioning (running / rucking / hill work)
 * on top of the Tactical Barbell strength templates. This module is the
 * controlled vocabulary of those conditioning sessions: the GP token, the unit a
 * session is prescribed in, its target intensity zone, and an execution note.
 *
 * Every definition below is sourced from Green Protocol's own Session Guide
 * (Section II) — GP defines all of its conditioning sessions natively. A few
 * generic slots (e.g. "Speed") are categories GP fills with a specific session;
 * those are marked as aliases. The richer named-metcon library (Apex, Bloody
 * Lungs, the GC/HIC sets, SE circuits) lives in Tactical Barbell II and can be
 * slotted into the generic Hill/Speed/SE slots — that library is modelled
 * separately, not here.
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
  /**
   * Whether the session is a continuous GPS-trackable activity (run/ruck) that a
   * Strava import can fulfil automatically, vs. an interval/circuit that needs
   * manual completion logging.
   */
  trackable?: boolean;
  /** Example prescription format string GP uses (e.g. "400/10", "Tempo 3"). */
  format?: string;
  /** Execution note, sourced from Green Protocol's Session Guide. */
  note: string;
}

export const CONDITIONING_SESSIONS: ConditioningSession[] = [
  {
    id: "lss",
    token: "LSS",
    name: "Low Intensity Steady State Run",
    unit: "minutes",
    zone: "aerobic",
    trackable: true,
    format: "LSS 30-60",
    note: "Easy, low-intensity Zone-2 jog (RPE 4-5). Work long, not hard. Builds aerobic base and doubles as active recovery; back off if you feel you're pushing. Programmable in minutes or miles.",
  },
  {
    id: "long-run",
    token: "LR",
    name: "Long Run",
    unit: "miles",
    zone: "aerobic",
    trackable: true,
    format: "LR 8",
    note: "The week's longest run, at LSS pace (RPE 4-5) but longer, off-road/on trail with elevation. Jog what you can, power-hike steep sections. Miles in Foundation; distance or time in Continuation.",
  },
  {
    id: "back-to-back-lr",
    token: "LR/LR",
    name: "Back-to-Back Long Runs",
    unit: "miles",
    zone: "aerobic",
    trackable: true,
    note: "Two Long Runs on consecutive days for a large endurance / work-capacity stimulus. Extremely potent — use sparingly, never at the expense of consistent shorter runs.",
  },
  {
    id: "tempo",
    token: "Tempo",
    name: "Tempo Run",
    unit: "miles",
    zone: "threshold",
    trackable: true,
    format: "Tempo 3",
    note: "Comfortably-hard sustained run (RPE 7-8, ~85-90% max HR) bracketed by a 1-mile warm-up and 1-mile cool-down jog. 'Tempo 3' = 1 + 3 + 1 = 5 miles total. Fartlek may be substituted.",
  },
  {
    id: "fartlek",
    token: "FK",
    name: "Fartlek",
    unit: "minutes",
    zone: "mixed",
    trackable: true,
    note: "A Long Run with speedwork mixed in, best off-road. After a 10-15min jog, alternate 3-5min easy LSS with 10-60s surges (near-max on the short ones) for the rest of the run. Program by time or distance.",
  },
  {
    id: "speed",
    token: "Speed",
    name: "Speed Session",
    unit: "rounds",
    zone: "anaerobic",
    trackable: true,
    note: "A category slot, not a single session — GP fills it with any speed session (Mile/400m/800m repeats, Tempo, 2/1 Run), or a HIC/Metcon from Tactical Barbell II.",
  },
  {
    id: "intervals-400",
    token: "400",
    name: "400 m Repeats",
    unit: "rounds",
    zone: "anaerobic",
    trackable: true,
    format: "400/10",
    note: "Prescribed in rounds ('400/10' = 10 rounds). Run 400 m at your fastest sustainable pace, then jog/walk 400 m to recover; repeat. Fast but paced — distinct from TB2's max-effort 600 m Resets.",
  },
  {
    id: "intervals-800",
    token: "800",
    name: "800 m Repeats",
    unit: "rounds",
    zone: "anaerobic",
    trackable: true,
    format: "800/2-4",
    note: "Prescribed in rounds ('800/2-4' = 2-4 rounds). Run 800 m at fastest sustainable pace, then walk 3-5 min or jog 800 m to recover; repeat. Go fast, but pace yourself.",
  },
  {
    id: "mile-repeats",
    token: "MR",
    name: "Mile Repeats",
    unit: "rounds",
    zone: "threshold",
    trackable: true,
    format: "MR 3",
    note: "10-15 min warm-up jog, then run 1 mile at max sustainable effort and rest (jog/walk) for ~half the mile time; repeat for the prescribed rounds. Great for PFT pace work (e.g. 1.5/2-mile targets).",
  },
  {
    id: "two-one-run",
    token: "2/1R",
    name: "2/1 Run",
    unit: "minutes",
    zone: "anaerobic",
    trackable: true,
    format: "2/1R 30",
    note: "Short high-intensity interval run: jog 2 min, run fast 1 min, repeat. Recovery is deliberately brief so you're never fully rested. Keep to 20-30 min total; great post-lift or treadmill finisher.",
  },
  {
    id: "hill",
    token: "Hill",
    name: "Continuous Hill Run",
    unit: "minutes",
    zone: "mixed",
    trackable: true,
    format: "CHR 30-120",
    note: "Jog continuously uphill at a relaxed sustainable pace, walk/jog down (descent doesn't count toward time); repeat for 30-120 min of ascent time. No HR cap. Power-hike steep bits — uphill movement is the point.",
  },
  {
    id: "vert-ladder",
    token: "Hill",
    name: "Vert Ladder",
    unit: "minutes",
    zone: "mixed",
    trackable: true,
    note: "Uphill ladder: run uphill 1, 2, 3, 4, 5 min (downhill recovery jog between), then work back down the ladder. Go faster on the short ascents, slower on the long ones. Adjust the top rung as needed.",
  },
  {
    id: "peggy",
    token: "Peggy",
    name: "Peggy's Hills",
    unit: "minutes",
    zone: "mixed",
    loaded: true,
    note: "Work-capacity/SE session on a 30-100 m hill. Wear a 5-20 lb vest, pick 1-3 exercises; jog up and down continuously and do 10-20 reps of one (rotating) exercise each time you reach the top, for 30-120 min. NOT a sprint session — continuous low-gear jog. Can replace any Hill or Ruck session.",
  },
  {
    id: "se",
    token: "SE",
    name: "Strength-Endurance Training",
    unit: "rounds",
    zone: "mixed",
    note: "High-rep, low-load circuit (TB2): pick a cluster of 5-8 exercises covering all major body parts, ~15-30% 1RM (or bodyweight/vest), short or no rest, ~2 min between rounds. E.g. 3 × 30 reps. Builds muscular and cardiovascular endurance.",
  },
  {
    id: "ruck",
    token: "Ruck",
    name: "Ruck",
    unit: "miles",
    zone: "aerobic",
    loaded: true,
    trackable: true,
    note: "Conventional ruck — complete the assigned distance/load; speed is secondary but can be tested in portions. Primarily builds load-carriage skill, distance, and load tolerance.",
  },
  {
    id: "speed-ruck",
    token: "S/Ruck",
    name: "Speed Ruck",
    unit: "miles",
    zone: "threshold",
    loaded: true,
    trackable: true,
    note: "Short 2-6 mile pace-focused ruck. Benchmarks: Basic 15 min/mi @ 35 lb → Intermediate 13-14 min/mi @ 50-60 lb → Advanced 11-12 min/mi @ 50-70 lb.",
  },
  {
    id: "weight-vest-run",
    token: "WVR",
    name: "Weight Vest Run",
    unit: "miles",
    zone: "aerobic",
    loaded: true,
    trackable: true,
    note: "Substitute for rucking (e.g. police SpecOps with no ruck requirement). Slow trail jog broken up by walking the inclines. Start ~5-10 lb and ~30 min; build gradually. Avoid pavement — stay on trail/dirt.",
  },
];

const BY_ID = new Map(CONDITIONING_SESSIONS.map((s) => [s.id, s]));

export function getConditioningSession(id: string): ConditioningSession | undefined {
  return BY_ID.get(id);
}
