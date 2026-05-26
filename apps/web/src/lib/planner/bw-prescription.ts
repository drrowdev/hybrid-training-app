/**
 * Research-grounded prescription matrix for bodyweight main lifts.
 *
 * Why this exists
 * ───────────────
 * The strength engine prescribes barbell main lifts as a percent of
 * training-max (standard practitioner-consensus linear-periodisation
 * practice; Helms 2018 covers the autoregulation half of the same
 * toolkit). That model doesn't transfer to bodyweight users: there is
 * no loadable weight to anchor %TM against, and the unit of progression
 * is a discrete DAG node (push_up → archer_push_up → one_arm_push_up),
 * not +2.5 kg. Per the bodyweight addendum:
 *   - principle 1 — strength is relative, not absolute
 *   - principle 2 — progression is discrete, not linear (DAG nodes)
 *   - principle 4 — tendons adapt 2–10× slower than muscle, so the
 *     tempo / hold-time prescription has to bias toward time-under-
 *     tension rather than raw rep counts on the most advanced nodes
 *   - principle 5 — skill work is neurologically demanding even when
 *     "light"; rest periods must reflect that
 *
 * This module returns a per-set prescription matrix shaped by
 * (node, family, archetype, bucket, weekIndex). Mirrors the structural
 * pattern in `accessory-intensity.ts`: pure module, deterministic, no
 * I/O, no DB, no React.
 *
 * Citations (kept here, never in user-facing UI copy — DC-Q6):
 *   - Schoenfeld 2017 — 6–12 reps at RPE 7–9 (RIR 1–3) drives
 *     hypertrophy; 12–20 reps at RPE 7–8 (RIR 2–3) similarly effective
 *     when proximity to failure is controlled.
 *   - Helms 2018 — autoregulation via RPE / RIR is the appropriate
 *     cue when intra-day strength varies meaningfully (true on every
 *     bodyweight skill — a fresh CNS is the difference between a clean
 *     front lever and a sloppy one).
 *   - Israetel — wave-loaded volume landmarks scale week to week (MEV
 *     → MAV → MRV); proximity to failure tightens at the volume peak
 *     and opens back up on deload.
 *   - Baar 2017 / Kongsgaard 2009 — heavy slow resistance + isometric
 *     work needs slow tempo (3 s+ eccentric) and meaningful TUT to
 *     drive tendon adaptation. Calisthenics is already heavily
 *     isometric; programmed correctly the strength work IS the
 *     tendon work.
 *   - Behm & Sale 1993 — neural-driven max-intent strength work uses
 *     long rest (3 min+) at low rep counts.
 *   - Practitioner consensus (calisthenics community) — skill nodes
 *     (planche / lever / flag / handstand) belong early in the day,
 *     early in the week, and run on hold time rather than reps.
 *
 * Pure module. No I/O. No DB. No React.
 */
import type { MovementFamily, MovementNode } from "@hta/db";
import type { ArchetypeId } from "./archetypes";
import type { Equipment } from "@/lib/settings/equipment-schema";
import { effectiveTrainingMaxKg } from "./bw-multiplier";
import { SET_KIND_LABELS } from "@/lib/sessions/set-kind-labels";

const BACK_OFF_LABEL = SET_KIND_LABELS.back_off.label;

/**
 * Source the engine resolved the external load from. `band_assist`
 * carries a negative `externalLoadKg` (assistance, not load).
 */
export type BwLoadSource =
  | "weighted_vest"
  | "dip_belt"
  | "ankle_weights"
  | "band_assist";

/**
 * One BW main-lift prescription line. Embedded in the planned-session
 * `PrescriptionItem.bw` slot so MovementFocusView can render the
 * appropriate input (reps stepper vs hold-time stepper) and the
 * weight column is hidden when there is no `training_max_kg` to
 * multiply against.
 */
export type BwPrescription = {
  /** Selects the input shape on the focus card. */
  prescriptionType: "reps" | "isometric_hold" | "tempo_reps";
  sets: number;
  /** Present when prescriptionType is `reps` or `tempo_reps`. */
  reps?: number;
  /**
   * Optional rep range. Engine + UI consume `reps` as the headline
   * target; `repRange` is rendered alongside it ("× 5 (4–6) reps")
   * when present.
   */
  repRange?: { min: number; max: number };
  /** Present when prescriptionType is `isometric_hold`. */
  holdSeconds?: number;
  /** Eccentric component in seconds. Drives the tempo cue. */
  tempoEccentricSec: number;
  /** 0 = to failure; 1–4 = backed off. */
  targetRir: number;
  restSeconds: number;
  /** Short, instructional copy shown on the focus card. ≤ 80 chars. */
  intensityCue: string;
  /** Longer copy (skill cues, tendon-loading reminders). */
  notes?: string;
  /**
   * Phase 7 — suggested external load (vest / belt / ankle weights).
   * Undefined ⇒ bodyweight only. May be 0 with a defined `loadSource`
   * when the user is "ready for load" but the engine hasn't yet bumped
   * the starting weight (see `bwPrescription` Stage D rules).
   * Negative values are emitted for band-assist on sub-pull-up nodes.
   */
  externalLoadKg?: number;
  /** Phase 7 — what kit the engine chose to deliver `externalLoadKg`. */
  loadSource?: BwLoadSource;
  /**
   * Phase 7 — `bodyweight × bwMultiplier(node) + externalLoadKg`.
   * Bridges loaded BW into the existing TM-based stress engine.
   * Always emitted (even when externalLoadKg is undefined) for
   * loadable nodes; 0 for skill / unmapped nodes.
   */
  effectiveTrainingMaxKg?: number;
};

/**
 * Which archetypes participate in the matrix. The five canonical
 * archetypes + `mixed` (any archetype the matrix doesn't recognise
 * falls through to hypertrophy defaults — see decision 2).
 */
type MatrixArchetype =
  | "strength_anchor"
  | "hypertrophy_anchor"
  | "endurance_anchor"
  | "concurrent_hybrid"
  | "rebuild"
  | "maintenance"
  | "mixed";

function normaliseArchetype(id: ArchetypeId | string): MatrixArchetype {
  switch (id) {
    case "strength_anchor":
    case "hypertrophy_anchor":
    case "endurance_anchor":
    case "concurrent_hybrid":
    case "rebuild":
    case "maintenance":
      return id;
    default:
      // `custom`, future archetypes, or any unknown id — hypertrophy
      // defaults are the safest middle ground (decision 2).
      return "mixed";
  }
}

/**
 * Skill families. Per principle 5, these run on hold time rather
 * than reps and get long rest + tendon-cue notes.
 *
 * Kept as a Set so the lookup is O(1) and the membership reads cleanly
 * in `decidePrescriptionType` below.
 */
const SKILL_FAMILIES = new Set<MovementFamily>([
  "planche",
  "lever_front",
  "lever_back",
  "human_flag",
  "handstand",
]);

/**
 * Decision 1 — prescription type.
 *
 * Source: calisthenics practitioner consensus (skill families train by
 * hold time, not reps) + Baar 2017 (slow eccentric drives tendon
 * adaptation on the advanced nodes where muscle is otherwise outrunning
 * tendon).
 */
function decidePrescriptionType(
  node: MovementNode,
  family: MovementFamily,
  archetype: MatrixArchetype,
): BwPrescription["prescriptionType"] {
  // Endurance archetype overrides: never tempo_reps, never isometric_hold
  // for non-skill families — endurance bias is high-rep, lower-intent.
  // Isometric-capable skill nodes still hold (treated as TUT below).
  const isSkillFamily = SKILL_FAMILIES.has(family);
  const isHoldNode =
    node.isometricCapable === true &&
    (isSkillFamily || node.nodeKey.includes("_hold"));

  if (isHoldNode) return "isometric_hold";

  if (archetype === "endurance_anchor") return "reps";

  // Advanced unilateral / skill push-ups benefit from a slow eccentric
  // (Baar 2017 — tempo is the cheap stimulus that lets the lifter stay
  // on a node the muscle has otherwise outgrown). Threshold 60 maps to
  // the upper-intermediate band of difficulty_anchor.
  if (node.difficultyAnchor >= 60) return "tempo_reps";

  return "reps";
}

// ─── Per-archetype sets × reps / holds × weeks ────────────────────────────

type WeeklyRow = {
  /** Sets per week index 0..3. */
  sets: readonly [number, number, number, number];
  /** Headline reps (for `reps` / `tempo_reps`) or hold seconds (for `isometric_hold`). */
  values: readonly [number, number, number, number];
  /** Target RIR per week index 0..3. */
  rir: readonly [number, number, number, number];
};

/**
 * Strength-anchor matrix.
 *
 * Source: Schoenfeld 2017 (low-rep high-intent ≤ 6 reps drives strength
 * with minimal hypertrophy noise) + Israetel volume-landmark waves
 * (RIR tightens at the build-week peak, opens back up on deload).
 * Week 3 is the canonical deload — reps drop slightly, sets cut to 3,
 * RIR opens to 3.
 */
const STRENGTH_REPS: WeeklyRow = {
  sets: [5, 5, 5, 3],
  values: [5, 4, 3, 5],
  rir: [2, 1, 1, 3],
};

const STRENGTH_HOLD: WeeklyRow = {
  // Hold-time progression: short to start, longest at the build peak,
  // back to ramp duration on deload. RIR for holds is a perceived-
  // effort proxy ("hold to ~8/10 effort, not failure") — see cueFor.
  sets: [5, 5, 5, 3],
  values: [6, 8, 10, 6],
  rir: [2, 1, 1, 3],
};

/**
 * Hypertrophy-anchor matrix.
 *
 * Source: Schoenfeld 2017 (6–12 reps at RPE 7–9 / RIR 1–3 drives
 * hypertrophy when proximity to failure is controlled) + practitioner
 * consensus that bodyweight hypertrophy needs higher rep counts because
 * the load doesn't scale linearly. tempoEccentricSec is bumped one
 * second above the node default in `tempoFor` below to accumulate TUT.
 */
const HYPERTROPHY_REPS: WeeklyRow = {
  sets: [4, 4, 4, 3],
  values: [8, 10, 12, 8],
  rir: [2, 1, 1, 3],
};

const HYPERTROPHY_HOLD: WeeklyRow = {
  sets: [4, 4, 4, 3],
  values: [10, 14, 18, 10],
  rir: [2, 1, 1, 3],
};

/**
 * Endurance-anchor matrix.
 *
 * Source: Schoenfeld 2017 (12–20 reps at RPE 7–8 / RIR 2–3 produces
 * hypertrophy when proximity to failure is controlled — the dose
 * principle that lets us push bodyweight endurance into the 15–25 rep
 * band without losing the strength signal). Lower intent across the
 * board; faster eccentric (decision 3) keeps density up.
 */
const ENDURANCE_REPS: WeeklyRow = {
  sets: [3, 3, 3, 2],
  values: [15, 20, 25, 15],
  rir: [3, 2, 2, 4],
};

/**
 * `concurrent_hybrid` + `rebuild` + `maintenance` fall through to the
 * hypertrophy matrix (decision 2 — mixed / no clear anchor defaults).
 * Each gets a softer RIR / fewer sets via the deload column when its
 * own week profile flags a recovery week downstream.
 */
function rowFor(
  archetype: MatrixArchetype,
  type: BwPrescription["prescriptionType"],
): WeeklyRow {
  if (archetype === "strength_anchor") {
    return type === "isometric_hold" ? STRENGTH_HOLD : STRENGTH_REPS;
  }
  if (archetype === "endurance_anchor") {
    // Endurance never prescribes tempo_reps (decision 2). isometric_hold
    // nodes that land in this archetype get treated as TUT — see the
    // special-case in `bwPrescription` below.
    return ENDURANCE_REPS;
  }
  // hypertrophy_anchor, concurrent_hybrid, rebuild, maintenance, mixed
  return type === "isometric_hold" ? HYPERTROPHY_HOLD : HYPERTROPHY_REPS;
}

// ─── Tempo + rest + cues ─────────────────────────────────────────────────

/**
 * Decision 3 — tempoEccentricSec.
 *
 * Source: Baar 2017 (3 s+ eccentric for tendon work) + practitioner
 * consensus for bodyweight strength (hypertrophy gets the slow tempo
 * to drive TUT, endurance keeps it short to preserve density).
 */
function tempoFor(
  node: MovementNode,
  archetype: MatrixArchetype,
  weekIndex: 0 | 1 | 2 | 3,
): number {
  const base =
    archetype === "strength_anchor"
      ? node.defaultTempoSeconds
      : archetype === "hypertrophy_anchor"
        ? Math.max(4, node.defaultTempoSeconds + 1)
        : archetype === "endurance_anchor"
          ? Math.min(3, node.defaultTempoSeconds)
          : node.defaultTempoSeconds;
  // Deload week subtracts 1 second across the board — the engine isn't
  // chasing TUT on the recovery week.
  const deloadAdj = weekIndex === 3 ? 1 : 0;
  return Math.max(1, base - deloadAdj);
}

/**
 * Decision 4 — restSeconds.
 *
 * Source: Behm & Sale 1993 (neural-driven max-intent strength needs
 * 3 min+ rest) + practitioner consensus that skill nodes need full
 * recovery between sets. Hypertrophy intentionally short to keep
 * stimulus high; endurance shorter still to preserve density.
 */
function restFor(
  node: MovementNode,
  archetype: MatrixArchetype,
): number {
  const isSkill = node.isometricCapable && node.difficultyAnchor >= 50;
  if (archetype === "strength_anchor") return isSkill ? 180 : 150;
  if (archetype === "hypertrophy_anchor") return 90;
  if (archetype === "endurance_anchor") return 60;
  // mixed / rebuild / maintenance / concurrent_hybrid — fall through to
  // the hypertrophy default (decision 2).
  return 90;
}

/**
 * Decision 5 — intensityCue + notes.
 *
 * Cues are short, instructional, second-person, plain English. No
 * methodology names or external program references (DC-Q6). The
 * deload week gets its own "quality over volume" framing.
 */
function cueFor(
  type: BwPrescription["prescriptionType"],
  archetype: MatrixArchetype,
  weekIndex: 0 | 1 | 2 | 3,
  bucket: BwBucket,
): string {
  if (weekIndex === 3) {
    return "Quality over volume. Stop 3 reps from failure.";
  }
  if (bucket === "back_off") {
    if (type === "isometric_hold") return "Lighter hold. Stop when bracing breaks.";
    return `${BACK_OFF_LABEL} set — clean reps only. Stop 3 from form breakdown.`;
  }
  if (type === "isometric_hold") {
    return "Hold to ~8/10 effort, not failure. Maintain hollow body throughout.";
  }
  if (type === "tempo_reps") {
    return "Slow eccentric: control the lowering, drive up explosively.";
  }
  // reps
  if (archetype === "endurance_anchor") {
    return "Steady pace. Stop 2 reps before form breaks down.";
  }
  if (archetype === "strength_anchor") {
    return "Stop 1 rep before form breaks down. Long rest between sets.";
  }
  return "Clean reps. Push the last set close to failure but never past form.";
}

/**
 * Notes — only emitted when there's something meaningful to say.
 * Currently: tendon-loading reminders on advanced isometric-capable
 * nodes (Baar 2017 — TUT accumulation is what drives tendon adaptation,
 * and those skills are where the tendon timeline becomes the binding
 * constraint per addendum principle 4).
 */
function notesFor(
  node: MovementNode,
  type: BwPrescription["prescriptionType"],
): string | undefined {
  if (type === "isometric_hold" && node.difficultyAnchor >= 50) {
    return "Advanced skill nodes load the tendon harder than the muscle. Bank time-under-tension now — the joint adapts slowly.";
  }
  return undefined;
}

// ─── Cap reps when node is sub-failure-friendly ──────────────────────────

/**
 * Decision 6 — cap reps when the user's history says they can't yet
 * hit the prescribed count cleanly.
 *
 * Source: bodyweight addendum principle 2 — "require over-completion
 * before unlocking the next node." Inverse logic here: don't ASK for
 * over-completion the user can't yet deliver. We use `clean_rep_history`
 * (jsonb array from bw_progress) as the per-user calibration signal.
 *
 * In v1 we don't track per-session capacity yet, so the cap only fires
 * for very-early nodes (difficulty_anchor < 20). When history exists we
 * cap at 1.5× median of the last 3 clean entries; otherwise no cap.
 */
function capRepsForCapacity(
  prescribed: number,
  node: MovementNode,
  cleanRepHistory: ReadonlyArray<{ reps?: number; seconds?: number }>,
): number {
  if (node.difficultyAnchor >= 20) return prescribed;
  const repEntries = cleanRepHistory
    .map((e) => (typeof e.reps === "number" ? e.reps : null))
    .filter((n): n is number => n != null && n > 0);
  if (repEntries.length === 0) return prescribed;
  const recent = repEntries.slice(-3).sort((a, b) => a - b);
  const median =
    recent.length === 0
      ? prescribed
      : recent[Math.floor(recent.length / 2)] ?? prescribed;
  const cap = Math.max(1, Math.round(median * 1.5));
  return Math.min(prescribed, cap);
}

// ─── Back-off shaping ────────────────────────────────────────────────────

/**
 * Back-off shaping per archetype:
 *   - strength_anchor: one tier lower, 2 sets × (reps + 3) or (hold − 2 s), RIR 3
 *   - hypertrophy_anchor: same node, 2 sets × (failure − 1), RIR 1
 *   - endurance_anchor: 1 set × failure, RIR 0
 *
 * "One tier lower" is a hint to the caller (Stage B) — the engine picks
 * which node from the DAG to use; this matrix just shapes the volume +
 * RIR for whichever node lands here.
 *
 * Source: Israetel volume-landmark wave theory (back-off sets accumulate
 * sub-MAV volume after the main heavy work without colliding with the
 * next session's recovery).
 */
function shapeBackOff(
  main: BwPrescription,
  archetype: MatrixArchetype,
): BwPrescription {
  if (archetype === "endurance_anchor") {
    return {
      ...main,
      sets: 1,
      targetRir: 0,
      intensityCue: "Final set — push until form breaks. One set only.",
    };
  }
  if (archetype === "hypertrophy_anchor") {
    return {
      ...main,
      sets: 2,
      targetRir: 1,
      intensityCue: `${BACK_OFF_LABEL} — last rep should be the last clean rep.`,
    };
  }
  // strength_anchor + everything else: 2 sets, looser RIR, slightly
  // higher rep / shorter hold target on the same node (caller decides
  // whether to swap to a one-tier-lower node).
  const next: BwPrescription = {
    ...main,
    sets: 2,
    targetRir: 3,
    intensityCue: `${BACK_OFF_LABEL} — looser proximity. 3 in the tank.`,
  };
  if (main.prescriptionType === "isometric_hold") {
    next.holdSeconds = Math.max(3, (main.holdSeconds ?? 0) - 2);
  } else {
    next.reps = (main.reps ?? 0) + 3;
  }
  return next;
}

// ─── Public API ──────────────────────────────────────────────────────────

export type BwBucket = "main" | "back_off";

export function bwPrescription(args: {
  node: MovementNode;
  family: MovementFamily;
  archetype: ArchetypeId | string;
  bucket: BwBucket;
  weekIndex: 0 | 1 | 2 | 3;
  /**
   * Append-only audit log from `bw_progress.clean_rep_history`. Used by
   * decision 6 to cap prescribed reps when the user is on an early
   * node and can't yet hit the matrix default.
   */
  cleanRepHistory?: ReadonlyArray<{
    reps?: number;
    seconds?: number;
    rir?: number;
    clean_form?: boolean;
    prescribed_reps?: number;
    prescribed_hold?: number;
    external_load_kg?: number;
  }>;
  /**
   * Phase 7 — user's resolved equipment inventory. When present and the
   * node is `external_load_capable`, the engine picks a `loadSource` +
   * `externalLoadKg` per the Stage D rules. Omit to get pure
   * bodyweight behaviour (back-compat with Phase 1–6 callers).
   */
  equipment?: Equipment;
  /**
   * Phase 7 — user's body mass in kg. Drives `effectiveTrainingMaxKg`
   * and the starting-load heuristic (5% BW). Falls back to 75 kg when
   * unknown so the multiplier table still produces a usable bridge
   * value.
   */
  userBodyweightKg?: number;
}): BwPrescription {
  const archetype = normaliseArchetype(args.archetype);
  const type = decidePrescriptionType(args.node, args.family, archetype);

  // Endurance special-case: isometric-capable nodes that land in the
  // endurance archetype get treated as TUT — seconds = tutPerRepSeconds
  // × {3, 4, 5, 3} for weeks 0..3, sets = {3, 3, 3, 2}.
  if (type === "isometric_hold" && archetype === "endurance_anchor") {
    const tutMultiplier: readonly [number, number, number, number] = [3, 4, 5, 3];
    const sets: readonly [number, number, number, number] = [3, 3, 3, 2];
    const seconds = Math.max(
      3,
      Math.round(args.node.tutPerRepSeconds * (tutMultiplier[args.weekIndex] ?? 3)),
    );
    const main: BwPrescription = {
      prescriptionType: "isometric_hold",
      sets: sets[args.weekIndex] ?? 3,
      holdSeconds: seconds,
      tempoEccentricSec: tempoFor(args.node, archetype, args.weekIndex),
      targetRir: ENDURANCE_REPS.rir[args.weekIndex] ?? 3,
      restSeconds: restFor(args.node, archetype),
      intensityCue: cueFor("isometric_hold", archetype, args.weekIndex, "main"),
      notes: notesFor(args.node, "isometric_hold"),
    };
    const shaped = args.bucket === "back_off" ? shapeBackOff(main, archetype) : main;
    return applyLoadedExtension(shaped, args);
  }

  const row = rowFor(archetype, type);
  const sets = row.sets[args.weekIndex] ?? row.sets[1] ?? 3;
  const rawValue = row.values[args.weekIndex] ?? row.values[1] ?? 5;
  const rir = row.rir[args.weekIndex] ?? row.rir[1] ?? 2;
  const tempo = tempoFor(args.node, archetype, args.weekIndex);
  const rest = restFor(args.node, archetype);

  const main: BwPrescription = {
    prescriptionType: type,
    sets,
    tempoEccentricSec: tempo,
    targetRir: rir,
    restSeconds: rest,
    intensityCue: cueFor(type, archetype, args.weekIndex, "main"),
    notes: notesFor(args.node, type),
  };

  if (type === "isometric_hold") {
    main.holdSeconds = rawValue;
  } else {
    const capped = capRepsForCapacity(
      rawValue,
      args.node,
      args.cleanRepHistory ?? [],
    );
    main.reps = capped;
    // Expose ±2 reps as a soft range so the UI can render "× 5 (3–7)".
    main.repRange = { min: Math.max(1, capped - 2), max: capped + 2 };
  }

  const shaped = args.bucket === "back_off" ? shapeBackOff(main, archetype) : main;
  return applyLoadedExtension(shaped, args);
}

// ─── Stage D — loaded BW extension ────────────────────────────────────

const BAND_ASSIST_KG: Record<NonNullable<Equipment["accessories"]["bandStrength"]>, number> = {
  light: -5,
  medium: -10,
  heavy: -18,
  extra_heavy: -28,
};

const PUSH_FAMILIES: ReadonlySet<MovementFamily> = new Set<MovementFamily>([
  "push_h",
  "push_v",
  "planche",
  "muscle_up",
]);
const PULL_FAMILIES: ReadonlySet<MovementFamily> = new Set<MovementFamily>([
  "pull_h",
  "pull_v",
  "lever_front",
  "lever_back",
  "human_flag",
]);
const SQUAT_HINGE_FAMILIES: ReadonlySet<MovementFamily> = new Set<MovementFamily>([
  "squat_bilateral",
  "squat_unilateral",
  "hinge",
]);
const SINGLE_LEG_NODES: ReadonlySet<string> = new Set<string>([
  "split_squat",
  "bulgarian_split_squat",
  "shrimp_squat",
  "assisted_pistol",
  "strict_pistol",
  "shrimp_pistol",
  "single_leg_rdl_bw",
]);
const SUB_PULL_UP_NODES: ReadonlySet<string> = new Set<string>([
  "negative_pull_up",
  "scapular_pull",
]);

/**
 * Round a kilogram value to the nearest 2.5 kg, never returning a
 * negative number. Used for vest / belt / ankle starting loads.
 */
function roundToHalfPlate(kg: number): number {
  if (kg <= 0) return 0;
  return Math.round(kg / 2.5) * 2.5;
}

/**
 * Did the user over-complete the last 2+ entries in clean_rep_history?
 * Mirror of the gate logic from Phase 4 (`bw-progression.ts`):
 * +2 reps OR +3 sec hold, RIR ≥ 1, clean form.
 */
function recentlyOverCompleted(
  history: ReadonlyArray<{
    reps?: number;
    seconds?: number;
    rir?: number;
    clean_form?: boolean;
    prescribed_reps?: number;
    prescribed_hold?: number;
  }>,
): boolean {
  if (history.length < 2) return false;
  const last2 = history.slice(-2);
  let hits = 0;
  for (const e of last2) {
    if (e.clean_form === false) continue;
    if ((e.rir ?? 0) < 1) continue;
    if (
      e.prescribed_reps != null &&
      e.reps != null &&
      e.reps >= e.prescribed_reps + 2
    ) {
      hits++;
      continue;
    }
    if (
      e.prescribed_hold != null &&
      e.seconds != null &&
      e.seconds >= e.prescribed_hold + 3
    ) {
      hits++;
    }
  }
  return hits >= 2;
}

/**
 * Pick the load source for a loadable node × equipment combination.
 * Returns null when no loadable kit is available.
 *
 * Selection rules (Stage D.2):
 *   - Push/pull family + dip belt → dip_belt (more secure on hangs)
 *   - Push/pull family + vest only → weighted_vest
 *   - Squat/hinge family + vest → weighted_vest
 *   - Single-leg work + ankle weights + no vest → ankle_weights
 */
function pickLoadSource(
  family: MovementFamily,
  node: MovementNode,
  equipment: Equipment,
): BwLoadSource | null {
  const acc = equipment.accessories;
  const hasVest = acc.weightedVest.length > 0;
  const hasBelt = acc.dipBelt === true;
  const hasAnkle = Boolean(acc.ankleWeights);

  if (PUSH_FAMILIES.has(family) || PULL_FAMILIES.has(family)) {
    if (hasBelt) return "dip_belt";
    if (hasVest) return "weighted_vest";
    return null;
  }
  if (SQUAT_HINGE_FAMILIES.has(family)) {
    if (SINGLE_LEG_NODES.has(node.nodeKey) && hasAnkle && !hasVest) {
      return "ankle_weights";
    }
    if (hasVest) return "weighted_vest";
    if (SINGLE_LEG_NODES.has(node.nodeKey) && hasAnkle) return "ankle_weights";
    return null;
  }
  return null;
}

/**
 * Cap a candidate external-load kg against the equipment ceiling for
 * the chosen source. Returns the (possibly lower) load to actually
 * emit. Negative values pass through unchanged (band assist).
 */
function capLoadForSource(
  source: BwLoadSource,
  loadKg: number,
  equipment: Equipment,
): number {
  if (loadKg < 0) return loadKg;
  const acc = equipment.accessories;
  if (source === "weighted_vest" && acc.weightedVest.length > 0) {
    return Math.min(loadKg, Math.max(...acc.weightedVest));
  }
  if (source === "dip_belt") {
    if (typeof acc.dipBeltMaxKg === "number" && acc.dipBeltMaxKg > 0) {
      return Math.min(loadKg, acc.dipBeltMaxKg);
    }
    return loadKg;
  }
  if (source === "ankle_weights" && acc.ankleWeights) {
    return Math.min(loadKg, acc.ankleWeights.kg);
  }
  return loadKg;
}

/**
 * Suggest an external-load kg given the user's recent over-completion
 * pattern and prior loaded entries. Returns 0 when the user is in the
 * "readiness" state (loadable kit present, but they haven't yet
 * over-completed enough to earn a load bump).
 *
 * Heuristic:
 *   - Not over-completing for 2+ weeks → 0 kg (readiness chip).
 *   - First loaded session → 5% BW, rounded to nearest 2.5 kg.
 *   - Subsequent → last load + (1.25 kg if weekIndex is deload OR
 *     average RIR < 1, else 2.5 kg).
 */
function suggestExternalLoadKg(args: {
  node: MovementNode;
  weekIndex: 0 | 1 | 2 | 3;
  userBodyweightKg: number;
  cleanRepHistory?: ReadonlyArray<{
    reps?: number;
    seconds?: number;
    rir?: number;
    clean_form?: boolean;
    prescribed_reps?: number;
    prescribed_hold?: number;
    external_load_kg?: number;
  }>;
}): number {
  const history = args.cleanRepHistory ?? [];
  if (!recentlyOverCompleted(history)) return 0;

  // Find the most recent entry with a recorded external_load_kg.
  const lastLoaded = [...history].reverse().find(
    (e) => typeof e.external_load_kg === "number" && (e.external_load_kg ?? 0) > 0,
  );
  if (!lastLoaded) {
    const start = roundToHalfPlate(args.userBodyweightKg * 0.05);
    return Math.max(2.5, start);
  }

  const lastRirs = history
    .slice(-3)
    .map((e) => e.rir ?? 0)
    .filter((n) => Number.isFinite(n));
  const avgRir =
    lastRirs.length > 0
      ? lastRirs.reduce((a, b) => a + b, 0) / lastRirs.length
      : 0;
  const step = args.weekIndex === 3 || avgRir < 1 ? 1.25 : 2.5;
  const next = (lastLoaded.external_load_kg ?? 0) + step;
  return roundToHalfPlate(next);
}

/**
 * Apply the Stage D / Stage E loaded-BW extension to a base prescription.
 * Pure: does not mutate the input.
 */
function applyLoadedExtension(
  base: BwPrescription,
  args: {
    node: MovementNode;
    family: MovementFamily;
    weekIndex: 0 | 1 | 2 | 3;
    equipment?: Equipment;
    userBodyweightKg?: number;
    cleanRepHistory?: ReadonlyArray<{
      reps?: number;
      seconds?: number;
      rir?: number;
      clean_form?: boolean;
      prescribed_reps?: number;
      prescribed_hold?: number;
      external_load_kg?: number;
    }>;
  },
): BwPrescription {
  const bodyweight = args.userBodyweightKg ?? 75;

  // Always emit effectiveTrainingMaxKg for loadable nodes — even when
  // no external load is applied, so the stress engine has something to
  // bridge against.
  const baseEffectiveTm = effectiveTrainingMaxKg({
    node: args.node,
    userBodyweightKg: bodyweight,
    externalLoadKg: 0,
  });

  // Stage E — band-assist on sub-pull-up nodes.
  if (
    args.equipment &&
    SUB_PULL_UP_NODES.has(args.node.nodeKey) &&
    args.equipment.accessories.bands === true
  ) {
    const strength: NonNullable<Equipment["accessories"]["bandStrength"]> =
      args.equipment.accessories.bandStrength ?? "medium";
    const assist = BAND_ASSIST_KG[strength];
    const next: BwPrescription = {
      ...base,
      externalLoadKg: assist,
      loadSource: "band_assist",
      effectiveTrainingMaxKg: effectiveTrainingMaxKg({
        node: args.node,
        userBodyweightKg: bodyweight,
        externalLoadKg: assist,
      }),
    };
    // Append band-assist cue (preserve any existing notes).
    const assistCue = `Band-assisted: choose tension that leaves you at RIR ${base.targetRir}.`;
    next.notes = base.notes ? `${base.notes} ${assistCue}` : assistCue;
    return next;
  }

  if (!args.equipment || args.node.externalLoadCapable !== true) {
    if (baseEffectiveTm > 0) {
      return { ...base, effectiveTrainingMaxKg: baseEffectiveTm };
    }
    return base;
  }

  const source = pickLoadSource(args.family, args.node, args.equipment);
  if (!source) {
    if (baseEffectiveTm > 0) {
      return { ...base, effectiveTrainingMaxKg: baseEffectiveTm };
    }
    return base;
  }

  const suggested = suggestExternalLoadKg({
    node: args.node,
    weekIndex: args.weekIndex,
    userBodyweightKg: bodyweight,
    cleanRepHistory: args.cleanRepHistory,
  });
  const capped = capLoadForSource(source, suggested, args.equipment);

  return {
    ...base,
    externalLoadKg: capped,
    loadSource: source,
    effectiveTrainingMaxKg: effectiveTrainingMaxKg({
      node: args.node,
      userBodyweightKg: bodyweight,
      externalLoadKg: capped,
    }),
  };
}
