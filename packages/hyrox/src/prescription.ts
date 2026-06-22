/**
 * HYROX — prescription rendering (ADR 0050 step 5).
 *
 * Renders each planned grid cell into a `SessionPrescription`. Strength sessions
 * produce per-movement loaded items (warm-up ramp + working sets off the shared
 * 1RM, exactly like Tactical Barbell / 5/3/1); every other HYROX session produces
 * structured display items logged at the SESSION level (runs/ergs as cardio with a
 * duration target; stations/circuits/compromised/sims as conditioning items with a
 * division-standard load reference to confirm at completion).
 *
 * Calibration: NO new physiological coefficient. The strength loading scheme and
 * the aerobic duration / interval-volume defaults below are `[DEF]` programming
 * content (coach consensus — the same status as a 5/3/1 wave % or a TB sets×reps
 * table), conservative and gated by the user's chosen sessions/week + level. The
 * station loads are published HYROX FACT (divisions.ts). All adaptive load math
 * (sRPE, interference, freshness, taper) is the existing CP-2 engine, applied to
 * the materialized ACTUALS post-completion — never here. See ADR 0050 §Calibration.
 */
import type { PlatformContext, PrescribedItem, SessionPrescription } from "@hta/program-core";
import { buildGlobalWarmupItems } from "@hta/program-core";
import { getHyroxSession, type HyroxSession } from "./sessions";
import { HYROX_STATIONS, getStation, stationLoadLabel, wallBallTargetLabel } from "./divisions";
import type { HyroxExperience, HyroxDivision } from "./types";
import type { HyroxPhaseId } from "./phases";

// ─────────────────────────────────────────────────────────────────────────────
// `[DEF]` programming content — coach-consensus, user-gated, NOT calibration.
// ─────────────────────────────────────────────────────────────────────────────

/** Strength loading per phase. Parallels a TB sets×reps table / a 5/3/1 wave. `[DEF]`. */
interface StrengthScheme {
  sets: number;
  reps: number;
  /** Fraction of 1RM for the working sets. */
  pct: number;
}
const STRENGTH_SCHEME: Record<HyroxPhaseId, StrengthScheme> = {
  base: { sets: 4, reps: 5, pct: 0.75 }, // accumulate, groove patterns
  build: { sets: 4, reps: 4, pct: 0.83 }, // intensify
  specific: { sets: 3, reps: 3, pct: 0.8 }, // maintain strength, shed volume
  taper: { sets: 2, reps: 3, pct: 0.68 }, // stay sharp, minimal fatigue
};

/** Easy-run minutes by level (the Z2 anchor; other aerobic durations derive from it). `[DEF]`. */
const EASY_RUN_MIN: Record<HyroxExperience, number> = {
  beginner: 30,
  intermediate: 40,
  advanced: 50,
};

/** Phase multiplier on aerobic duration (build peaks volume; taper sheds it). `[DEF]`. */
const AEROBIC_PHASE_MULT: Record<HyroxPhaseId, number> = {
  base: 1.0,
  build: 1.15,
  specific: 0.9,
  taper: 0.55,
};

/** Threshold-run total minutes (incl. warm-up/cool-down) by level. `[DEF]`. */
const THRESHOLD_MIN: Record<HyroxExperience, number> = {
  beginner: 24,
  intermediate: 30,
  advanced: 36,
};

/** Interval / circuit / compromised ROUNDS by level. `[DEF]`. */
const ROUNDS_BY_LEVEL: Record<HyroxExperience, number> = {
  beginner: 3,
  intermediate: 4,
  advanced: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function roundTo(value: number, increment: number): number {
  if (increment <= 0) return value;
  return Math.round(value / increment) * increment;
}

function movementLabel(key: string): string {
  return key
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function minutes(min: number): number {
  return Math.round(min) * 60;
}

/** Conditionally include `movementId` (exactOptionalPropertyTypes-safe). */
function mid(movement: string | undefined): { movementId?: string } {
  return movement != null ? { movementId: movement } : {};
}

export interface PrescribeArgs {
  experience: HyroxExperience;
  division: HyroxDivision;
  phase: HyroxPhaseId;
  isDeload: boolean;
  /** Competition weight category — selects the gender-correct station loads. */
  gender?: "male" | "female";
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-category builders
// ─────────────────────────────────────────────────────────────────────────────

/** A run/erg session → one cardio item with a duration target + zone guidance. */
function buildAerobic(sess: HyroxSession, args: PrescribeArgs): PrescribedItem[] {
  const baseMin = EASY_RUN_MIN[args.experience] * AEROBIC_PHASE_MULT[args.phase];
  let durMin = baseMin;
  if (sess.id === "long-run") durMin = baseMin * 1.6;
  if (sess.id === "threshold-run") {
    durMin = THRESHOLD_MIN[args.experience] * (args.phase === "taper" ? 0.7 : 1);
  }
  if (args.isDeload) durMin = Math.min(durMin, 30);

  const zoneNote =
    sess.zone === "threshold"
      ? "Hold ~half-marathon effort (RPE 7-8) through the middle; easy warm-up + cool-down."
      : "Keep it easy and conversational (Zone 2, RPE 4-5).";

  return [
    {
      kind: "cardio",
      name: sess.name,
      ...mid(sess.movements[0]),
      durationSec: minutes(durMin),
      note: `Target ~${Math.round(durMin)} min. ${zoneNote} ${sess.note}`,
    },
  ];
}

/** VO2 / station intervals → a conditioning item expressed in rounds. */
function buildIntervals(sess: HyroxSession, args: PrescribeArgs): PrescribedItem[] {
  const rounds = ROUNDS_BY_LEVEL[args.experience] + (args.phase === "specific" ? 1 : 0);
  const detail =
    sess.id === "vo2-intervals"
      ? `${rounds} × 800 m hard (RPE 8-9) with equal-time jog/walk recovery. Top-end aerobic power.`
      : `${rounds} rounds of station technique + intervals (sled / ski / row / wall ball / lunge) — sharpen efficiency and pacing.`;
  return [
    {
      kind: "conditioning",
      name: sess.name,
      ...mid(sess.movements[0]),
      sets: rounds,
      repsLabel: `${rounds} rounds`,
      note: `${detail} ${sess.note}`,
    },
  ];
}

/** Compromised running → run → station → run rounds under fatigue. */
function buildCompromised(sess: HyroxSession, args: PrescribeArgs): PrescribedItem[] {
  const rounds = ROUNDS_BY_LEVEL[args.experience];
  return [
    {
      kind: "conditioning",
      name: sess.name,
      ...mid(sess.movements[0]),
      sets: rounds,
      repsLabel: `${rounds} rounds`,
      note: `${rounds} × (1 km run → a race station → 1 km run) at race effort, minimal rest. ${sess.note}`,
    },
  ];
}

/** Strength-endurance circuit → station combos at sustainable load. */
function buildCircuit(sess: HyroxSession, args: PrescribeArgs): PrescribedItem[] {
  const rounds = ROUNDS_BY_LEVEL[args.experience];
  const stations = sess.movements
    .map((m) => getStation(m)?.name ?? movementLabel(m))
    .join(", ");
  return [
    {
      kind: "conditioning",
      name: sess.name,
      ...mid(sess.movements[0]),
      sets: rounds,
      repsLabel: `${rounds} rounds`,
      note: `${rounds} rounds: ${stations}. High-rep, sustainable load — build muscular endurance in the race patterns. ${sess.note}`,
    },
  ];
}

/** A race simulation → the stations in order at race effort (a benchmark test). */
function buildSimulation(sess: HyroxSession, args: PrescribeArgs): PrescribedItem[] {
  const half = sess.id === "sim-half";
  const stations = HYROX_STATIONS.slice(0, half ? 4 : 8);
  const intro = half
    ? "Half simulation — 4 runs (1 km each) alternating with the first 4 stations, at race effort. Rehearse pacing, transitions and fuelling."
    : "Full simulation — all 8 runs + 8 stations in race order, at race effort. A costly stimulus; use rarely and not close to the event.";
  const items: PrescribedItem[] = [];
  stations.forEach((st, idx) => {
    const loadRef = stationLoadLabel(st, args.division, args.gender);
    const height = st.movement === "wall-ball" ? wallBallTargetLabel(args.gender) : "";
    // Fold the simulation intro into the FIRST station's note (a standalone
    // leading note would be dropped by the adapter, losing the guidance).
    const note = [idx === 0 ? intro : "", st.note, height, loadRef].filter(Boolean).join(" ");
    items.push({
      kind: "conditioning",
      name: st.name,
      movementId: st.movement,
      ...(st.distanceM != null ? { distanceM: st.distanceM } : {}),
      ...(st.reps != null ? { reps: st.reps } : {}),
      ...(note ? { note } : {}),
    });
  });
  return items;
}

/** Display label for a role-anchored main-lift engine key. */
const MAIN_LIFT_LABEL: Record<string, string> = {
  squat: "Squat",
  deadlift: "Deadlift",
  press: "Overhead Press",
  bench: "Bench Press",
};

/** Display label for an assistance category slot. */
const ASSIST_LABEL: Record<string, string> = {
  push: "Push assistance",
  pull: "Pull assistance",
  single_leg_or_core: "Single-leg / core assistance",
};

/**
 * Strength → role-anchored main lifts (warm-up ramp + working sets off the shared
 * 1RM, like Tactical Barbell / 5/3/1) plus station-specific accessories emitted as
 * category-tagged assistance INTENT (no movementId) the platform resolves to real
 * catalog movements via the shared ADR-0047 resolver.
 */
function buildStrength(sess: HyroxSession, ctx: PlatformContext, args: PrescribeArgs): PrescribedItem[] {
  const scheme = STRENGTH_SCHEME[args.phase];
  const items: PrescribedItem[] = [];

  // Main lifts — anchored on the user's 1RM via the role key.
  for (const movement of sess.movements) {
    const oneRm = ctx.oneRepMaxes[movement];
    const name = MAIN_LIFT_LABEL[movement] ?? movementLabel(movement);
    if (oneRm != null && oneRm > 0) {
      const weightKg = roundTo(oneRm * scheme.pct, ctx.roundingKg);
      items.push(
        ...buildGlobalWarmupItems({
          name,
          movementId: movement,
          workingWeightKg: weightKg,
          roundingKg: ctx.roundingKg,
        }),
      );
      items.push({
        kind: "main",
        name,
        movementId: movement,
        sets: scheme.sets,
        reps: scheme.reps,
        weightKg,
        percentOfTm: scheme.pct,
        note: `${Math.round(scheme.pct * 100)}% — station-specific strength; leave 1-2 reps in reserve.`,
      });
    } else {
      // No 1RM on file — prescribe by effort; the user logs the working weight.
      items.push({
        kind: "main",
        name,
        movementId: movement,
        sets: scheme.sets,
        reps: scheme.reps,
        note: `Work up to a challenging set of ${scheme.reps} (RPE ~8). No 1RM on file — log your working weight to start tracking it.`,
      });
    }
  }

  // Station-specific accessories — assistance INTENT (the platform resolves the
  // concrete movement). Trimmed in the taper to shed accumulated fatigue.
  const assistSets = args.phase === "taper" ? 2 : 3;
  for (const slot of sess.assist ?? []) {
    items.push({
      kind: "assistance",
      name: ASSIST_LABEL[slot] ?? slot,
      assistanceCategory: slot,
      sets: assistSets,
      reps: 8,
      repsMax: 12,
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/** Build the items for one session id (without its two-a-day `plus`, handled by caller). */
export function prescribeSession(
  sessionId: string,
  ctx: PlatformContext,
  args: PrescribeArgs,
): PrescribedItem[] {
  const sess = getHyroxSession(sessionId);
  if (!sess) return [];
  switch (sess.category) {
    case "run":
    case "erg":
      return buildAerobic(sess, args);
    case "intervals":
      return buildIntervals(sess, args);
    case "compromised":
      return buildCompromised(sess, args);
    case "circuit":
      return buildCircuit(sess, args);
    case "sim":
      return buildSimulation(sess, args);
    case "strength":
      return buildStrength(sess, ctx, args);
    default:
      return [];
  }
}

/** The deload-marker prescription — a light optional recovery session. */
export function deloadPrescription(): SessionPrescription {
  return {
    items: [
      {
        kind: "cardio",
        name: "Recovery (optional Z2)",
        movementId: "run",
        durationSec: 20 * 60,
        note: "Deload — drop volume and intensity this week. Optional easy Zone-2 movement only (run/ski/row/bike); let fatigue clear and adaptations land.",
      },
    ],
  };
}
