/**
 * Archetype library + planned-session generator.
 *
 * Strength days specify a **role** (squat / horizontal_press / deadlift /
 * vertical_press) and a candidate list of acceptable movement slugs. The
 * user picks which variant they actually want by setting a TM for that
 * specific movement; the planner uses whatever variant they've configured.
 *
 * v2 ships two archetypes: Strength Anchor and Endurance Anchor.
 */

import type { PrescriptionItem, PrescriptionItemKind } from "@hta/db";
import type { AccessoryProfile } from "./accessory-roles";
import { accessoryIntensity } from "./accessory-intensity";
import { cleanPrescriptionNotes } from "./clean-prescription-notes";

export type ArchetypeId =
  | "strength_anchor"
  | "endurance_anchor"
  | "rebuild"
  | "hypertrophy_anchor"
  | "concurrent_hybrid"
  | "maintenance"
  | "custom";

export type StrengthRole =
  | "squat"
  | "horizontal_press"
  | "deadlift"
  | "vertical_press";

export type WeekProfile = {
  weekIndex: number;
  setIntensities: number[];
  setReps: number | number[];
  intensityLabel: string;
  strengthVolumeScale?: number;
  z2DurationMinOverride?: number;
};

export type DayPriority = "anchor" | "optional";

/**
 * Two-a-day slot. Undefined / "single" = legacy one-session-per-day.
 * "am" / "pm" pair with another day-template at the same dayIndex.
 * DC-D1 dictates ≥6h gap between AM and PM; DC-D2 dictates strength-first.
 */
export type DaySlot = "am" | "pm" | "single";

export type StrengthDay = {
  kind: "strength";
  dayIndex: number;
  /**
   * Time-of-day slot for this session. Defaults to "single" (the only
   * session of the day) when omitted.
   *
   * IMPORTANT: Only set "am" / "pm" in the `twoADayDays` array — never
   * in the main `days` array. Setting it in `days` produces ghost slot
   * badges on single-mode plans (PR #67 regression risk).
   */
  slot?: DaySlot;
  role: StrengthRole;
  title: string;
  /** Acceptable movement slugs in preference order. The first one with a TM set wins. */
  candidateSlugs: string[];
  /** anchor = required to keep the archetype's identity; optional = dropped first at lower frequencies. */
  priority: DayPriority;
  /** Lower = kept longer. Tiebreak between optional days when trimming for capacity. */
  rank: number;
  /**
   * Per-day override of the archetype-level accessoriesByDefault flag.
   * When set, this day either always or never appends the curated
   * accessory pool to its prescription regardless of the archetype default.
   */
  includeAccessories?: boolean;
};

export type CardioDay = {
  kind: "cardio";
  dayIndex: number;
  /**
   * Time-of-day slot for this session. Defaults to "single" (the only
   * session of the day) when omitted.
   *
   * IMPORTANT: Only set "am" / "pm" in the `twoADayDays` array — never
   * in the main `days` array. Setting it in `days` produces ghost slot
   * badges on single-mode plans (PR #67 regression risk).
   */
  slot?: DaySlot;
  role: string;
  title: string;
  movementSlug: string;
  cardioKind: Extract<PrescriptionItemKind, `cardio_${string}`>;
  durationMin: number;
  hrCap?: string;
  protocolNote?: string;
  finisher?: {
    movementSlug: string;
    durationMin: number;
    protocolNote: string;
  };
  priority: DayPriority;
  rank: number;
};

/**
 * A dedicated tendon-loading day. Used by Rebuild and any archetype that
 * follows Baar / Kongsgaard / Alfredson protocols.
 *
 * Prescriptions are fixed per archetype (not user-tuned via TMs): the loads
 * are tempo-driven and self-selected in-session ("the weight that lets you
 * keep the eccentric controlled for the full reps"), so we ship sets/reps +
 * the protocol note and let the lifter pick the bar weight.
 */
export type TendonDay = {
  kind: "tendon";
  dayIndex: number;
  /**
   * Time-of-day slot for this session. Defaults to "single" (the only
   * session of the day) when omitted.
   *
   * IMPORTANT: Only set "am" / "pm" in the `twoADayDays` array — never
   * in the main `days` array. Setting it in `days` produces ghost slot
   * badges on single-mode plans (PR #67 regression risk).
   */
  slot?: DaySlot;
  role: string;
  title: string;
  movementSlug: string;
  sets: number;
  reps: number;
  /** Plain-language load + tempo guidance (e.g. "70-80% 1RM, 3-0-3-0 tempo"). */
  protocolNote: string;
  /** Short tag shown on the card ("HSR knee", "Heavy isometric — knee", etc.). */
  intensityLabel: string;
  priority: DayPriority;
  rank: number;
};

export type DayTemplate = StrengthDay | CardioDay | TendonDay;

export type Archetype = {
  id: ArchetypeId;
  name: string;
  oneLiner: string;
  weeks: number;
  days: DayTemplate[];
  /**
   * Curated two-a-day variant of `days`. Used when the user has set
   * `profiles.allows_two_a_days = true`. Same anchors, same total movements,
   * but cardio is moved into PM slots paired with morning lifts so the
   * AMPK / mTORC1 ≥ 6h gap (DC-D1) is respected by construction. Optional;
   * archetypes that don't benefit (e.g. Rebuild — capped intensity, single
   * sessions throughout) omit it.
   */
  twoADayDays?: DayTemplate[];
  /**
   * Default for whether strength days append the curated accessory pool
   * (lib/planner/accessories.ts). Per-day `includeAccessories` overrides.
   * Hypertrophy Focus opts in; Strength/Endurance/Rebuild default off.
   */
  accessoriesByDefault?: boolean;
  /**
   * Dynamic accessory picker config (docs/design/accessory-schema.md §22).
   * When present, the picker is invoked instead of the legacy static pool.
   * Existing archetypes keep `accessoriesByDefault` for the legacy path
   * until they migrate. New archetypes must declare `accessoryProfile`.
   */
  accessoryProfile?: AccessoryProfile;
  weekProfiles: WeekProfile[];
};

// ─── Curated candidate lists per role ──────────────────────────────
// First entry is the "canonical default" — preferred when multiple variants are tied.

export const STRENGTH_ROLE_LABELS: Record<StrengthRole, string> = {
  squat: "Squat",
  horizontal_press: "Horizontal press (bench)",
  deadlift: "Deadlift",
  vertical_press: "Vertical press (overhead)",
};

export const STRENGTH_ROLE_CANDIDATES: Record<StrengthRole, string[]> = {
  squat: [
    "back-squat-high-bar",
    "back-squat-low-bar",
    "front-squat",
    "safety-bar-squat",
    "box-squat",
    "belt-squat",
    "hack-squat",
    "zercher-squat",
  ],
  horizontal_press: [
    "bench-press-flat",
    "bench-press-incline",
    "bench-press-paused",
    "close-grip-bench",
    "db-bench-flat",
    "db-bench-incline",
    "floor-press",
    "smith-bench-press",
  ],
  deadlift: [
    "conventional-deadlift",
    "trap-bar-deadlift",
    "sumo-deadlift",
    "deficit-deadlift",
    "block-pull-deadlift",
    "romanian-deadlift",
  ],
  vertical_press: [
    "ohp-standing",
    "push-press",
    "ohp-seated",
    "db-shoulder-press-standing",
    "db-shoulder-press-seated",
    "z-press",
  ],
};

// ─── Archetypes ────────────────────────────────────────────────────

const STRENGTH_DAYS: StrengthDay[] = [
  {
    kind: "strength",
    dayIndex: 0,
    role: "squat",
    title: "Squat day",
    candidateSlugs: STRENGTH_ROLE_CANDIDATES.squat,
    priority: "anchor",
    rank: 1,
  },
  {
    kind: "strength",
    dayIndex: 1,
    role: "horizontal_press",
    title: "Bench day",
    candidateSlugs: STRENGTH_ROLE_CANDIDATES.horizontal_press,
    priority: "anchor",
    rank: 2,
  },
  {
    kind: "strength",
    dayIndex: 3,
    role: "deadlift",
    title: "Deadlift day",
    candidateSlugs: STRENGTH_ROLE_CANDIDATES.deadlift,
    priority: "anchor",
    rank: 3,
  },
  {
    kind: "strength",
    dayIndex: 4,
    role: "vertical_press",
    title: "Overhead press day",
    candidateSlugs: STRENGTH_ROLE_CANDIDATES.vertical_press,
    priority: "anchor",
    rank: 4,
  },
];

export const STRENGTH_ANCHOR: Archetype = {
  id: "strength_anchor",
  name: "Strength Focus",
  oneLiner:
    "Strength-led concurrent training. Four main lifts (your choice of variant per role) hit a weekly intensity wave with a deload at week 4. Polarized cardio is added when the day budget allows.",
  weeks: 4,
  accessoryProfile: {
    aesthetic: { itemsPerSession: 2, setsPerItem: 3, repRange: { min: 8, max: 12 }, biasSupported: false },
    functional: { weeklyRoleRequirements: { single_leg: 1 } },
    durability: { extras: [] },
  },
  days: [
    ...STRENGTH_DAYS,
    {
      kind: "cardio",
      dayIndex: 2,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 45,
      hrCap: "≤ 70% HRR, conversational",
      priority: "optional",
      rank: 5,
    },
    {
      kind: "cardio",
      dayIndex: 5,
      role: "long_z2_plus_alactic",
      title: "Long Z2 + alactic finisher",
      movementSlug: "run-long-z2",
      cardioKind: "cardio_z2",
      durationMin: 75,
      hrCap: "≤ 70% HRR, conversational",
      finisher: {
        movementSlug: "run-hill-sprints",
        durationMin: 10,
        protocolNote: "6–10 × 10–15s near-max, walk-down recovery",
      },
      priority: "optional",
      rank: 6,
    },
  ],
  /**
   * Two-a-day variant of Strength Anchor. Same four main lifts in AM slots
   * so they hit fresh; cardio gets absorbed into the same calendar day as
   * PM Z2, separated by the AM/PM window default (≥8h) to respect DC-D1.
   * Net result: 4 strength + 2 cardio in 4 calendar days instead of 6,
   * which mirrors how serious hybrid athletes structure their week.
   */
  twoADayDays: [
    { ...STRENGTH_DAYS[0]!, slot: "am" },
    {
      kind: "cardio",
      dayIndex: 0,
      slot: "pm",
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 45,
      hrCap: "≤ 70% HRR, conversational",
      priority: "optional",
      rank: 5,
    },
    { ...STRENGTH_DAYS[1]!, slot: "am" },
    { ...STRENGTH_DAYS[2]!, slot: "am" },
    {
      kind: "cardio",
      dayIndex: 3,
      slot: "pm",
      role: "long_z2_plus_alactic",
      title: "Long Z2 + alactic",
      movementSlug: "run-long-z2",
      cardioKind: "cardio_z2",
      durationMin: 75,
      hrCap: "≤ 70% HRR, conversational",
      finisher: {
        movementSlug: "run-hill-sprints",
        durationMin: 10,
        protocolNote: "6–10 × 10–15s near-max, walk-down recovery",
      },
      priority: "optional",
      rank: 6,
    },
    { ...STRENGTH_DAYS[3]!, slot: "am" },
  ],
  weekProfiles: [
    { weekIndex: 0, setIntensities: [0.65, 0.75, 0.85], setReps: 5, intensityLabel: "5s wave" },
    { weekIndex: 1, setIntensities: [0.70, 0.80, 0.90], setReps: 3, intensityLabel: "3s wave" },
    { weekIndex: 2, setIntensities: [0.75, 0.85, 0.95], setReps: [5, 3, 1], intensityLabel: "Heavy peak" },
    {
      weekIndex: 3,
      setIntensities: [0.40, 0.50, 0.60],
      setReps: 5,
      intensityLabel: "Deload",
      strengthVolumeScale: 0.5,
      z2DurationMinOverride: 30,
    },
  ],
};

export const ENDURANCE_ANCHOR: Archetype = {
  id: "endurance_anchor",
  name: "Endurance Focus",
  oneLiner:
    "Cardio-led concurrent training. Polarized aerobic exposures (long Z2 + VO2 intervals) anchor the week. Two strength maintenance days (your choice of squat and deadlift variant) keep strength from drifting; extra easy-Z2 days are added when the budget allows.",
  weeks: 4,
  accessoryProfile: {
    aesthetic: { itemsPerSession: 1, setsPerItem: 2, repRange: { min: 12, max: 15 }, biasSupported: true },
    functional: { weeklyRoleRequirements: { hip_stabilizer: 2, ankle_foot: 2 } },
    // Achilles-specific HSR above the floor — `new` §4.4: running miles
    // without HSR is the #1 patellar/Achilles tendinopathy etiology.
    durability: { extras: [{ role: "hsr", count: 1 }] },
  },
  days: [
    {
      kind: "cardio",
      dayIndex: 0,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "run-easy-z2",
      cardioKind: "cardio_z2",
      durationMin: 60,
      hrCap: "≤ 70% HRR, conversational",
      priority: "optional",
      rank: 6,
    },
    {
      kind: "strength",
      dayIndex: 1,
      role: "squat",
      title: "Squat maintenance",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.squat,
      priority: "anchor",
      rank: 3,
    },
    {
      kind: "cardio",
      dayIndex: 2,
      role: "z2_plus_alactic",
      title: "Z2 + alactic finisher",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 45,
      hrCap: "≤ 70% HRR, conversational",
      finisher: {
        movementSlug: "bike-indoor-sprints",
        durationMin: 10,
        protocolNote: "6–8 × 10–15s near-max, 1:10 rest",
      },
      priority: "optional",
      rank: 5,
    },
    {
      kind: "strength",
      dayIndex: 3,
      role: "deadlift",
      title: "Deadlift maintenance",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.deadlift,
      priority: "anchor",
      rank: 4,
    },
    {
      kind: "cardio",
      dayIndex: 4,
      role: "vo2_intervals",
      title: "VO2 intervals",
      movementSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      durationMin: 35,
      hrCap: "90–95% HRmax during work",
      protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      priority: "anchor",
      rank: 2,
    },
    {
      kind: "cardio",
      dayIndex: 5,
      role: "long_z2",
      title: "Long Z2",
      movementSlug: "run-long-z2",
      cardioKind: "cardio_z2",
      durationMin: 100,
      hrCap: "≤ 70% HRR, conversational",
      priority: "anchor",
      rank: 1,
    },
  ],
  /**
   * Two-a-day variant of Endurance Anchor. Strength maintenance days get
   * a PM long Z2 paired with them — DC-D1 ≥6h gap means morning strength
   * can still pull legitimate aerobic dose later in the day. The VO2
   * intervals day stays a single session (highest interference modality
   * per DC-L1; pairing it with anything magnifies the cost). Long-Z2
   * Sat stays single too — running ≥75 min is a 24h-recovery event per
   * DC-L3.
   */
  twoADayDays: [
    {
      kind: "strength",
      dayIndex: 1,
      slot: "am",
      role: "squat",
      title: "Squat maintenance",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.squat,
      priority: "anchor",
      rank: 3,
    },
    {
      kind: "cardio",
      dayIndex: 1,
      slot: "pm",
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 45,
      hrCap: "≤ 70% HRR, conversational",
      priority: "optional",
      rank: 6,
    },
    {
      kind: "cardio",
      dayIndex: 2,
      slot: "single",
      role: "z2_plus_alactic",
      title: "Z2 + alactic finisher",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 45,
      hrCap: "≤ 70% HRR, conversational",
      finisher: {
        movementSlug: "bike-indoor-sprints",
        durationMin: 10,
        protocolNote: "6–8 × 10–15s near-max, 1:10 rest",
      },
      priority: "optional",
      rank: 5,
    },
    {
      kind: "strength",
      dayIndex: 3,
      slot: "am",
      role: "deadlift",
      title: "Deadlift maintenance",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.deadlift,
      priority: "anchor",
      rank: 4,
    },
    {
      kind: "cardio",
      dayIndex: 3,
      slot: "pm",
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 45,
      hrCap: "≤ 70% HRR, conversational",
      priority: "optional",
      rank: 7,
    },
    {
      kind: "cardio",
      dayIndex: 4,
      slot: "single",
      role: "vo2_intervals",
      title: "VO2 intervals",
      movementSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      durationMin: 35,
      hrCap: "90–95% HRmax during work",
      protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      priority: "anchor",
      rank: 2,
    },
    {
      kind: "cardio",
      dayIndex: 5,
      slot: "single",
      role: "long_z2",
      title: "Long Z2",
      movementSlug: "run-long-z2",
      cardioKind: "cardio_z2",
      durationMin: 100,
      hrCap: "≤ 70% HRR, conversational",
      priority: "anchor",
      rank: 1,
    },
  ],
  weekProfiles: [
    { weekIndex: 0, setIntensities: [0.75, 0.85, 0.90], setReps: [5, 3, 3], intensityLabel: "Maintenance base" },
    { weekIndex: 1, setIntensities: [0.75, 0.85, 0.90], setReps: [5, 3, 3], intensityLabel: "Maintenance build" },
    { weekIndex: 2, setIntensities: [0.80, 0.85, 0.90], setReps: [3, 3, 3], intensityLabel: "Maintenance peak" },
    {
      weekIndex: 3,
      setIntensities: [0.50, 0.60, 0.70],
      setReps: 5,
      intensityLabel: "Deload",
      strengthVolumeScale: 0.5,
      z2DurationMinOverride: 30,
    },
  ],
};

/**
 * Rebuild — return-to-training / post-injury safety block.
 *
 * The whole block sits below the strength-driving floor on purpose. Top set
 * never crosses ~76% of true 1RM at TM 90%. The point is consistency + tissue
 * adaptation, not progression. Tendon anchors run twice/wk per Kongsgaard's
 * HSR protocol (3 sets × 8 reps @ 70-85% 1RM, 3-0-3-0 tempo) — equivalent
 * tendinopathy outcomes to eccentric-only protocols with better adherence
 * (Kongsgaard 2009 HIGH). Cardio is easy Z2 only — no threshold (DC-D7),
 * no VO2 until the user transitions out of rebuild.
 *
 * Min frequency = 4 d/wk (the 2 tendon + 2 strength anchors). At higher
 * frequency it adds easy Z2 days, never threshold or VO2.
 *
 * Rationale to ship now: every other archetype assumes a healthy athlete.
 * Rebuild fills the genuinely distinct safety case + introduces the tendon
 * day primitive that future archetypes can reuse.
 */
export const REBUILD: Archetype = {
  id: "rebuild",
  name: "Rebuild",
  oneLiner:
    "Return-to-training block for after an injury, layoff, or extended deload. Capped intensity (top set ≤80% TM), heavy slow resistance tendon work twice a week, easy Z2 for aerobic floor. Designed to load tissue safely, not to progress.",
  weeks: 4,
  // The dedicated TendonDay primitive carries the DC-O4 floor for Rebuild.
  // Aesthetic + functional are intentionally minimal.
  accessoryProfile: {
    aesthetic: { itemsPerSession: 1, setsPerItem: 2, repRange: { min: 12, max: 15 }, biasSupported: true },
    functional: { weeklyRoleRequirements: { loaded_mobility: 1 } },
    durability: { extras: [] },
  },
  days: [
    {
      kind: "tendon",
      dayIndex: 0,
      role: "hsr_knee",
      title: "HSR — knee",
      movementSlug: "hsr-leg-press",
      sets: 3,
      reps: 8,
      protocolNote: "70–80% 1RM, 3-0-3-0 tempo, 3 min rest",
      intensityLabel: "HSR knee",
      priority: "anchor",
      rank: 1,
    },
    {
      kind: "strength",
      dayIndex: 1,
      role: "squat",
      title: "Squat — light",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.squat,
      priority: "anchor",
      rank: 3,
    },
    {
      kind: "cardio",
      dayIndex: 2,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 30,
      hrCap: "≤ 65% HRR, conversational",
      priority: "optional",
      rank: 5,
    },
    {
      kind: "tendon",
      dayIndex: 3,
      role: "hsr_hinge",
      title: "HSR — posterior chain",
      movementSlug: "hsr-rdl",
      sets: 3,
      reps: 8,
      protocolNote: "70–80% 1RM, 3-0-3-0 tempo, 3 min rest",
      intensityLabel: "HSR hinge",
      priority: "anchor",
      rank: 2,
    },
    {
      kind: "strength",
      dayIndex: 4,
      role: "deadlift",
      title: "Deadlift — light",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.deadlift,
      priority: "anchor",
      rank: 4,
    },
    {
      kind: "cardio",
      dayIndex: 5,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "run-easy-z2",
      cardioKind: "cardio_z2",
      durationMin: 40,
      hrCap: "≤ 65% HRR, conversational",
      priority: "optional",
      rank: 6,
    },
  ],
  weekProfiles: [
    // Flat intensity ramp — rebuild is about consistency, not progression.
    { weekIndex: 0, setIntensities: [0.60, 0.65, 0.70], setReps: 5, intensityLabel: "Reload" },
    { weekIndex: 1, setIntensities: [0.65, 0.70, 0.75], setReps: 5, intensityLabel: "Build" },
    { weekIndex: 2, setIntensities: [0.65, 0.75, 0.80], setReps: 5, intensityLabel: "Consolidate" },
    {
      weekIndex: 3,
      setIntensities: [0.50, 0.55, 0.60],
      setReps: 5,
      intensityLabel: "Deload",
      strengthVolumeScale: 0.66,
      z2DurationMinOverride: 25,
    },
  ],
};

/**
 * Hypertrophy Anchor — muscle-building block.
 *
 * Same four main patterns as Strength Anchor, but tuned for hypertrophy:
 * - Lower per-set intensity (60–75% TM, so 54–67% of true 1RM at TM 90%)
 * - Higher rep counts (6–10 reps per set)
 * - More working sets per pattern (4 sets vs Strength Anchor's 3)
 * - 4-week block with mild deload
 *
 * Caveat shipped in the one-liner: v1 prescribes only the main lift per
 * session. Accessory work (chest flies, lateral raises, biceps, calves, abs)
 * is left to the lifter — add it live during the session via the log UI's
 * "+ add movement" button. A future iteration can add curated accessory
 * blocks.
 *
 * Research grounding: DC-B4 per-quality floors (Hypertrophy = per-muscle
 * MV/MEV), DC-T1 22-muscle taxonomy. Rep ranges per Murach & Bagley 2016
 * HIGH — hypertrophy is robust under concurrent load when intensity stays
 * in the 60–80% 1RM band.
 *
 * Why ship this fourth: distinct stimulus from Strength Anchor (different
 * rep/intensity/volume profile), most-asked archetype after the core two,
 * reuses existing infrastructure with no new primitive (unlike Rebuild's
 * tendon-day addition). Quality over quantity threshold met.
 */
export const HYPERTROPHY_ANCHOR: Archetype = {
  id: "hypertrophy_anchor",
  name: "Hypertrophy Focus",
  oneLiner:
    "Muscle-building block. Same four main patterns as Strength Focus but at hypertrophy intensity (60–75% TM, 6–10 reps, 4 working sets per pattern). One optional easy Z2 day preserves the aerobic floor. Curated accessory pool added per main lift — flies, lateral raises, biceps, calves — covering per-muscle volume gaps.",
  weeks: 4,
  accessoriesByDefault: true,
  accessoryProfile: {
    aesthetic: { itemsPerSession: 4, setsPerItem: 3, repRange: { min: 8, max: 15 }, biasSupported: false },
    functional: { weeklyRoleRequirements: {} },
    durability: { extras: [] },
  },
  days: [
    {
      kind: "strength",
      dayIndex: 0,
      role: "squat",
      title: "Squat — hypertrophy",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.squat,
      priority: "anchor",
      rank: 1,
    },
    {
      kind: "strength",
      dayIndex: 1,
      role: "horizontal_press",
      title: "Bench — hypertrophy",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.horizontal_press,
      priority: "anchor",
      rank: 2,
    },
    {
      kind: "cardio",
      dayIndex: 2,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 40,
      hrCap: "≤ 70% HRR, conversational",
      priority: "optional",
      rank: 5,
    },
    {
      kind: "strength",
      dayIndex: 3,
      role: "deadlift",
      title: "Deadlift — hypertrophy",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.deadlift,
      priority: "anchor",
      rank: 3,
    },
    {
      kind: "strength",
      dayIndex: 4,
      role: "vertical_press",
      title: "Overhead press — hypertrophy",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.vertical_press,
      priority: "anchor",
      rank: 4,
    },
  ],
  /**
   * Two-a-day variant of Hypertrophy Anchor. The hypertrophy stimulus is
   * the most robust under concurrent load per Murach & Bagley 2016 HIGH,
   * so we can comfortably double-up on Mon and Thu with PM Z2 — DC-L4
   * says muscle cross-section is preserved when intensity stays in the
   * 60-80% 1RM band (which this archetype does). The single optional
   * Wed Z2 stays untouched.
   */
  twoADayDays: [
    {
      kind: "strength",
      dayIndex: 0,
      slot: "am",
      role: "squat",
      title: "Squat — hypertrophy",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.squat,
      priority: "anchor",
      rank: 1,
    },
    {
      kind: "cardio",
      dayIndex: 0,
      slot: "pm",
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 35,
      hrCap: "≤ 70% HRR, conversational",
      priority: "optional",
      rank: 5,
    },
    {
      kind: "strength",
      dayIndex: 1,
      slot: "am",
      role: "horizontal_press",
      title: "Bench — hypertrophy",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.horizontal_press,
      priority: "anchor",
      rank: 2,
    },
    {
      kind: "cardio",
      dayIndex: 2,
      slot: "single",
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 40,
      hrCap: "≤ 70% HRR, conversational",
      priority: "optional",
      rank: 6,
    },
    {
      kind: "strength",
      dayIndex: 3,
      slot: "am",
      role: "deadlift",
      title: "Deadlift — hypertrophy",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.deadlift,
      priority: "anchor",
      rank: 3,
    },
    {
      kind: "cardio",
      dayIndex: 3,
      slot: "pm",
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 35,
      hrCap: "≤ 70% HRR, conversational",
      priority: "optional",
      rank: 7,
    },
    {
      kind: "strength",
      dayIndex: 4,
      slot: "am",
      role: "vertical_press",
      title: "Overhead press — hypertrophy",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.vertical_press,
      priority: "anchor",
      rank: 4,
    },
  ],
  // Hypertrophy wave: 4 working sets each week, building reps then trading
  // reps for load before deloading. Intensities sit firmly in the 60–75% TM
  // band (~54–67% of 1RM at TM 90%) — the rep range is what drives the
  // stimulus, not %TM.
  weekProfiles: [
    {
      weekIndex: 0,
      setIntensities: [0.60, 0.65, 0.70, 0.70],
      setReps: [10, 10, 8, 8],
      intensityLabel: "Volume base",
    },
    {
      weekIndex: 1,
      setIntensities: [0.60, 0.65, 0.70, 0.75],
      setReps: [10, 10, 8, 8],
      intensityLabel: "Volume build",
    },
    {
      weekIndex: 2,
      setIntensities: [0.65, 0.70, 0.75, 0.75],
      setReps: [10, 8, 8, 6],
      intensityLabel: "Volume peak",
    },
    {
      weekIndex: 3,
      setIntensities: [0.50, 0.60, 0.65],
      setReps: 8,
      intensityLabel: "Deload",
      strengthVolumeScale: 0.75,
      z2DurationMinOverride: 25,
    },
  ],
};

/**
 * Concurrent / Hybrid Focus — the intended default for most users.
 *
 * Balanced concurrent program: 4 strength days (same patterns as Strength
 * Focus) at moderate intensity + 2 substantive cardio sessions per week
 * with polarized distribution (~80% easy Z2, ~20% high-intensity VO2 /
 * threshold). Top set capped at 85% TM so cardio adaptation isn't
 * compromised by neural drain — per Wilson 2012 (HIGH meta) the
 * compatibility window favours intensity below max-strength territory.
 */
export const CONCURRENT_HYBRID: Archetype = {
  id: "concurrent_hybrid",
  name: "Hybrid Focus",
  oneLiner:
    "Balanced strength + cardio. Four main lifts at moderate intensity (top set ≤ 85% TM) protect cardio adaptation, and two substantive aerobic sessions — one polarized Z2, one VO2 / threshold — keep both engines running.",
  weeks: 4,
  accessoryProfile: {
    aesthetic: { itemsPerSession: 2, setsPerItem: 3, repRange: { min: 10, max: 15 }, biasSupported: true },
    functional: { weeklyRoleRequirements: { single_leg: 1, anti_rotation: 1 } },
    durability: { extras: [] },
  },
  days: [
    ...STRENGTH_DAYS,
    {
      kind: "cardio",
      dayIndex: 2,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 60,
      hrCap: "≤ 70% HRR, conversational",
      priority: "anchor",
      rank: 5,
    },
    {
      kind: "cardio",
      dayIndex: 5,
      role: "vo2",
      title: "VO2 intervals",
      movementSlug: "run-intervals-vo2",
      cardioKind: "cardio_vo2",
      durationMin: 45,
      protocolNote: "4×4 min @ 90–95% HRmax, 3 min easy between",
      priority: "anchor",
      rank: 6,
    },
  ],
  twoADayDays: [
    { ...STRENGTH_DAYS[0]!, slot: "am" },
    {
      kind: "cardio",
      dayIndex: 0,
      slot: "pm",
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 45,
      hrCap: "≤ 70% HRR, conversational",
      priority: "anchor",
      rank: 5,
    },
    { ...STRENGTH_DAYS[1]!, slot: "am" },
    { ...STRENGTH_DAYS[2]!, slot: "am" },
    {
      kind: "cardio",
      dayIndex: 3,
      slot: "pm",
      role: "vo2",
      title: "VO2 intervals",
      movementSlug: "run-intervals-vo2",
      cardioKind: "cardio_vo2",
      durationMin: 45,
      protocolNote: "4×4 min @ 90–95% HRmax, 3 min easy between",
      priority: "anchor",
      rank: 6,
    },
    { ...STRENGTH_DAYS[3]!, slot: "am" },
  ],
  weekProfiles: [
    { weekIndex: 0, setIntensities: [0.65, 0.72, 0.78], setReps: 5, intensityLabel: "5s wave" },
    { weekIndex: 1, setIntensities: [0.70, 0.77, 0.83], setReps: 5, intensityLabel: "5s wave" },
    { weekIndex: 2, setIntensities: [0.72, 0.79, 0.85], setReps: [5, 3, 3], intensityLabel: "Moderate peak" },
    {
      weekIndex: 3,
      setIntensities: [0.45, 0.55, 0.65],
      setReps: 5,
      intensityLabel: "Deload",
      strengthVolumeScale: 0.5,
      z2DurationMinOverride: 35,
    },
  ],
};

/**
 * Maintenance — keep the lights on during a busy stretch.
 *
 * Short two-week block at sub-maintenance volumes. Two strength days
 * (alternating squat/bench and deadlift/OHP) at 65–70% TM, two short Z2
 * sessions. The goal is to preserve neuromuscular skill and aerobic base
 * without spending recovery on adaptation. Per Bickel 2011 / Helms 2018:
 * roughly 1/3 of normal volume sustains strength and hypertrophy for
 * weeks. Drop this in when life is the limiting factor.
 */
export const MAINTENANCE: Archetype = {
  id: "maintenance",
  name: "Maintenance",
  oneLiner:
    "Two-week keep-the-lights-on block for travel, illness, or busy stretches. Two short strength days (65–70% TM, 3 working sets per lift) and two short Z2 sessions hold the line on strength and aerobic base without spending recovery on adaptation.",
  weeks: 2,
  accessoryProfile: {
    aesthetic: { itemsPerSession: 0, setsPerItem: 2, repRange: { min: 10, max: 15 }, biasSupported: true },
    functional: { weeklyRoleRequirements: {} },
    durability: { extras: [] },
  },
  days: [
    {
      kind: "strength",
      dayIndex: 0,
      role: "squat",
      title: "Squat + bench (maintenance)",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.squat,
      priority: "anchor",
      rank: 1,
    },
    {
      kind: "cardio",
      dayIndex: 2,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 30,
      hrCap: "≤ 70% HRR, conversational",
      priority: "anchor",
      rank: 3,
    },
    {
      kind: "strength",
      dayIndex: 3,
      role: "deadlift",
      title: "Deadlift + overhead (maintenance)",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.deadlift,
      priority: "anchor",
      rank: 2,
    },
    {
      kind: "cardio",
      dayIndex: 5,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 30,
      hrCap: "≤ 70% HRR, conversational",
      priority: "anchor",
      rank: 4,
    },
  ],
  // Two-a-day intentionally omitted — maintenance is about doing less, not
  // more density. The single-session shape is the right answer.
  weekProfiles: [
    {
      weekIndex: 0,
      setIntensities: [0.60, 0.65, 0.70],
      setReps: 5,
      intensityLabel: "Maintenance",
      strengthVolumeScale: 0.6,
    },
    {
      weekIndex: 1,
      setIntensities: [0.60, 0.65, 0.70],
      setReps: 5,
      intensityLabel: "Maintenance",
      strengthVolumeScale: 0.6,
    },
  ],
};

/** Curated archetypes. "custom" is not here — custom blocks are built ad-hoc. */
export const ARCHETYPES: Record<Exclude<ArchetypeId, "custom">, Archetype> = {
  strength_anchor: STRENGTH_ANCHOR,
  endurance_anchor: ENDURANCE_ANCHOR,
  rebuild: REBUILD,
  hypertrophy_anchor: HYPERTROPHY_ANCHOR,
  concurrent_hybrid: CONCURRENT_HYBRID,
  maintenance: MAINTENANCE,
};

export function roundToPlate(kg: number, increment = 2.5): number {
  return Math.round(kg / increment) * increment;
}

/** Resolve a day-template's slot, defaulting to "single" when undefined. */
export function daySlot(d: DayTemplate): DaySlot {
  return d.slot ?? "single";
}

/** Stable key for (dayIndex, slot) — used wherever AM and PM need separate buckets. */
export function daySlotKey(d: DayTemplate): string {
  return `${d.dayIndex}:${daySlot(d)}`;
}

/**
 * Return the day set that should drive planning for this user. When the
 * user has set allows_two_a_days = true AND the archetype defines a
 * curated twoADayDays variant, returns that; otherwise the default single-
 * session days.
 */
export function effectiveDays(archetype: Archetype, allowsTwoADays: boolean): DayTemplate[] {
  if (allowsTwoADays && archetype.twoADayDays && archetype.twoADayDays.length > 0) {
    return archetype.twoADayDays;
  }
  return archetype.days;
}

/**
 * Anchor day count = the minimum frequency at which the archetype is viable.
 *
 * `isBodyweightOnly` short-circuits the anchor-day count to a flat floor of 2.
 * For bodyweight-only users the prescription engine packs ~3 main families per
 * session via `bw-family-rotation.ts` (PR #93) regardless of which archetype
 * the user picks, so the "needs N anchor days" gate doesn't apply — three
 * sessions/week covers all 15 families over a typical cycle. We keep a floor
 * of 2 so users still can't accidentally pick a 1-day block.
 */
export function minDaysForArchetype(
  archetype: Archetype,
  allowsTwoADays = false,
  isBodyweightOnly = false,
): number {
  if (isBodyweightOnly) return 2;
  const days = effectiveDays(archetype, allowsTwoADays);
  // Count distinct calendar days touched by anchors (so a Mon AM + Mon PM
  // anchor pair counts as 1 required day).
  const anchorDayIndices = new Set(days.filter((d) => d.priority === "anchor").map((d) => d.dayIndex));
  return anchorDayIndices.size;
}

/** Total day count when the archetype is run at full frequency. */
export function maxDaysForArchetype(archetype: Archetype, allowsTwoADays = false): number {
  const days = effectiveDays(archetype, allowsTwoADays);
  return new Set(days.map((d) => d.dayIndex)).size;
}

/**
 * Pick which of the archetype's days run, given a target frequency.
 * Always keeps every anchor; adds optionals in rank order until the budget is hit.
 * Two-a-day pairs share a calendar day, so frequency is measured in distinct
 * dayIndex values, not total session count.
 */
export function daysForFrequency(
  archetype: Archetype,
  daysPerWeek: number,
  allowsTwoADays = false,
): DayTemplate[] {
  const source = effectiveDays(archetype, allowsTwoADays);
  const anchors = source.filter((d) => d.priority === "anchor");
  const optionals = source
    .filter((d) => d.priority === "optional")
    .sort((a, b) => a.rank - b.rank);
  const anchorDayIndices = new Set(anchors.map((d) => d.dayIndex));
  const budget = Math.max(0, daysPerWeek - anchorDayIndices.size);
  // Pick optionals greedily: a new calendar day costs 1 against the budget;
  // an optional that lands on an already-anchored calendar day is free.
  const chosen: DayTemplate[] = [...anchors];
  const touched = new Set(anchorDayIndices);
  let spent = 0;
  for (const opt of optionals) {
    const newDay = !touched.has(opt.dayIndex);
    if (newDay && spent >= budget) continue;
    if (newDay) {
      spent += 1;
      touched.add(opt.dayIndex);
    }
    chosen.push(opt);
  }
  // Stable order by (dayIndex, slot) so the week renders Mon → Sun and AM before PM.
  return chosen.sort((a, b) => {
    if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
    const slotOrder = { am: 0, single: 1, pm: 2 } as const;
    return slotOrder[daySlot(a)] - slotOrder[daySlot(b)];
  });
}

/** All strength roles the archetype needs (deduped). */
export function requiredStrengthRoles(archetype: Archetype): StrengthRole[] {
  const set = new Set<StrengthRole>();
  for (const d of archetype.days) {
    if (d.kind === "strength") set.add(d.role);
  }
  return Array.from(set);
}

/** Union of all candidate slugs across all strength days (both single + two-a-day variants). */
export function allCandidateLiftSlugs(archetype: Archetype): string[] {
  const set = new Set<string>();
  const pool: DayTemplate[] = [...archetype.days, ...(archetype.twoADayDays ?? [])];
  for (const d of pool) {
    if (d.kind === "strength") d.candidateSlugs.forEach((s) => set.add(s));
  }
  return Array.from(set);
}

export function requiredCardioSlugs(archetype: Archetype): string[] {
  const set = new Set<string>();
  const pool: DayTemplate[] = [...archetype.days, ...(archetype.twoADayDays ?? [])];
  for (const d of pool) {
    if (d.kind === "cardio") {
      set.add(d.movementSlug);
      if (d.finisher) set.add(d.finisher.movementSlug);
    }
  }
  return Array.from(set);
}

/** Tendon movement slugs used by the archetype (fixed; not user-pickable). */
export function requiredTendonSlugs(archetype: Archetype): string[] {
  const set = new Set<string>();
  const pool: DayTemplate[] = [...archetype.days, ...(archetype.twoADayDays ?? [])];
  for (const d of pool) {
    if (d.kind === "tendon") set.add(d.movementSlug);
  }
  return Array.from(set);
}

/** All non-strength slugs the archetype needs in the catalog. */
export function requiredFixedSlugs(archetype: Archetype): string[] {
  return Array.from(new Set([...requiredCardioSlugs(archetype), ...requiredTendonSlugs(archetype)]));
}

/**
 * True when this strength day should append accessory items. Reads
 * day.includeAccessories (explicit user override) and falls back to the
 * archetype's accessoriesByDefault flag.
 */
export function shouldIncludeAccessories(archetype: Archetype, day: StrengthDay): boolean {
  if (day.includeAccessories != null) return day.includeAccessories;
  return archetype.accessoriesByDefault === true;
}

export function buildPrescription(
  archetype: Archetype,
  weekIndex: number,
  day: DayTemplate,
  movement: { id: string; slug: string; displayName: string },
  finisherMovement?: { id: string; slug: string; displayName: string },
): PrescriptionItem[] {
  const profile = archetype.weekProfiles.find((w) => w.weekIndex === weekIndex);
  if (!profile) return [];

  if (day.kind === "strength") {
    const items: PrescriptionItem[] = profile.setIntensities.map((pct, i) => {
      const reps = Array.isArray(profile.setReps) ? profile.setReps[i] ?? 5 : profile.setReps;
      return {
        movementId: movement.id,
        movementSlug: movement.slug,
        movementName: movement.displayName,
        kind: "main",
        sets: 1,
        reps,
        percentTm: Math.round(pct * 100),
        intensityLabel: `${Math.round(pct * 100)}% TM`,
        notes: i === profile.setIntensities.length - 1 ? "top set" : undefined,
      };
    });
    if (profile.strengthVolumeScale != null && profile.strengthVolumeScale < 1) {
      const keep = Math.max(1, Math.round(items.length * profile.strengthVolumeScale));
      return items.slice(0, keep);
    }
    return items;
  }

  if (day.kind === "tendon") {
    // Tendon prescription is identical across non-deload weeks; deload halves
    // the set count to keep the protocol while reducing total exposure.
    const isDeload = profile.intensityLabel === "Deload";
    const sets = isDeload ? Math.max(1, Math.ceil(day.sets / 2)) : day.sets;
    // Tendon items always classify as the "tendon" bucket — the matrix
    // emits a 3 s eccentric tempo + RIR cue grounded in Baar 2017 /
    // Kongsgaard 2009 HSR protocols.
    const intensity = accessoryIntensity({
      archetype: archetype.id,
      bucket: "tendon",
      weekIndex,
    });
    const items: PrescriptionItem[] = [];
    for (let i = 0; i < sets; i++) {
      items.push({
        movementId: movement.id,
        movementSlug: movement.slug,
        movementName: movement.displayName,
        kind: "tendon",
        sets: 1,
        reps: day.reps,
        intensityLabel: day.intensityLabel,
        notes: day.protocolNote,
        targetRir: intensity.targetRir,
        targetRpe: intensity.targetRpe,
        tempoEccentricSec: intensity.tempoEccentricSec,
        holdSec: intensity.holdSec,
        intensityCue: intensity.intensityCue,
      });
    }
    return items;
  }

  // Cardio day.
  const durationMin = profile.z2DurationMinOverride ?? day.durationMin;
  const items: PrescriptionItem[] = [
    {
      movementId: movement.id,
      movementSlug: movement.slug,
      movementName: movement.displayName,
      kind: day.cardioKind,
      durationMin,
      hrCap: day.hrCap,
      protocolNote: day.protocolNote,
      intensityLabel:
        day.cardioKind === "cardio_z2"
          ? "Easy Z2"
          : day.cardioKind === "cardio_vo2"
            ? "VO2"
            : day.cardioKind === "cardio_alactic"
              ? "Alactic"
              : "Threshold",
    },
  ];
  if (day.finisher && finisherMovement) {
    items.push({
      movementId: finisherMovement.id,
      movementSlug: finisherMovement.slug,
      movementName: finisherMovement.displayName,
      kind: "cardio_alactic",
      durationMin: day.finisher.durationMin,
      protocolNote: day.finisher.protocolNote,
      intensityLabel: "Alactic finisher",
    });
  }
  return items;
}

export function formatPrescriptionItem(item: PrescriptionItem, tmKg?: number): string {
  if (item.kind.startsWith("cardio_")) {
    const parts: string[] = [];
    if (item.durationMin != null) parts.push(`${item.durationMin} min`);
    if (item.protocolNote) parts.push(item.protocolNote);
    else if (item.hrCap) parts.push(item.hrCap);
    return parts.join(" · ") || "cardio";
  }
  if (item.kind === "tendon") {
    const reps = item.reps != null ? `× ${item.reps}` : "";
    const cleanedNotes = cleanPrescriptionNotes(item.notes);
    const note = cleanedNotes ? ` · ${cleanedNotes}` : "";
    return `${item.intensityLabel ?? "Tendon"} ${reps}${note}`.trim();
  }
  if (item.kind === "accessory") {
    const sets = item.sets ?? 3;
    const reps = item.reps ?? 10;
    // Internal category tags ("durability" / "functional" / "aesthetic" /
    // "power") live on intensityLabel for engine bookkeeping but must not
    // be rendered to the user — the movement name (e.g. "Farmer carry")
    // shown alongside this row is enough.
    return `${sets} × ${reps}`;
  }
  const weight =
    item.percentTm != null && tmKg
      ? `${roundToPlate(tmKg * (item.percentTm / 100))} kg`
      : null;
  const intensity = item.intensityLabel ?? (item.percentTm ? `${item.percentTm}% TM` : null);
  const reps = item.reps != null ? `× ${item.reps}` : "";
  if (weight && intensity) return `${weight} (${intensity}) ${reps}`.trim();
  if (weight) return `${weight} ${reps}`.trim();
  if (intensity) return `${intensity} ${reps}`.trim();
  return reps;
}

/**
 * Short one-line subtitle that sits under the planned session's title
 * in the /app/plan card header and the /app today panel.
 *
 * Optimised for "what's this session about, in five words": leads with
 * the main lift and a working-set count, then a `+ N accessories`
 * suffix. TM percentages, warm-ups and set-by-set detail live inside
 * the expanded card body — re-stating them in the header is noise and
 * leaks engine vocabulary ("%TM") into the page chrome.
 */
export function summarisePrescription(items: PrescriptionItem[]): string {
  if (items.length === 0) return "";

  const cardio = items.filter((i) => i.kind.startsWith("cardio_"));
  if (cardio.length > 0 && cardio.length === items.length) {
    const totalMin = cardio.reduce((a, i) => a + (i.durationMin ?? 0), 0);
    const labels = Array.from(
      new Set(cardio.map((i) => i.intensityLabel ?? null).filter((l): l is string => !!l)),
    );
    const leadLabel = labels.length > 0 ? labels.join(" + ") : (cardio[0]?.movementName ?? "Cardio");
    return totalMin > 0 ? `${leadLabel} — ${totalMin} min` : leadLabel;
  }

  const tendon = items.filter((i) => i.kind === "tendon");
  if (tendon.length > 0 && tendon.length === items.length) {
    const uniqueMovements = new Set(
      tendon.map((i) => i.movementId ?? i.movementSlug ?? i.movementName ?? "tendon"),
    );
    const count = uniqueMovements.size;
    return `Tendon work — ${count} movement${count === 1 ? "" : "s"}`;
  }

  const mainWorking = items.filter(
    (i) => i.kind === "main" || i.kind === "back_off" || i.kind === "power_potentiation",
  );
  const accessories = items.filter((i) => i.kind === "accessory");
  const uniqueAccessoryMovements = new Set(
    accessories.map(
      (i, idx) => i.movementId ?? i.movementSlug ?? i.movementName ?? `acc-${idx}`,
    ),
  );
  const accessoryCount = uniqueAccessoryMovements.size;
  const accessoryTail =
    accessoryCount > 0
      ? ` + ${accessoryCount} accessor${accessoryCount === 1 ? "y" : "ies"}`
      : "";

  if (mainWorking.length > 0) {
    const lead = mainWorking.find((i) => i.kind === "main") ?? mainWorking[0]!;
    const name = lead.movementName ?? humaniseSlug(lead.movementSlug) ?? "Main lift";
    const sets = mainWorking.length;
    return `${name} — ${sets} working set${sets === 1 ? "" : "s"}${accessoryTail}`;
  }

  if (accessories.length > 0 && accessories.length === items.length) {
    return `Accessory circuit — ${accessoryCount} movement${accessoryCount === 1 ? "" : "s"}`;
  }

  return `${items.length} items`;
}

function humaniseSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const cleaned = slug.replaceAll("_", " ").trim();
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
