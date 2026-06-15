/**
 * HYROX — the session vocabulary (ADR 0050).
 *
 * Mirrors `packages/green/src/conditioning.ts` in spirit: a controlled catalog of
 * the session templates the HYROX phase grid schedules. Each entry carries its
 * category, target intensity zone, the unit its volume target is expressed in, the
 * movement keys it materializes into (for completion-time load attribution —
 * ADR 0050 logging model), and an execution note.
 *
 * Calibration: these are CONTENT definitions (what a session IS), not physiological
 * coefficients. The race-derived content (stations, distances) is published HYROX
 * FACT; the training-session templates (compromised running, SE circuits, the 80/20
 * easy:hard mix) are `[DEF]` coach-consensus programming — see ADR 0050 §Calibration.
 * No new engine constant is introduced here.
 */

/** Where a session sits on the easy→hard intensity spectrum (drives HR-zone checks). */
export type HyroxZone = "recovery" | "aerobic" | "threshold" | "anaerobic" | "mixed";

/** The unit a session's volume target is expressed in. */
export type HyroxUnit = "minutes" | "meters" | "rounds";

/** What kind of session this is — drives modality tags, logging mode, and display. */
export type HyroxCategory =
  | "run" // continuous running (Z2 / long / threshold)
  | "erg" // off-feet steady-state (ski / row / bike)
  | "intervals" // VO2 / station interval work
  | "compromised" // run → station → run under fatigue (the signature session)
  | "circuit" // strength-endurance station circuit
  | "strength" // HYROX-owned station-specific compound strength
  | "sim"; // partial / full race simulation (benchmark-like)

export interface HyroxSession {
  /** Stable id used by the phase grid and prescriptions. */
  id: string;
  /** Human-facing name. */
  name: string;
  category: HyroxCategory;
  zone: HyroxZone;
  /** Default unit the session is programmed in. */
  unit: HyroxUnit;
  /**
   * Movement keys this session materializes into at completion (ADR 0050). For
   * runs/ergs this is the single ergo/locomotion key; for circuits/strength it is
   * the station/lift list. Resolved against the movement catalog in build steps 5–6.
   */
  movements: string[];
  /**
   * Strength sessions log PER-MOVEMENT (existing strength logger); every other
   * HYROX session logs at the SESSION level (time + RPE + confirm weights).
   */
  perMovementLog: boolean;
  /**
   * Continuous GPS/erg-trackable activity a watch/Strava import can fulfil whole.
   * Interval/circuit/strength sessions need manual session-level completion.
   */
  trackable: boolean;
  /** Execution note. */
  note: string;
}

export const HYROX_SESSIONS: HyroxSession[] = [
  // ── Aerobic base — running ────────────────────────────────────────────────
  {
    id: "easy-run",
    name: "Easy Run (Z2)",
    category: "run",
    zone: "aerobic",
    unit: "minutes",
    movements: ["run"],
    perMovementLog: false,
    trackable: true,
    note: "Easy conversational Zone-2 run (RPE 4-5). The 80% of the 80/20 split — build the aerobic engine that carries ~half the race. Keep it genuinely easy.",
  },
  {
    id: "long-run",
    name: "Long Run (Z2)",
    category: "run",
    zone: "aerobic",
    unit: "minutes",
    movements: ["run"],
    perMovementLog: false,
    trackable: true,
    note: "The week's longest aerobic run at easy Zone-2 pace — longer, not harder. Develops durability and fat-oxidation for the back half of the race.",
  },
  {
    id: "threshold-run",
    name: "Threshold Run",
    category: "run",
    zone: "threshold",
    unit: "minutes",
    movements: ["run"],
    perMovementLog: false,
    trackable: true,
    note: "Comfortably-hard sustained run at ~half-marathon effort (RPE 7-8) — the HYROX race-pace zone. Bracket with an easy warm-up and cool-down.",
  },
  {
    id: "vo2-intervals",
    name: "VO2 Intervals",
    category: "intervals",
    zone: "anaerobic",
    unit: "rounds",
    movements: ["run"],
    perMovementLog: false,
    trackable: true,
    note: "Hard 400 m–1 km running reps with jog/walk recovery (the 20% hard end). Lifts top-end aerobic power and running economy.",
  },

  // ── Aerobic base — off-feet ergs (run substitute for injury-prone athletes) ─
  {
    id: "easy-ski",
    name: "Easy SkiErg (Z2)",
    category: "erg",
    zone: "aerobic",
    unit: "minutes",
    movements: ["skierg"],
    perMovementLog: false,
    trackable: true,
    note: "Steady Zone-2 SkiErg — aerobic volume that doubles as station-1 (1000 m SkiErg) technique. An off-feet option to spare the legs.",
  },
  {
    id: "easy-row",
    name: "Easy Row (Z2)",
    category: "erg",
    zone: "aerobic",
    unit: "minutes",
    movements: ["rowing-erg"],
    perMovementLog: false,
    trackable: true,
    note: "Steady Zone-2 rowing — aerobic volume that doubles as station-5 (1000 m row) technique. Off-feet, posterior-chain friendly.",
  },
  {
    id: "easy-bike",
    name: "Easy Bike (Z2)",
    category: "erg",
    zone: "aerobic",
    unit: "minutes",
    movements: ["bike-erg"],
    perMovementLog: false,
    trackable: true,
    note: "Low-impact Zone-2 cycling — an off-feet aerobic option for high-running-volume weeks or when managing impact.",
  },

  // ── Signature HYROX sessions ──────────────────────────────────────────────
  {
    id: "compromised-run",
    name: "Compromised Running",
    category: "compromised",
    zone: "mixed",
    unit: "rounds",
    movements: ["run", "sled-push", "wall-ball", "sandbag-lunge"],
    perMovementLog: false,
    trackable: false,
    note: "The signature HYROX session: run → station → run under accumulating fatigue. Trains the race-specific skill of running hard on legs pre-fatigued by the stations.",
  },
  {
    id: "se-circuit",
    name: "Strength-Endurance Circuit",
    category: "circuit",
    zone: "mixed",
    unit: "rounds",
    movements: ["wall-ball", "sandbag-lunge", "burpee-broad-jump", "farmers-carry"],
    perMovementLog: false,
    trackable: false,
    note: "Station combos for muscular endurance — isolation → compound → compromised across the block. High-rep, race-station movement patterns at sustainable load.",
  },
  {
    id: "station-intervals",
    name: "Station Intervals",
    category: "intervals",
    zone: "mixed",
    unit: "rounds",
    movements: ["sled-push", "sled-pull", "wall-ball", "sandbag-lunge", "skierg", "rowing-erg"],
    perMovementLog: false,
    trackable: false,
    note: "Technique + interval work on the functional stations (sled / wall ball / lunge / ski / row). Hone efficiency and pacing on the highest-cost stations.",
  },

  // ── Simulations (benchmark-like field tests) ──────────────────────────────
  {
    id: "sim-half",
    name: "Half Simulation (4+4)",
    category: "sim",
    zone: "mixed",
    unit: "rounds",
    movements: ["run", "skierg", "sled-push", "sled-pull", "burpee-broad-jump"],
    perMovementLog: false,
    trackable: true,
    note: "Half-race rehearsal — 4 runs alternating with the first 4 stations at race effort. Tests pacing, transitions, and fuelling without a full-race recovery cost.",
  },
  {
    id: "sim-full",
    name: "Full Simulation (8+8)",
    category: "sim",
    zone: "mixed",
    unit: "rounds",
    movements: [
      "run",
      "skierg",
      "sled-push",
      "sled-pull",
      "burpee-broad-jump",
      "rowing-erg",
      "farmers-carry",
      "sandbag-lunge",
      "wall-ball",
    ],
    perMovementLog: false,
    trackable: true,
    note: "The full race, rehearsed: 8 runs + all 8 stations in order. A potent, costly stimulus — use rarely (deep in race-prep), never close to the event.",
  },

  // ── HYROX-owned strength (station-specific; logged per-movement) ──────────
  {
    id: "strength-full",
    name: "Strength — Full Body",
    category: "strength",
    zone: "anaerobic",
    unit: "rounds",
    movements: ["back-squat", "deadlift", "overhead-press", "bent-row"],
    perMovementLog: true,
    trackable: false,
    note: "Station-specific compound strength, full-body — low reps (3-6), higher load. Squat/deadlift drive the sleds; press feeds the wall balls; row feeds the sled pull.",
  },
  {
    id: "strength-lower",
    name: "Strength — Lower / Posterior",
    category: "strength",
    zone: "anaerobic",
    unit: "rounds",
    movements: ["split-squat", "romanian-deadlift", "reverse-lunge", "front-rack-carry"],
    perMovementLog: true,
    trackable: false,
    note: "Single-leg drive (sled push) + posterior chain (sled pull, farmers carry) emphasis. Split squats, RDLs, reverse lunges, loaded carries — 3-6 reps, heavy.",
  },
  {
    id: "strength-upper",
    name: "Strength — Upper / Pull",
    category: "strength",
    zone: "anaerobic",
    unit: "rounds",
    movements: ["push-press", "pull-up", "bent-row", "farmers-carry"],
    perMovementLog: true,
    trackable: false,
    note: "Press (wall balls) + pull (sled pull, row) emphasis. Push press, pull-ups, rows, grip-intensive carries — 3-6 reps, heavy.",
  },
];

const BY_ID = new Map(HYROX_SESSIONS.map((s) => [s.id, s]));

export function getHyroxSession(id: string): HyroxSession | undefined {
  return BY_ID.get(id);
}

/** Modality tag for a session category (for stats/interference attribution). */
export function modalityOf(category: HyroxCategory): "strength" | "cardio" | "mixed" {
  if (category === "strength") return "strength";
  if (category === "run" || category === "erg") return "cardio";
  return "mixed";
}
