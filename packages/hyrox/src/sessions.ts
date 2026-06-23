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

/** Platform assistance categories HYROX strength accessories resolve through (ADR 0047 / 0057). */
export type HyroxAssistSlot = "push" | "pull" | "single_leg" | "core" | "carry";

/**
 * A strength accessory with its own demand-matched prescription (ADR 0058). The
 * `slot` resolves to a concrete catalog movement via the shared ADR-0047 planner;
 * the reps/sets are set per the RACE demand the accessory trains (e.g. single-leg
 * runs strength-endurance reps for the lunge station; a heavy pull builds the
 * sled-pull strength reserve). Carries omit `reps` (prescribed by distance/time).
 */
export interface HyroxAccessory {
  slot: HyroxAssistSlot;
  /** Base working sets (the taper trims one, min 2). Default 3. */
  sets?: number;
  /** Rep target (range minimum). Omit for distance/time carries. */
  reps?: number;
  /** Upper bound of the rep range. */
  repsMax?: number;
  /** True when reps are PER LEG (single-leg work). */
  perLeg?: boolean;
  /** Coaching note (the demand it trains + how to load it). */
  note: string;
  /** Display label override (e.g. "Pull — heavy"); defaults to the slot label. */
  label?: string;
}

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
   * Movement keys this session involves.
   *   - Cardio/erg/station sessions: the catalog/locomotion keys, materialized at
   *     completion (ADR 0050 step 7) and shown for display.
   *   - Strength sessions: the ROLE-anchored main-lift engine keys (squat / deadlift
   *     / press / bench) the platform resolves to the user's chosen variant and
   *     loads off their 1RM (like Tactical Barbell / 5/3/1).
   */
  movements: string[];
  /**
   * Strength only: station-specific accessory slots, emitted as category-tagged
   * assistance INTENT (no concrete movement). The platform resolves each to a
   * catalog movement (equipment / limitation / rotation filtered) via the shared
   * ADR-0047 assistance resolver — the same machinery 5/3/1 uses.
   */
  assist?: HyroxAssistSlot[];
  /**
   * Strength only (ADR 0058): per-accessory prescriptions, replacing the flat
   * `assist` list for the split strength days. Each carries demand-matched
   * reps/sets. When present, this supersedes `assist`.
   */
  accessories?: HyroxAccessory[];
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
    note: "Comfortably-hard sustained run at ~half-marathon effort (RPE 7-8) — race-pace intensity. Bracket with an easy warm-up and cool-down.",
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

  // ── HYROX-owned strength (ADR 0058 — two-main split) ─────────────────────────
  // Mains use the platform StrengthRole keys (squat / deadlift / press) loaded off
  // the user's 1RM. The race never demands max force — every station is sub-maximal
  // force at high rep/duration under fatigue — so the mains build the STRENGTH
  // RESERVE at 4–6 reps (the phase scheme), and the accessories train the actual
  // race qualities at demand-matched reps (single-leg endurance for the lunge
  // station, carries by distance for the farmers carry, etc.). Two heavy efforts
  // per day (not three) protects CNS + movement quality. The compound PULL — the
  // sled-pull driver — is promoted to a primary lift on Day B (no horizontal press
  // in the race, so bench is omitted; presses are overhead = wall balls).
  {
    id: "strength-a",
    name: "Strength A — Squat + Press",
    category: "strength",
    zone: "anaerobic",
    unit: "rounds",
    movements: ["squat", "press"],
    accessories: [
      {
        slot: "pull",
        reps: 6,
        repsMax: 10,
        label: "Pull — secondary",
        note: "Moderate-heavy compound pull (row / pull-up), RPE 7–8 (~2 in reserve). Posture + the sled pull; second pull stimulus of the week.",
      },
      {
        slot: "single_leg",
        reps: 12,
        repsMax: 15,
        perLeg: true,
        note: "Per leg — strength-endurance for the 100 m lunge station, sled drive and running. Moderate load, controlled, RPE 7–8.",
      },
      {
        slot: "core",
        reps: 12,
        repsMax: 20,
        note: "Anti-rotation / anti-extension endurance — brace for the sandbag, carries and the full 60–90 min.",
      },
    ],
    perMovementLog: true,
    trackable: false,
    note: "Day-A strength: heavy Squat + Overhead Press (4–6 reps, strength reserve), then a moderate pull, single-leg endurance and trunk. Two heavy efforts only — quality over quantity.",
  },
  {
    id: "strength-b",
    name: "Strength B — Deadlift + Pull",
    category: "strength",
    zone: "anaerobic",
    unit: "rounds",
    movements: ["deadlift"],
    accessories: [
      {
        slot: "pull",
        sets: 4,
        reps: 4,
        repsMax: 6,
        label: "Pull — primary (heavy)",
        note: "Heavy compound pull (weighted pull-up / heavy row), RPE 8. The sled-pull strength reserve — the race's missing primary pattern.",
      },
      {
        slot: "push",
        reps: 8,
        repsMax: 15,
        label: "Press — power-endurance",
        note: "Explosive push-press / thruster — light, fast, repeatable. Power-endurance for the 100 wall balls (a heavy strict press doesn't transfer there).",
      },
      {
        slot: "single_leg",
        reps: 12,
        repsMax: 15,
        perLeg: true,
        note: "Per leg — quad strength-endurance on the non-squat day. Moderate load, controlled.",
      },
      {
        slot: "carry",
        note: "Heavy carry ~40–60 m (or ~40–60 s) per set. Tall posture, crush the grip — the farmers-carry station.",
      },
    ],
    perMovementLog: true,
    trackable: false,
    note: "Day-B strength: heavy Deadlift + a heavy compound Pull (the sled-pull driver, 4–6 reps), then a power-endurance press for the wall balls, single-leg endurance and a loaded carry.",
  },
  {
    id: "strength-full",
    name: "Strength — Full Body",
    category: "strength",
    zone: "anaerobic",
    unit: "rounds",
    movements: ["squat", "deadlift", "press"],
    accessories: [
      {
        slot: "pull",
        reps: 6,
        repsMax: 10,
        note: "Compound pull (row / pull-up), RPE 7–8 — posture + the sled pull.",
      },
      {
        slot: "single_leg",
        reps: 12,
        repsMax: 15,
        perLeg: true,
        note: "Per leg — strength-endurance for the lunge station, sled drive and running.",
      },
      {
        slot: "carry",
        note: "Heavy carry ~40–60 m / set — grip + trunk for the farmers carry.",
      },
    ],
    perMovementLog: true,
    trackable: false,
    note: "Single strength day (low weekly frequency): full-body — Squat, Deadlift, Overhead Press (4–6 reps), plus a compound pull, single-leg endurance and a loaded carry to cover every pattern once.",
  },
  {
    id: "strength-lower",
    name: "Strength — Lower / Posterior",
    category: "strength",
    zone: "anaerobic",
    unit: "rounds",
    movements: ["squat", "deadlift"],
    assist: ["single_leg", "carry"],
    perMovementLog: true,
    trackable: false,
    note: "Single-leg drive (sled push) + posterior chain (sled pull, farmers carry) emphasis. Heavy squat + deadlift, 3-6 reps, plus a single-leg/core accessory (split squats, lunges, loaded carries).",
  },
  {
    id: "strength-upper",
    name: "Strength — Upper / Pull",
    category: "strength",
    zone: "anaerobic",
    unit: "rounds",
    movements: ["press"],
    assist: ["pull", "push"],
    perMovementLog: true,
    trackable: false,
    note: "Press (wall balls) + pull (sled pull, row) emphasis. Heavy overhead press, 3-6 reps, plus pull (rows, pull-ups, carries) and push accessories.",
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
