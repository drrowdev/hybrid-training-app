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
import type { PlatformContext, PrescribedItem, SessionPrescription, CardioPlan } from "@hta/program-core";
import { buildGlobalWarmupItems } from "@hta/program-core";
import { getHyroxSession, type HyroxSession } from "./sessions";
import {
  HYROX_STATIONS,
  getStation,
  stationRows,
  intervalStationRows,
  stationLoadValue,
  stationTargetLabel,
} from "./divisions";
import type { HyroxExperience, HyroxDivision } from "./types";
import type { HyroxPhaseId } from "./phases";
import {
  overriddenStationName,
  applyOverridesToStationRows,
  type StationOverrides,
} from "./station-alternatives";

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
/**
 * Strength loading per phase. HYROX strength is SUPPORTIVE and power-endurance —
 * moderate-heavy and repeatable, never a max-strength peak (ADR 0057). Reps stay
 * in the 4–6 band, intensity ≤ ~80% 1RM. `[DEF]` coach-consensus, user-gated.
 */
const STRENGTH_SCHEME: Record<HyroxPhaseId, StrengthScheme> = {
  base: { sets: 4, reps: 6, pct: 0.72 }, // accumulate, build work capacity, groove patterns
  build: { sets: 5, reps: 5, pct: 0.78 }, // intensify with VOLUME, not a heavy single — stays sub-max
  specific: { sets: 3, reps: 4, pct: 0.78 }, // maintain strength, shed volume for the race
  taper: { sets: 2, reps: 3, pct: 0.65 }, // stay sharp, minimal fatigue
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

/**
 * Taper ROUNDS delta for conditioning sessions (compromised-run, station-intervals).
 * ADR 0065. A volume-down / intensity-maintained taper (Bosquet 2007 meta-analysis:
 * a progressive ~41–60% volume reduction over 1–2 weeks, with intensity held, best
 * raises performance). We shed total work (rounds) and keep race-pace effort: the
 * sharpen week drops one round, the race week two — `Math.max(2, …)` at the call site
 * floors every taper session to a brief sharpener, never empty. `[DEF]` calibration
 * inside the Bosquet window.
 */
function taperRoundsDelta(taperKind: PrescribeArgs["taperKind"]): number {
  if (taperKind === "race") return -2;
  if (taperKind === "sharpen") return -1;
  return 0;
}

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
  /** 1-based block week — rotates the focused station selection (ADR 0062). */
  week?: number;
  /** Taper sub-kind (ADR 0065) — sheds conditioning ROUNDS in taper weeks so the
   *  race week is a brief sharpener, not a full-volume session. `null`/absent on
   *  non-taper weeks. */
  taperKind?: "sharpen" | "race" | null;
  /** Competition weight category — selects the gender-correct station loads. */
  gender?: "male" | "female";
}

/**
 * Focused station rotation (ADR 0062) + paired two-block sessions (ADR 0063). A
 * station-intervals / SE-circuit session targets SMALL, equipment-coherent station
 * subsets — not all 6/4 at once (simulation-shaped + impractical: a sled lane +
 * both ergs + wall + sandbag held at once, 20+ transitions). Real HYROX conditioning
 * is focused couplets. The focus rotates by week so the block covers everything.
 *
 * A single focused couplet is short (~20 min), so a conditioning DAY pairs TWO
 * complementary couplets done SEQUENTIALLY (finish block 1, then block 2) — coherent
 * kit at any one time, ~40 min total. The week selects the first block; the second is
 * the next group in the rotation.
 */
const STATION_FOCUS_GROUPS: Record<string, { label: string; movements: string[] }[]> = {
  "station-intervals": [
    { label: "sled power", movements: ["sled-push", "sled-pull"] }, // turf lane only
    { label: "erg + wall ball", movements: ["rowing-erg", "wall-ball"] }, // rower + med ball
    { label: "SkiErg + lunges", movements: ["skierg", "sandbag-lunge"] }, // ski + sandbag
  ],
  "se-circuit": [
    { label: "bodyweight engine", movements: ["wall-ball", "burpee-broad-jump"] }, // minimal kit
    { label: "loaded carries", movements: ["sandbag-lunge", "farmers-carry"] }, // sandbag + KBs
  ],
};

export interface StationBlock {
  label?: string;
  movements: readonly string[];
}

/**
 * The focused station BLOCKS for a session in a given week (ADR 0062 / 0063) — two
 * complementary couplets (the week's group + the next in the rotation) for the paired
 * station sessions, done sequentially. Sessions not in the rotation map (e.g.
 * vo2-intervals) yield a single fallback block of their full movement list.
 */
export function stationBlocksForWeek(
  sessionId: string,
  week: number,
  fallback: readonly string[],
): StationBlock[] {
  const groups = STATION_FOCUS_GROUPS[sessionId];
  if (!groups || groups.length === 0) return [{ movements: fallback }];
  const w = Math.max(1, Math.floor(week));
  const idx = (w - 1) % groups.length;
  const a = groups[idx]!;
  const b = groups[(idx + 1) % groups.length]!;
  return [
    { label: a.label, movements: a.movements },
    { label: b.label, movements: b.movements },
  ];
}

/**
 * `[DEF]` duration heuristics for station conditioning sessions (ADR 0063) — no
 * calibration data; refine against logged session times. A station's per-round chunk
 * (work + brief transition) ≈ 75 s; rest between rounds ≈ 75 s; ~8 min warm-up once;
 * ~2 min reset between paired blocks.
 */
const STATION_BOUT_SEC = 75;
const STATION_ROUND_REST_SEC = 75;
const STATION_WARMUP_SEC = 8 * 60;
const STATION_INTER_BLOCK_REST_SEC = 2 * 60;

function estimateStationSessionSec(blocks: StationBlock[], rounds: number): number {
  let work = 0;
  for (const b of blocks) {
    const perRound = b.movements.length * STATION_BOUT_SEC;
    work += rounds * perRound + Math.max(0, rounds - 1) * STATION_ROUND_REST_SEC;
  }
  const interBlock = Math.max(0, blocks.length - 1) * STATION_INTER_BLOCK_REST_SEC;
  return STATION_WARMUP_SEC + work + interBlock;
}

/**
 * Build the EACH-ROUND segments + union station rows for one or more focused blocks.
 * `overrides` (ADR 0064) relabels swapped stations for a per-session equipment change.
 */
export function stationBlockPlanParts(
  blocks: StationBlock[],
  division: HyroxDivision,
  gender?: "male" | "female",
  overrides?: StationOverrides,
): {
  segments: { label: string; detail: string }[];
  stations: { name: string; load?: string; target?: string; key?: string }[];
} {
  const nameOf = (m: string) => overriddenStationName(m, overrides) || movementLabel(m);
  const paired = blocks.length > 1;
  const segments = blocks.map((b, i) => {
    const rotation = b.movements.map(nameOf).join(" → ");
    const focus = b.label ? `${b.label.charAt(0).toUpperCase()}${b.label.slice(1)} — ` : "";
    return { label: paired ? `Block ${i + 1}` : "Each round", detail: `${focus}${rotation}` };
  });
  const stations = applyOverridesToStationRows(
    blocks.flatMap((b) => intervalStationRows(b.movements, division, gender)),
    overrides,
  );
  return { segments, stations };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-category builders
// ─────────────────────────────────────────────────────────────────────────────

/** A run/erg session → one cardio item with a duration target + structured plan. */
function buildAerobic(sess: HyroxSession, args: PrescribeArgs): PrescribedItem[] {
  const baseMin = EASY_RUN_MIN[args.experience] * AEROBIC_PHASE_MULT[args.phase];
  let durMin = baseMin;
  if (sess.id === "long-run") durMin = baseMin * 1.6;
  if (sess.id === "threshold-run") {
    durMin = THRESHOLD_MIN[args.experience] * (args.phase === "taper" ? 0.7 : 1);
  }
  if (args.isDeload) durMin = Math.min(durMin, 30);
  const dur = Math.round(durMin);
  const isErg = sess.category === "erg";
  const machine =
    sess.id === "easy-ski" ? "SkiErg" : sess.id === "easy-row" ? "row" : sess.id === "easy-bike" ? "bike" : "run";

  let plan: CardioPlan;
  if (sess.id === "threshold-run") {
    const work = Math.max(8, dur - 15); // ~10 min warm-up + ~5 min cool-down
    plan = {
      summary: "A sustained, comfortably-hard run at around your 10K–half-marathon effort.",
      meta: `~${dur} min`,
      segments: [
        { label: "Warm-up", detail: "~10 min easy" },
        { label: "Threshold", detail: `~${work} min steady at RPE 7–8` },
        { label: "Cool-down", detail: "~5 min easy" },
      ],
      effort: "Comfortably hard (RPE 7–8) — breathing hard but in control, a pace you could just about hold to the finish.",
      logHint: "Log it from your watch or Strava when you're done.",
    };
  } else {
    const longest = sess.id === "long-run";
    plan = {
      summary: longest
        ? "Your longest easy run of the week — build durability for the back half of the race. Longer, not harder."
        : isErg
          ? `Steady ${machine} at an easy aerobic pace — low-impact engine work that spares the legs.`
          : "Easy aerobic run — the steady mileage that builds the engine carrying roughly half the race.",
      meta: `~${dur} min`,
      effort: "Easy Zone 2 (RPE 4–5) — conversational the whole way. If you can't talk in full sentences, slow down.",
      logHint: "Log it from your watch or Strava when you're done.",
    };
  }

  return [
    {
      kind: "cardio",
      name: sess.name,
      ...mid(sess.movements[0]),
      durationSec: minutes(durMin),
      note: plan.summary,
      cardioPlan: plan,
    },
  ];
}

/** VO2 / station intervals → a conditioning item expressed in rounds + structured plan. */
function buildIntervals(sess: HyroxSession, args: PrescribeArgs): PrescribedItem[] {
  const rounds = Math.max(
    2,
    ROUNDS_BY_LEVEL[args.experience] +
      (args.phase === "specific" ? 1 : 0) +
      (args.phase === "taper" ? taperRoundsDelta(args.taperKind) : 0),
  );

  let plan: CardioPlan;
  let durationSec: number | null = null;
  if (sess.id === "vo2-intervals") {
    plan = {
      summary: "Hard running intervals to lift your top-end engine and running economy.",
      meta: `${rounds} × 800 m`,
      segments: [
        { label: "Warm-up", detail: "~10 min easy + a few strides" },
        { label: "Intervals", detail: `${rounds} × 800 m hard, with equal-time jog/walk recovery` },
        { label: "Cool-down", detail: "~5 min easy" },
      ],
      effort: "Hard on the reps (RPE 8–9) — controlled, repeatable, not a sprint. Easy on the recoveries.",
      logHint: "Log it from your watch or Strava when you're done.",
    };
  } else {
    const blocks = stationBlocksForWeek(sess.id, args.week ?? 1, sess.movements);
    const { segments, stations } = stationBlockPlanParts(blocks, args.division, args.gender);
    const paired = blocks.length > 1;
    const labels = blocks.map((b) => b.label).filter(Boolean) as string[];
    plan = {
      summary: paired
        ? `Two focused blocks — ${labels[0]}, then ${labels[1]}. Finish one fully (all ${rounds} rounds), reset, then the next. Hard and repeatable, not max.`
        : "Rotate through the race stations at a hard, repeatable effort — sharpen technique, transitions and pacing on the costliest stations.",
      meta: paired ? `2 blocks · ${rounds} rounds each` : `${rounds} rounds`,
      segments,
      stations,
      effort:
        "Hard but repeatable (RPE 7–8) — race pace, not max. Short rest between stations, a longer break between rounds and blocks.",
      logHint: "Manual session — tap Mark complete when you're done.",
    };
    durationSec = estimateStationSessionSec(blocks, rounds);
  }

  const blocks = stationBlocksForWeek(sess.id, args.week ?? 1, sess.movements);
  const paired = blocks.length > 1;
  return [
    {
      kind: "conditioning",
      name: sess.name,
      ...mid(blocks[0]!.movements[0]),
      sets: rounds,
      repsLabel: paired ? `2 blocks · ${rounds} rounds` : `${rounds} rounds`,
      ...(durationSec != null ? { durationSec } : {}),
      note: plan.summary,
      cardioPlan: plan,
    },
  ];
}

/** Compromised running → run → station → run rounds under fatigue + structured plan. */
function buildCompromised(sess: HyroxSession, args: PrescribeArgs): PrescribedItem[] {
  const rounds = Math.max(
    2,
    ROUNDS_BY_LEVEL[args.experience] + (args.phase === "taper" ? taperRoundsDelta(args.taperKind) : 0),
  );
  const plan: CardioPlan = {
    summary:
      "The signature HYROX session: run hard on legs already fatigued by a station — the race-specific skill of running under fatigue.",
    meta: `${rounds} rounds`,
    segments: [{ label: "Each round", detail: "1 km run → one race station → 1 km run, minimal rest" }],
    stations: stationRows(sess.movements, args.division, args.gender),
    effort: "Race effort (RPE 7–8). The runs will feel heavy after the station — that's the point. Hold form.",
    logHint: "Manual session — tap Mark complete when you're done.",
  };
  return [
    {
      kind: "conditioning",
      name: sess.name,
      ...mid(sess.movements[0]),
      sets: rounds,
      repsLabel: `${rounds} rounds`,
      note: plan.summary,
      cardioPlan: plan,
    },
  ];
}

/** Strength-endurance circuit → station combos at sustainable load + structured plan. */
function buildCircuit(sess: HyroxSession, args: PrescribeArgs): PrescribedItem[] {
  const rounds = ROUNDS_BY_LEVEL[args.experience];
  const blocks = stationBlocksForWeek(sess.id, args.week ?? 1, sess.movements);
  const { segments, stations } = stationBlockPlanParts(blocks, args.division, args.gender);
  const paired = blocks.length > 1;
  const labels = blocks.map((b) => b.label).filter(Boolean) as string[];
  const plan: CardioPlan = {
    summary: paired
      ? `Two focused strength-endurance blocks — ${labels[0]}, then ${labels[1]}. Finish one fully (all ${rounds} rounds), reset, then the next. High reps at a load you can keep moving through.`
      : "Strength-endurance circuit — high reps in the race movement patterns at a load you can keep moving through.",
    meta: paired ? `2 blocks · ${rounds} rounds each` : `${rounds} rounds`,
    segments,
    stations,
    effort: "Sustainable and steady — keep moving, don't redline. Build muscular endurance, not max strength.",
    logHint: "Manual session — tap Mark complete when you're done.",
  };
  return [
    {
      kind: "conditioning",
      name: sess.name,
      ...mid(blocks[0]!.movements[0]),
      sets: rounds,
      repsLabel: paired ? `2 blocks · ${rounds} rounds` : `${rounds} rounds`,
      durationSec: estimateStationSessionSec(blocks, rounds),
      note: plan.summary,
      cardioPlan: plan,
    },
  ];
}

/** A race simulation → the stations in order at race effort (a benchmark test). */
function buildSimulation(sess: HyroxSession, args: PrescribeArgs): PrescribedItem[] {
  const half = sess.id === "sim-half";
  const stations = HYROX_STATIONS.slice(0, half ? 4 : 8);
  const intro = half
    ? "Half-race rehearsal — 4 runs (1 km each) alternating with the first 4 stations, at race effort. Practise pacing, transitions and fuelling."
    : "Full-race rehearsal — all 8 runs + 8 stations in race order, at race effort. A costly stimulus: use rarely, never close to the event.";
  const items: PrescribedItem[] = [];
  stations.forEach((st, idx) => {
    const load = stationLoadValue(st, args.division, args.gender);
    const target = stationTargetLabel(st, args.gender);
    const plan: CardioPlan = {
      summary: idx === 0 ? intro : st.note ?? `${st.name} at race effort.`,
      meta: half ? `Station ${idx + 1} of 4` : `Station ${idx + 1} of 8`,
      segments: [{ label: "Before this station", detail: "1 km run at race pace" }],
      stations: [
        {
          name: st.name,
          ...(load ? { load } : {}),
          ...(target ? { target } : {}),
        },
      ],
      effort: "Race effort — controlled and even. Treat it like the real thing.",
      logHint: "Manual session — tap Mark complete when you're done.",
    };
    items.push({
      kind: "conditioning",
      name: st.name,
      movementId: st.movement,
      ...(st.distanceM != null ? { distanceM: st.distanceM } : {}),
      ...(st.reps != null ? { reps: st.reps } : {}),
      note: idx === 0 ? intro : st.note ?? st.name,
      cardioPlan: plan,
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
  push: "Push accessory",
  push_overhead: "Overhead press",
  pull: "Pull accessory",
  pull_vertical: "Vertical pull",
  pull_horizontal: "Horizontal pull",
  single_leg: "Single-leg",
  core: "Core / trunk",
  carry: "Loaded carry",
  prehab: "Prehab",
};

/**
 * HYROX-specific accessory prescription per slot (ADR 0057). Strength-endurance
 * lean: single-leg + core run higher reps; carries are prescribed by distance/time
 * (no rep target). `[DEF]` coach-consensus.
 */
interface AccessorySpec {
  reps?: number;
  repsMax?: number;
  note: string;
}
const ACCESSORY_SPEC: Record<string, AccessorySpec> = {
  single_leg: {
    reps: 10,
    repsMax: 15,
    note: "Per leg — controlled, full range. The engine behind the lunges, sled and compromised running.",
  },
  carry: {
    note: "Heavy carry — ~30–40 m (or ~30–40 s) per set. Tall posture, ribs down, crush the grip. Trains the farmers-carry station.",
  },
  pull: {
    reps: 8,
    repsMax: 12,
    note: "Strict, full range — posture and the sled pull.",
  },
  core: {
    reps: 12,
    repsMax: 20,
    note: "Brace hard — anti-rotation / anti-extension for the sandbag, carries and wall balls.",
  },
  push: {
    reps: 8,
    repsMax: 12,
    note: "Strict press — supports the wall-ball overhead drive.",
  },
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

  // Station-specific accessories (ADR 0058). Prefer the per-accessory specs
  // (demand-matched reps); fall back to the flat `assist` slots + ACCESSORY_SPEC
  // for legacy sessions. The taper trims one working set (min 2).
  const taperTrim = args.phase === "taper" ? 1 : 0;
  if (sess.accessories && sess.accessories.length > 0) {
    for (const acc of sess.accessories) {
      const sets = Math.max(2, (acc.sets ?? 3) - taperTrim);
      items.push({
        kind: "assistance",
        name: acc.label ?? ASSIST_LABEL[acc.slot] ?? acc.slot,
        assistanceCategory: acc.slot,
        sets,
        ...(acc.reps !== undefined ? { reps: acc.reps } : {}),
        ...(acc.repsMax !== undefined ? { repsMax: acc.repsMax } : {}),
        ...(acc.distanceM !== undefined ? { distanceRangeM: acc.distanceM } : {}),
        ...(acc.note ? { note: acc.note } : {}),
      });
    }
  } else {
    const assistSets = Math.max(2, 3 - taperTrim);
    for (const slot of sess.assist ?? []) {
      const spec = ACCESSORY_SPEC[slot] ?? { reps: 8, repsMax: 12, note: "" };
      items.push({
        kind: "assistance",
        name: ASSIST_LABEL[slot] ?? slot,
        assistanceCategory: slot,
        sets: assistSets,
        ...(spec.reps !== undefined ? { reps: spec.reps } : {}),
        ...(spec.repsMax !== undefined ? { repsMax: spec.repsMax } : {}),
        ...(spec.note ? { note: spec.note } : {}),
      });
    }
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
  const plan: CardioPlan = {
    summary: "Deload week — keep it light so accumulated fatigue clears and your recent training pays off.",
    meta: "optional · ~20 min",
    effort: "Very easy Zone 2 (RPE 3–4) movement only — run, ski, row or bike. Skip it entirely if you're beat.",
    logHint: "Optional — log it from your watch or Strava if you do it.",
  };
  return {
    items: [
      {
        kind: "cardio",
        name: "Recovery (optional easy Z2)",
        movementId: "run",
        durationSec: 20 * 60,
        note: plan.summary,
        cardioPlan: plan,
      },
    ],
  };
}
