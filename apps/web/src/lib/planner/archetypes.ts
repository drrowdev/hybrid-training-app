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
import { movementIdentityKey } from "@/lib/sessions/movement-attribution";
import {
  NO_ACTIVE_MODIFICATIONS,
  type ActiveModifications,
} from "./modifications-types";
import {
  hypertrophyEffortConfig,
  type EffortPreference,
} from "./effort-preference";

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
  /**
   * ADR 0004 — optional dual-main-lift fields.
   *
   * When `secondaryRole` is set, the prescription assembler emits a
   * second main lift on the same calendar day. The lower-body lift
   * (declared by `role`) is sequenced first; the secondary upper lift
   * runs after, capped at `secondaryMaxSets`. Only `ENDURANCE_ANCHOR`
   * uses these fields in v1; every other archetype's day templates
   * leave them undefined and behave exactly as before.
   *
   * `secondaryMaxSets` slices the front of the archetype's normal
   * `setIntensities` wave so the user still hits a real top set.
   * Per Androulakis-Korakakis 2020 / Spiering 2021, 2–3 sets at the
   * archetype's maintenance band is sufficient to maintain 1RM in the
   * secondary pattern without competing with the endurance recovery
   * budget that justifies the archetype's existence.
   */
  secondaryRole?: StrengthRole;
  secondaryTitle?: string;
  secondaryCandidateSlugs?: string[];
  secondaryMaxSets?: number;
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
  /**
   * Default cardio slug. Always present. When the user's declared tier
   * doesn't match a `movementSlugByExperience` entry below, this is
   * the resolved slug.
   */
  movementSlug: string;
  /**
   * PR W2 — per-tier slug map (Option α from the W2 PR description).
   * When set, the planner picks `movementSlugByExperience[userTier]`
   * at materialization time, falling back to `movementSlug` for tiers
   * absent from the map. Lets archetype templates prescribe VO2 4×4
   * for advanced users while quietly swapping in a tempo run for
   * declared beginners — same archetype, same calendar day, different
   * intensity. Optional so legacy archetype rows stay unchanged.
   */
  movementSlugByExperience?: Partial<Record<0 | 1 | 2 | 3 | 4, string>>;
  cardioKind: Extract<PrescriptionItemKind, `cardio_${string}`>;
  durationMin: number;
  hrCap?: string;
  protocolNote?: string;
  finisher?: {
    movementSlug: string;
    durationMin: number;
    protocolNote: string;
  };
  /**
   * ADR 0038 — cardio mesocycle progression. Optional per-week-peak override for
   * a high-intensity session: on the PEAK week of each loading wave the engine
   * progresses interval density (e.g. VO2 4×4 → 5×4) by swapping in these
   * values. Only the count/density progresses, never volume + intensity at once
   * (research-v2 §4). Absent ⇒ no interval progression for this day (byte-
   * identical). Applied only for cardio-emphasis blocks (see `cardioProgressionPlan`).
   */
  peakWeek?: {
    durationMin?: number;
    protocolNote?: string;
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
  /**
   * ADR 0005 — cap for the secondary-slot set count when
   * `foldDualMainLifts` attaches a secondary at a sub-4-strength-day
   * frequency. Defaults to 3 if absent. Tuned per archetype:
   * ENDURANCE_ANCHOR = 3, CONCURRENT_HYBRID = 3, STRENGTH_ANCHOR = 5,
   * HYPERTROPHY_ANCHOR = 4.
   */
  foldedSecondaryMaxSets?: number;
  /**
   * ADR 0005 — when true, `foldDualMainLifts` is a no-op for this
   * archetype. REBUILD and MAINTENANCE opt out: both are intentionally
   * minimal recovery / sub-maintenance archetypes and adding a folded
   * secondary main lift would contradict their design intent.
   */
  disableFolding?: boolean;
  /**
   * ADR 0007 — when true, the primary movement's final top set on
   * non-deload weeks is emitted as a true AMRAP (open-rep) set: the user is
   * cued to do as many clean reps as possible (RIR ~1, not failure) and the
   * achieved reps feed e1RM → TM. Only archetypes whose primary goal
   * includes maximal strength opt in (STRENGTH_ANCHOR, CONCURRENT_HYBRID,
   * and custom strength waves). HYPERTROPHY_ANCHOR is governed instead by
   * its RIR effort anchor (ADR 0011); endurance / rebuild / maintenance keep
   * fixed top sets to protect the shared recovery budget.
   */
  solicitTopSetAmrap?: boolean;
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

/**
 * Phase 1 deload cadence (ADR 0030). Expand a single 3-week loading wave into
 * `DELOAD_CADENCE_WAVES` waves before the (unchanged, volume-led) deload, so a
 * standard block runs ~6 weeks of accumulation + 1 deload instead of the legacy
 * 3 + 1.
 *
 * Why: the fixed week-4 deload was inherited from the strength-only 3:1 model
 * and is SHORTER than every grounded hybrid-program norm —
 *   - Tactical Barbell (Black): 6-week blocks, "no re-testing of maximums for
 *     at least 6 weeks", submaximal + never-to-failure ("muscle failure is the
 *     enemy") as the PRIMARY fatigue lever so the lifter "rarely feels
 *     over-trained" and can "continue on this path for a lengthy period";
 *   - 5/3/1 Forever (Wendler): deload is the 7th-Week Protocol BETWEEN a Leader
 *     and Anchor phase — "not done every seventh week; it's just a name" — with
 *     "more than two cycles will burn you out" capping accumulation at ~6 weeks;
 *   - empirical surveys: Bell 2022 (~4-6 wk) and Rogerson 2024 (5.6 ± 2.3 wk).
 * This cadence change does NOT alter the deload mechanism itself: the deload
 * week remains a full deload that cuts BOTH intensity (materially lower %TM in
 * its `setIntensities`) AND volume (`strengthVolumeScale` + `z2DurationMinOverride`)
 * — Mujika & Padilla 2003; Bell 2022; Rogerson 2024.
 *
 * Calibration: `DELOAD_CADENCE_WAVES` is a CP-2 [DEF→cal] Stage-A heuristic.
 * Confidence is HIGH that 4 weeks is too short and ~6 is the cross-program
 * norm, MEDIUM on the exact wave count. Per-archetype / load- / experience-
 * gated cadence and an autoregulated trigger are deferred to Phase 2/3 where a
 * live fatigue proxy (GRM + cardio interference scalar) can earn the
 * differentiation. See docs/knowledge/hybrid-training-design-constraints.md.
 *
 * No-op for archetypes without a "Deload" week (e.g. maintenance).
 */
const DELOAD_CADENCE_WAVES = 2; // [DEF→cal] CP-2 — see grounding above

export function expandToTwoWaves(profiles: WeekProfile[]): WeekProfile[] {
  const deloadIdx = profiles.findIndex((p) => p.intensityLabel === "Deload");
  if (deloadIdx < 0) return profiles; // no deload (maintenance) — unchanged
  const build = profiles.filter((_, i) => i !== deloadIdx);
  const deload = profiles[deloadIdx]!;
  const out: WeekProfile[] = [];
  for (let wave = 0; wave < DELOAD_CADENCE_WAVES; wave++) {
    for (const p of build) out.push({ ...p, weekIndex: out.length });
  }
  out.push({ ...deload, weekIndex: out.length });
  return out;
}

/** Apply the Phase 1 cadence: expand the loading waves and re-derive `weeks`. */
function withExpandedCadence(a: Archetype): Archetype {
  const weekProfiles = expandToTwoWaves(a.weekProfiles);
  return { ...a, weekProfiles, weeks: weekProfiles.length };
}

/**
 * Number of BUILD weeks in a single loading wave, after cadence expansion.
 * `expandToTwoWaves` repeats the build block `DELOAD_CADENCE_WAVES` times, so a
 * week's position WITHIN its wave is `weekIndex % buildWeeksPerWave`. Used by any
 * logic that is keyed to a wave position (e.g. the hypertrophy final-set anchor)
 * so it doesn't silently mis-fire on the second wave's higher absolute indices.
 */
export function buildWeeksPerWave(a: Archetype): number {
  const buildCount = a.weekProfiles.filter((p) => p.intensityLabel !== "Deload").length;
  return buildCount > 0 ? Math.max(1, Math.round(buildCount / DELOAD_CADENCE_WAVES)) : 1;
}

export const STRENGTH_ANCHOR: Archetype = withExpandedCadence({
  id: "strength_anchor",
  name: "Strength Focus",
  oneLiner:
    "Strength-led concurrent training. Four main lifts (your choice of variant per role) hit a weekly intensity wave, with a volume-led deload after two waves. Polarized cardio is added when the day budget allows.",
  weeks: 4,
  // ADR 0007 — strength is the primary goal, so the top set is a true AMRAP.
  solicitTopSetAmrap: true,
  // ADR 0006 — bench + OHP demoted to optional so dual-main-lift folding
  // (ADR 0005) triggers at freq < 4. `foldedSecondaryMaxSets` here is now
  // LIVE: at freq=2 the trim returns squat + deadlift anchors and fold
  // attaches OHP onto squat (≤5 sets) + bench onto deadlift (≤5 sets).
  // At freq=4+ all four strength days return and folding is a no-op.
  foldedSecondaryMaxSets: 5,
  accessoryProfile: {
    aesthetic: { itemsPerSession: 2, setsPerItem: 3, repRange: { min: 8, max: 12 }, biasSupported: false },
    functional: { weeklyRoleRequirements: { single_leg: 1 } },
    durability: { extras: [] },
  },
  days: [
    // ADR 0006 — bench (dayIndex 1) and OHP (dayIndex 4) drop from anchor
    // to optional (rank 7/8) so the freq=2/3 trim collapses to squat +
    // deadlift and dual-main-lift folding (ADR 0005) closes the coverage
    // gap. Matches CONCURRENT_HYBRID's convention from ADR 0004.
    STRENGTH_DAYS[0]!, // squat — anchor, rank 1
    { ...STRENGTH_DAYS[1]!, priority: "optional", rank: 7 }, // bench
    STRENGTH_DAYS[2]!, // deadlift — anchor, rank 3
    { ...STRENGTH_DAYS[3]!, priority: "optional", rank: 8 }, // OHP
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
        protocolNote: "6–10 × 10–15s near-max hill sprints, walk back down for recovery (~90–120s)",
      },
      priority: "optional",
      rank: 6,
    },
  ],
  /**
   * Two-a-day variant of Strength Anchor.Same four main lifts in AM slots
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
    // ADR 0006 — bench + OHP optional in the two-a-day variant too, same
    // rationale as the single-session days above.
    { ...STRENGTH_DAYS[1]!, slot: "am", priority: "optional", rank: 7 },
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
        protocolNote: "6–10 × 10–15s near-max hill sprints, walk back down for recovery (~90–120s)",
      },
      priority: "optional",
      rank: 6,
    },
    { ...STRENGTH_DAYS[3]!, slot: "am", priority: "optional", rank: 8 },
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
});

export const ENDURANCE_ANCHOR: Archetype = withExpandedCadence({
  id: "endurance_anchor",
  name: "Endurance Focus",
  oneLiner:
    "Cardio-led concurrent training. Polarized aerobic exposures (long Z2 + VO2 intervals) anchor the week. Two dual-main-lift strength sessions (squat + overhead press, deadlift + bench press — paired for rack-height efficiency) keep all four movement patterns covered without breaking the cardio focus.",
  weeks: 4,
  // ADR 0005 — static ADR 0004 secondaries already cover every strength
  // day, so the skip-if-already-present guard makes folding a no-op here.
  // Cap is set for consistency with the per-archetype calibration.
  foldedSecondaryMaxSets: 3,
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
    // ADR 0004 — dual-main-lift redesign per Huiberts 2024 Sports Med
    // (upper-body strength not impaired by concurrent endurance) and
    // Androulakis-Korakakis 2020 (1 set/wk at >=75% 1RM maintains 1RM).
    // Pair chosen for rack ergonomics: same J-cup height supports both
    // lifts in the superset, no rerack between movements.
    {
      kind: "strength",
      dayIndex: 1,
      role: "squat",
      title: "Squat + Overhead Press",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.squat,
      priority: "anchor",
      rank: 3,
      secondaryRole: "vertical_press",
      secondaryTitle: "Overhead Press",
      secondaryCandidateSlugs: STRENGTH_ROLE_CANDIDATES.vertical_press,
      secondaryMaxSets: 3,
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
        protocolNote: "6–8 × 10–15s near-max efforts, ~100–150s easy spin between reps",
      },
      priority: "optional",
      rank: 5,
    },
    // ADR 0004 — dual-main-lift redesign (see note on the squat+OHP day).
    {
      kind: "strength",
      dayIndex: 3,
      role: "deadlift",
      title: "Deadlift + Bench Press",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.deadlift,
      priority: "anchor",
      rank: 4,
      secondaryRole: "horizontal_press",
      secondaryTitle: "Bench Press",
      secondaryCandidateSlugs: STRENGTH_ROLE_CANDIDATES.horizontal_press,
      secondaryMaxSets: 3,
    },
    {
      kind: "cardio",
      dayIndex: 4,
      role: "vo2_intervals",
      title: "VO2 intervals",
      movementSlug: "run-vo2-4x4",
      // PR W2 — beginner / novice land on easier modalities. Tier 2+
      // gets the prescribed VO2 work; tier 0 gets easy aerobic; tier 1
      // gets a tempo run as a stepping-stone.
      movementSlugByExperience: {
        0: "run-easy-z2",
        1: "run-tempo",
      },
      cardioKind: "cardio_vo2",
      durationMin: 35,
      hrCap: "90–95% HRmax during work",
      protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      // ADR 0038 — peak-week interval-density progression.
      peakWeek: {
        durationMin: 42,
        protocolNote: "5 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      },
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
    // ADR 0004 — dual-main-lift redesign. AM strength block on these days
    // pairs the lower-body main lift with its same-J-cup-height upper
    // counterpart (capped at secondaryMaxSets) for rack ergonomics.
    {
      kind: "strength",
      dayIndex: 1,
      slot: "am",
      role: "squat",
      title: "Squat + Overhead Press",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.squat,
      priority: "anchor",
      rank: 3,
      secondaryRole: "vertical_press",
      secondaryTitle: "Overhead Press",
      secondaryCandidateSlugs: STRENGTH_ROLE_CANDIDATES.vertical_press,
      secondaryMaxSets: 3,
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
        protocolNote: "6–8 × 10–15s near-max efforts, ~100–150s easy spin between reps",
      },
      priority: "optional",
      rank: 5,
    },
    {
      kind: "strength",
      dayIndex: 3,
      slot: "am",
      role: "deadlift",
      title: "Deadlift + Bench Press",
      candidateSlugs: STRENGTH_ROLE_CANDIDATES.deadlift,
      priority: "anchor",
      rank: 4,
      secondaryRole: "horizontal_press",
      secondaryTitle: "Bench Press",
      secondaryCandidateSlugs: STRENGTH_ROLE_CANDIDATES.horizontal_press,
      secondaryMaxSets: 3,
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
      movementSlugByExperience: {
        0: "run-easy-z2",
        1: "run-tempo",
      },
      cardioKind: "cardio_vo2",
      durationMin: 35,
      hrCap: "90–95% HRmax during work",
      protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      // ADR 0038 — peak-week interval-density progression.
      peakWeek: {
        durationMin: 42,
        protocolNote: "5 × 4 min @ 90–95% HRmax, 3 min easy recovery",
      },
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
    { weekIndex: 1, setIntensities: [0.78, 0.85, 0.90], setReps: [5, 3, 3], intensityLabel: "Maintenance build" },
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
});

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
export const REBUILD: Archetype = withExpandedCadence({
  id: "rebuild",
  name: "Rebuild",
  oneLiner:
    "Return-to-training block for after an injury, layoff, or extended deload. Capped intensity (top set ≤80% TM), heavy slow resistance tendon work twice a week, easy Z2 for aerobic floor. Designed to load tissue safely, not to progress.",
  weeks: 4,
  // ADR 0005 — Rebuild's whole point is a sub-strength-driving load with
  // tendon-day anchors carrying the recovery budget; an extra folded main
  // lift would contradict the archetype's design intent.
  disableFolding: true,
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
});

/**
 * Hypertrophy Anchor — muscle-building block.
 *
 * Same four main patterns as Strength Anchor, but tuned for hypertrophy:
 * - Lower per-set intensity (60–75% TM, so 54–67% of true 1RM at TM 90%)
 * - Higher rep counts (6–10 reps per set)
 * - More working sets per pattern (4 sets vs Strength Anchor's 3)
 * - Two-wave block with a mild deload
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
export const HYPERTROPHY_ANCHOR: Archetype = withExpandedCadence({
  id: "hypertrophy_anchor",
  name: "Hypertrophy Focus",
  oneLiner:
    "Muscle-building block. Same four main patterns as Strength Focus but at hypertrophy intensity (60–75% TM, 6–12 reps, final set taken close to failure, 4 working sets per pattern). One optional easy Z2 day preserves the aerobic floor. Curated accessory pool added per main lift — flies, lateral raises, biceps, calves — covering per-muscle volume gaps.",
  weeks: 4,
  accessoriesByDefault: true,
  // ADR 0006 — bench + OHP demoted to optional so dual-main-lift folding
  // (ADR 0005) triggers at freq < 4. `foldedSecondaryMaxSets` here is now
  // LIVE: at freq=2 the trim returns squat + deadlift anchors and fold
  // attaches OHP onto squat (≤4 sets) + bench onto deadlift (≤4 sets).
  // Cap honours the archetype's per-set volume identity in the 60-75% TM
  // band; at freq=4+ all four strength days return and folding is a no-op.
  foldedSecondaryMaxSets: 4,
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
      // ADR 0006 — optional so freq=2/3 trim collapses to squat + deadlift
      // and folding (ADR 0005) attaches bench onto deadlift.
      priority: "optional",
      rank: 7,
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
      // ADR 0006 — optional so freq=2/3 trim collapses to squat + deadlift
      // and folding (ADR 0005) attaches OHP onto squat.
      priority: "optional",
      rank: 8,
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
      // ADR 0006 — optional in the two-a-day variant too, same rationale
      // as the single-session days.
      priority: "optional",
      rank: 7,
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
      // ADR 0006 — optional in the two-a-day variant too.
      priority: "optional",
      rank: 8,
    },
  ],
  // Hypertrophy wave: 4 working sets each week, building reps then trading
  // reps for load before deloading. Intensities sit firmly in the 60–75% TM
  // band (~54–67% of 1RM at TM 90%). On non-deload weeks the final working
  // set is effort-anchored (RIR 1–2) so the compound actually reaches the
  // hypertrophy stimulus window; earlier sets accumulate volume.
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
});

/**
 * Concurrent / Hybrid Focus — **the live engine config for the native Hybrid
 * program** (`lib/programs/hybrid/engine.ts` resolves itself through
 * `ARCHETYPES["concurrent_hybrid"]` via the `HYBRID_ARCHETYPE` constant). This
 * is NOT a legacy archetype: it is load-bearing for the current app and is
 * guarded by the Hybrid golden parity tests. Edit with the same care as live
 * engine code. (The other five entries in `ARCHETYPES` are legacy-only — see the
 * registry comment below.)
 *
 * Balanced concurrent program: 4 strength days (same patterns as Strength
 * Focus) at moderate intensity + 2 substantive cardio sessions per week
 * with polarized distribution (~80% easy Z2, ~20% high-intensity VO2 /
 * threshold). Top set capped at 85% TM so cardio adaptation isn't
 * compromised by neural drain — per Wilson 2012 (HIGH meta) the
 * compatibility window favours intensity below max-strength territory.
 */
export const CONCURRENT_HYBRID: Archetype = withExpandedCadence({
  id: "concurrent_hybrid",
  name: "Hybrid Focus",
  oneLiner:
    "Balanced strength + cardio. Four main lifts at moderate intensity (top set ≤ 85% TM) protect cardio adaptation, and two substantive aerobic sessions — one polarized Z2, one VO2 / threshold — keep both engines running.",
  weeks: 4,
  // ADR 0007 — the hybrid block genuinely builds strength, so its top set is
  // a true AMRAP (cued RIR ~1, not failure, to protect the cardio budget).
  solicitTopSetAmrap: true,
  // ADR 0005 — at freq=2 the trim returns squat + deadlift anchors only,
  // leaving horizontal_press + vertical_press uncovered. Folding closes
  // that gap at the ADR 0004 maintenance-dose cap of 3 secondary sets.
  foldedSecondaryMaxSets: 3,
  accessoryProfile: {
    aesthetic: { itemsPerSession: 2, setsPerItem: 3, repRange: { min: 10, max: 15 }, biasSupported: true },
    functional: { weeklyRoleRequirements: { single_leg: 1, anti_rotation: 1 } },
    durability: { extras: [] },
  },
  days: [
    // ADR 0004 — bench (dayIndex 1) and OHP (dayIndex 4) drop from
    // anchor to optional so the freq=2 trim collapses to the two
    // hardest-to-redistribute compounds (squat + deadlift). The Z2
    // cardio day stays as an anchor — concurrent + balanced is the
    // archetype's identity, so freq=2 must still ship at least one
    // aerobic exposure. VO2 stays optional and folds in at freq>=4.
    // At freq=6 the four main lifts + both cardio sessions all fit.
    STRENGTH_DAYS[0]!, // squat — anchor, rank 1
    { ...STRENGTH_DAYS[1]!, priority: "optional", rank: 7 }, // bench
    STRENGTH_DAYS[2]!, // deadlift — anchor, rank 3
    { ...STRENGTH_DAYS[3]!, priority: "optional", rank: 8 }, // OHP
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
      rank: 2,
    },
    {
      kind: "cardio",
      dayIndex: 5,
      role: "vo2",
      title: "VO2 intervals",
      movementSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      durationMin: 45,
      protocolNote: "4 × 4 min hard @ 90–95% HRmax, with 3 min easy recovery between intervals",
      priority: "optional",
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
      priority: "optional",
      rank: 5,
    },
    // ADR 0004 — bench + OHP optional in the two-a-day variant too, same
    // rationale as the single-session days above.
    { ...STRENGTH_DAYS[1]!, slot: "am", priority: "optional", rank: 7 },
    { ...STRENGTH_DAYS[2]!, slot: "am" },
    {
      kind: "cardio",
      dayIndex: 3,
      slot: "pm",
      role: "vo2",
      title: "VO2 intervals",
      movementSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      durationMin: 45,
      protocolNote: "4 × 4 min hard @ 90–95% HRmax, with 3 min easy recovery between intervals",
      priority: "optional",
      rank: 6,
    },
    { ...STRENGTH_DAYS[3]!, slot: "am", priority: "optional", rank: 8 },
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
});

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
    "Two-week keep-the-lights-on block for travel, illness, or busy stretches. Two short strength days (60–65% TM, 2 working sets per lift — deliberately sub-maintenance) and two short Z2 sessions hold the line on strength and aerobic base without spending recovery on adaptation.",
  weeks: 2,
  // ADR 0005 — Maintenance explicitly runs at sub-maintenance volume; a
  // folded secondary main lift would convert it into a normal training
  // block. Opt out.
  disableFolding: true,
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

/**
 * Archetype registry. "custom" is not here — custom blocks are built ad-hoc.
 *
 * IMPORTANT — load-bearing vs legacy (ADR 0046 de-archetype):
 *   • `concurrent_hybrid` is LIVE. It is the engine config the native **Hybrid**
 *     program resolves through (`lib/programs/hybrid/engine.ts`). It cannot be
 *     removed and is guarded by the Hybrid golden parity tests.
 *   • The other five (`strength_anchor`, `endurance_anchor`, `rebuild`,
 *     `hypertrophy_anchor`, `maintenance`) are LEGACY-ONLY. New blocks store
 *     `archetype = NULL` (identity lives in `program_id`/`program_family`), so
 *     these are reached only by pre-pivot archetype blocks and by graceful
 *     fallbacks (display labels via `archetypeDisplayName`, the off-plan
 *     quick-generate `strength_anchor` default). They are retained — not dead —
 *     until those legacy reads are removed; see ADR 0046 Phase 4. Do NOT assume
 *     they are unused.
 */
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
    if (d.kind === "strength") {
      set.add(d.role);
      // ADR 0004 — dual-main-lift days contribute a second role too.
      if (d.secondaryRole) set.add(d.secondaryRole);
    }
  }
  return Array.from(set);
}

/** Union of all candidate slugs across all strength days (both single + two-a-day variants). */
export function allCandidateLiftSlugs(archetype: Archetype): string[] {
  const set = new Set<string>();
  const pool: DayTemplate[] = [...archetype.days, ...(archetype.twoADayDays ?? [])];
  for (const d of pool) {
    if (d.kind === "strength") {
      d.candidateSlugs.forEach((s) => set.add(s));
      // ADR 0004 — dual-main-lift days advertise a second pattern too.
      d.secondaryCandidateSlugs?.forEach((s) => set.add(s));
    }
  }
  return Array.from(set);
}

// ADR 0037 — coherent multi-modal deload. On the deload week the maximal VO2
// session is downgraded to a sub-maximal touch and the alactic finisher is
// dropped, so the recovery week reduces INTENSITY (5/3/1 "7th Week Protocol":
// "use less intensive movements"; Tactical Barbell strength blocks) — not merely
// volume. Substitutes are existing seeded running movements; the rendered
// cardioKind is overridden so the UI label matches the downgraded effort.
export const DELOAD_VO2_TO_Z2_SLUG = "run-easy-z2";
export const DELOAD_VO2_TO_THRESHOLD_SLUG = "run-threshold";
// CP-1 heuristics — keep at most ONE quality touch, and only for the cohort that
// actually earns the real VO2 work, so a deload is never HARDER than a loading
// week (a lower-tier user's VO2 day already resolves down to easy Z2 / tempo).
export const DELOAD_THRESHOLD_MIN_FREQ = 5;
export const DELOAD_THRESHOLD_MIN_TIER = 2;

export type DeloadCardioPlan = {
  /** When set, swap the resolved cardio movement to this slug. */
  slugOverride?: string;
  /** When set, render the day as this cardioKind (drives label + classification). */
  cardioKindOverride?: CardioDay["cardioKind"];
  /** Drop the alactic finisher on this day. */
  dropFinisher: boolean;
};

/**
 * ADR 0037 — how the deload week rewrites a cardio day. Pure (no I/O, no
 * catalog). Returns `null` on every non-deload week — so loading weeks stay
 * byte-identical — and on deload cardio days that need no change.
 *
 *   - `cardio_vo2` day → downgrade to easy Z2, or to ONE threshold touch when the
 *     block runs `weeklyFrequency >= DELOAD_THRESHOLD_MIN_FREQ` AND the user tier
 *     earns the real VO2 work (`>= DELOAD_THRESHOLD_MIN_TIER`).
 *   - any day carrying a `finisher` → drop the alactic finisher.
 */
export function deloadCardioPlan(
  day: CardioDay,
  profile: WeekProfile | undefined,
  weeklyFrequency: number,
  userTier: number | null,
): DeloadCardioPlan | null {
  if (profile?.intensityLabel !== "Deload") return null;
  const dropFinisher = day.finisher != null;
  if (day.cardioKind === "cardio_vo2") {
    const keepThreshold =
      weeklyFrequency >= DELOAD_THRESHOLD_MIN_FREQ &&
      (userTier ?? 0) >= DELOAD_THRESHOLD_MIN_TIER;
    return {
      slugOverride: keepThreshold
        ? DELOAD_VO2_TO_THRESHOLD_SLUG
        : DELOAD_VO2_TO_Z2_SLUG,
      cardioKindOverride: keepThreshold ? "cardio_threshold" : "cardio_z2",
      dropFinisher,
    };
  }
  return dropFinisher ? { dropFinisher: true } : null;
}

export function requiredCardioSlugs(archetype: Archetype): string[] {
  const set = new Set<string>();
  const pool: DayTemplate[] = [...archetype.days, ...(archetype.twoADayDays ?? [])];
  let hasVo2 = false;
  for (const d of pool) {
    if (d.kind === "cardio") {
      set.add(d.movementSlug);
      if (d.cardioKind === "cardio_vo2") hasVo2 = true;
      // PR W2 — preload every per-tier alternate so the catalog
      // lookup in `actions.ts` picks them up. The tier-aware
      // resolution happens at materialization time, but the slug
      // pool needs to know about every potential pick upfront.
      if (d.movementSlugByExperience) {
        for (const alt of Object.values(d.movementSlugByExperience)) {
          if (alt) set.add(alt);
        }
      }
      if (d.finisher) set.add(d.finisher.movementSlug);
    }
  }
  // ADR 0037 — the deload week downgrades a maximal VO2 day to a sub-maximal
  // touch (easy Z2, or one threshold session at high frequency). Preload both
  // substitute slugs so the materialization-time catalog lookup never misses.
  if (hasVo2 && archetype.weekProfiles.some((w) => w.intensityLabel === "Deload")) {
    set.add(DELOAD_VO2_TO_Z2_SLUG);
    set.add(DELOAD_VO2_TO_THRESHOLD_SLUG);
  }
  return Array.from(set);
}

/**
 * ADR 0038 — cardio mesocycle progression.
 *
 * The engine's own spec (research-v2 §4, engine-biased block) prescribes:
 * "Aerobic: add easy volume first (~5–10%/week), then add quality to hard
 * sessions. Threshold/VO₂max: progress interval count or density — not both.
 * Strength: hold." The strength-hold half is already implemented (TB/5-3-1
 * static wave); this adds the missing aerobic half: a weekly EASY-VOLUME creep
 * on Z2 days plus a peak-week VO₂ interval-density bump, both scaled to how
 * cardio-dominant the block is.
 *
 * `cardioProgressionTier` derives the emphasis from the archetype + secondary
 * focus; `CARDIO_CREEP_PARAMS` sets the per-tier creep rate, cap, and breadth.
 * `cardioWaveContext` finds the week's position within its loading wave (the
 * cadence concatenates waves with no mid-deload, so waves are detected from the
 * repeating intensity-label pattern, not deload separators). All pure; a no-op
 * on the deload week, on non-cardio days, and on archetypes whose tier is
 * "none" — so every existing block stays byte-identical.
 */
export type CardioProgressionTier = "pure" | "mixed" | "balanced" | "endurance_biased" | "none";

export function cardioProgressionTier(
  archetypeId: ArchetypeId,
  secondaryFocus: string | null,
  seasonBias: "strength" | "endurance" | null = null,
): CardioProgressionTier {
  if (archetypeId === "endurance_anchor") {
    // Cardio is the primary goal. A strength/muscle SECONDARY tempers the creep
    // (protect recovery for the strength work); none/cardio secondary is a pure
    // cardio build.
    return secondaryFocus === "strength" || secondaryFocus === "muscle"
      ? "mixed"
      : "pure";
  }
  if (archetypeId === "concurrent_hybrid") {
    // ADR 0052 — an `endurance_bias` Season block raises the easy-volume creep
    // to the `endurance_biased` tier (creeps the Z2 day, which the default
    // `balanced` tier does NOT, since balanced only creeps a "long" driver and
    // Hybrid ships an `easy_z2` day). strength/null bias keeps the
    // byte-identical "balanced".
    return seasonBias === "endurance" ? "endurance_biased" : "balanced";
  }
  // Strength-led or non-cardio archetypes: cardio is maintenance, not a build.
  return "none";
}

interface CardioCreepParams {
  /** Easy-volume increase per wave-step (fraction). CP-1 heuristic. */
  creepPerWeek: number;
  /** Hard ceiling on cumulative creep within a wave (fraction). */
  cap: number;
  /** Pure cardio creeps ALL easy Z2 days; otherwise only the long Z2 driver. */
  includeShortEasy: boolean;
}

// CP-1 [DEF→cal] — grounded in the 5–10%/week aerobic-volume rule (research-v2
// §4); magnitude + breadth scale with cardio dominance to keep interference in
// check on concurrent blocks. Un-tuned against real outcome data.
const CARDIO_CREEP_PARAMS: Record<
  Exclude<CardioProgressionTier, "none">,
  CardioCreepParams
> = {
  pure: { creepPerWeek: 0.1, cap: 0.2, includeShortEasy: true },
  mixed: { creepPerWeek: 0.05, cap: 0.15, includeShortEasy: false },
  balanced: { creepPerWeek: 0.05, cap: 0.1, includeShortEasy: false },
  // ADR 0052 — endurance-biased concurrent block: creeps the easy Z2 day
  // (includeShortEasy) at a modest rate, between balanced and pure. CP-1
  // heuristic, within the 5–10%/wk aerobic-volume band (research-v2 §4); un-tuned.
  endurance_biased: { creepPerWeek: 0.07, cap: 0.15, includeShortEasy: true },
};

export interface CardioWaveContext {
  /** 0-based position of this build week within its loading wave (0 = base). */
  positionInWave: number;
  /** True when this is the last build week of its wave (the peak week). */
  isPeakWeek: boolean;
  /** True on a deload week (progression never applies). */
  isDeload: boolean;
}

export function cardioWaveContext(
  profiles: WeekProfile[],
  weekIndex: number,
): CardioWaveContext {
  const sorted = [...profiles].sort((a, b) => a.weekIndex - b.weekIndex);
  const idx = sorted.findIndex((p) => p.weekIndex === weekIndex);
  if (idx < 0) return { positionInWave: 0, isPeakWeek: false, isDeload: false };
  if (sorted[idx]!.intensityLabel === "Deload") {
    return { positionInWave: 0, isPeakWeek: false, isDeload: true };
  }
  // Build weeks only (deloads separate nothing here — the cadence concatenates
  // waves — so a wave boundary is where the FIRST build label repeats).
  const build = sorted.filter((p) => p.intensityLabel !== "Deload");
  const bIdx = build.findIndex((p) => p.weekIndex === weekIndex);
  const firstLabel = build[0]!.intensityLabel;
  // Walk back to the wave start: the most recent week whose label === firstLabel.
  let start = bIdx;
  while (start > 0 && build[start]!.intensityLabel !== firstLabel) start--;
  // Walk forward to the wave end: last week before the next firstLabel repeat.
  let end = bIdx;
  while (
    end < build.length - 1 &&
    build[end + 1]!.intensityLabel !== firstLabel
  ) {
    end++;
  }
  return {
    positionInWave: bIdx - start,
    isPeakWeek: bIdx === end,
    isDeload: false,
  };
}

export interface CardioProgressionPlan {
  /** Overrides the cardio day's rendered duration (easy creep or VO₂ bump). */
  durationMinOverride?: number;
  /** Overrides the protocol note (VO₂ peak-week density bump). */
  protocolNoteOverride?: string;
}

/**
 * Compute the ADR 0038 progression for one cardio day on one week. Returns
 * `null` when nothing changes (deload week, tier "none", non-progressing day,
 * or the base week of a wave) — so the caller leaves the day untouched.
 */
export function cardioProgressionPlan(args: {
  day: CardioDay;
  archetype: Archetype;
  weekIndex: number;
  secondaryFocus: string | null;
  seasonBias?: "strength" | "endurance" | null;
}): CardioProgressionPlan | null {
  const { day, archetype, weekIndex, secondaryFocus, seasonBias = null } = args;
  const tier = cardioProgressionTier(archetype.id, secondaryFocus, seasonBias);
  if (tier === "none") return null;
  const ctx = cardioWaveContext(archetype.weekProfiles, weekIndex);
  if (ctx.isDeload) return null; // deload handled by ADR 0037 / z2 override
  const params = CARDIO_CREEP_PARAMS[tier];

  // VO₂ interval-density bump on the peak week (count, not intensity). Gated on
  // an explicit `peakWeek` config so it only fires where the archetype opts in.
  if (day.cardioKind === "cardio_vo2" && ctx.isPeakWeek && day.peakWeek) {
    return {
      durationMinOverride: day.peakWeek.durationMin ?? day.durationMin,
      protocolNoteOverride: day.peakWeek.protocolNote,
    };
  }

  // Easy-volume creep on Z2 days. Pure cardio creeps every easy Z2 session;
  // mixed/balanced creep only the long Z2 driver (role contains "long").
  if (day.cardioKind === "cardio_z2" && day.durationMin != null) {
    const isLong = (day.role ?? "").includes("long");
    const eligible = params.includeShortEasy || isLong;
    if (eligible && ctx.positionInWave > 0) {
      const mult =
        1 + Math.min(params.creepPerWeek * ctx.positionInWave, params.cap);
      return { durationMinOverride: Math.round(day.durationMin * mult) };
    }
  }
  return null;
}

/**
 * PR W2 — resolve the cardio slug for the user's declared tier. When
 * the template carries a `movementSlugByExperience` map, returns the
 * tier-specific slug if present; otherwise falls back to the default
 * `movementSlug`. `null` tier → default slug (legacy behaviour).
 *
 * Pure function (no I/O). The catalog row for the resolved slug is
 * looked up by the caller via `movementBySlug`.
 */
export function resolveCardioSlugForTier(
  day: CardioDay,
  tier: number | null,
): string {
  if (tier != null && day.movementSlugByExperience) {
    const t = tier as 0 | 1 | 2 | 3 | 4;
    const alt = day.movementSlugByExperience[t];
    if (alt) return alt;
  }
  return day.movementSlug;
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

/**
 * ADR 0011 + 0015 — effort-anchor the hypertrophy compound.
 *
 * Rationale (see docs/adr/0011-… and 0015-…): the printed reps on
 * HYPERTROPHY_ANCHOR compounds sit 6–10 RIR shy of failure at the prescribed
 * loads, so the compound delivers little hypertrophy stimulus.
 *   - ADR 0011: the LAST set is RIR-anchored (cue + raised rep target) at
 *     unchanged load — the working set reaches the effective-rep window.
 *   - ADR 0015: the EARLIER sets get a bounded rep bump + an honest
 *     submaximal cue (no precise RIR label — see HYPERTROPHY_EARLY_SET),
 *     nudging them out of junk-volume territory without exploding volume.
 * Deload week is excluded; folded secondary slots are untouched.
 *
 * Pure: returns a new array, never mutates inputs.
 */
// heuristic — hypertrophy compound effort anchor (CP-1), per Schoenfeld 2021 / Helms 2018
const HYPERTROPHY_FINAL_SET_BY_WEEK: Record<
  number,
  { reps: number; targetRir: { min: number; max: number }; cue: string }
> = {
  0: {
    reps: 12,
    targetRir: { min: 2, max: 2 },
    cue: "Last set: take it close to failure — leave about 2 reps in reserve.",
  },
  1: {
    reps: 10,
    targetRir: { min: 2, max: 2 },
    cue: "Last set: take it close to failure — leave about 2 reps in reserve.",
  },
  2: {
    reps: 8,
    targetRir: { min: 1, max: 1 },
    cue: "Last set: take it close to failure — leave about 1 rep in reserve.",
  },
};

// heuristic — hypertrophy compound EARLY-set effort bump (CP-1), per
// Schoenfeld 2021 / Refalo 2023. See ADR 0015 (default magnitude) and
// ADR 0016 (the low/standard/high dial). The early (non-final) compound
// sets sat at ~RIR 6–10 (junk-volume territory). The `standard` dial nudges
// them toward a challenging-but-submaximal effort with a bounded rep bump +
// an honest cue, NOT a literal RIR target: at 54–67% 1RM, true RIR 3–4
// inverts (Helms/Zourdos RPE chart, one-rm.ts) to ~12–15 reps/set — a volume
// explosion inappropriate for a concurrent block, so the bump is capped at
// the e1RM model's validity ceiling. The `high` dial opts into the larger
// bump; `low` skips it. Magnitudes live in effort-preference.ts.

/** ADR 0011 final-set RIR cue — regenerated from the (dial-adjusted) RIR so
 * the displayed reserve always matches the prescribed target. Reproduces the
 * shipped `standard` strings exactly (RIR 2 → "about 2 reps"; RIR 1 →
 * "about 1 rep"). */
function hypertrophyFinalSetCue(rir: number): string {
  const reserve = rir === 1 ? "1 rep" : `${rir} reps`;
  return `Last set: take it close to failure — leave about ${reserve} in reserve.`;
}

function applyHypertrophyEffortAnchor(
  items: PrescriptionItem[],
  archetype: Archetype,
  profile: WeekProfile,
  effortPreference: EffortPreference = "standard",
): PrescriptionItem[] {
  if (archetype.id !== "hypertrophy_anchor") return items;
  if (items.length === 0) return items;
  const cfg = hypertrophyEffortConfig(effortPreference);
  const isDeload = profile.intensityLabel === "Deload";
  const lastIdx = items.length - 1;
  const last = items[lastIdx]!;
  // Final compound set (ADR 0011): RIR-anchored on non-deload weeks. The dial
  // (ADR 0016) shifts the RIR by `finalRirDelta`, floored at 1 so we never
  // prescribe training to failure on a concurrent-block compound. Always
  // isAmrap:false so the renderer shows the RIR chip (not a "+") and the AMRAP
  // detect/bump path leaves the high-rep set alone (ADR 0007 Decision 6).
  //
  // Wave-position lookup (bug fix): cadence expansion repeats the 3 build weeks
  // into a second wave at weekIndex 3,4,5. The anchor table is keyed 0,1,2, so a
  // raw `weekIndex` lookup left the ENTIRE second wave un-anchored. Map the
  // absolute index back to its position within the wave.
  const wavePos = profile.weekIndex % buildWeeksPerWave(archetype);
  const baseSpec = isDeload
    ? undefined
    : HYPERTROPHY_FINAL_SET_BY_WEEK[wavePos];
  let anchoredLast: PrescriptionItem;
  if (baseSpec) {
    const rir = Math.max(1, baseSpec.targetRir.max + cfg.finalRirDelta);
    anchoredLast = {
      ...last,
      reps: baseSpec.reps,
      targetRir: { min: rir, max: rir },
      intensityCue: hypertrophyFinalSetCue(rir),
      isAmrap: false,
    };
  } else {
    anchoredLast = { ...last, isAmrap: false };
  }
  // Early compound sets (ADR 0015 / 0016): on non-deload weeks, nudge effort
  // out of junk-volume territory (~RIR 6–10) with a bounded rep bump + an
  // honest submaximal cue. Deliberately NO targetRir — at hypertrophy loads a
  // precise RIR-3-4 label would overstate the effort. When `earlyRepBonus`
  // is 0 (the `low` dial) the early sets are returned untouched.
  const earlySets = items.slice(0, lastIdx).map((item): PrescriptionItem =>
    isDeload || cfg.earlyRepBonus === 0
      ? item
      : {
          ...item,
          reps: Math.min(
            cfg.earlyRepCap,
            (item.reps ?? cfg.earlyRepCap) + cfg.earlyRepBonus,
          ),
          intensityCue: cfg.earlyCue,
        },
  );
  return [...earlySets, anchoredLast];
}

/**
 * ADR 0007 — mark the primary movement's final top set as a true AMRAP
 * (open-rep) set on the archetypes that solicit it (strength / hybrid +
 * custom strength waves). HYPERTROPHY_ANCHOR is excluded here — its last set
 * is RIR-anchored by applyHypertrophyEffortAnchor (ADR 0011). Non-soliciting
 * strength archetypes (endurance / rebuild / maintenance) and deload weeks
 * get an explicit isAmrap:false so the renderer shows a fixed top set, not a
 * "+", and the bump / reactive-deload path does not key off them.
 *
 * Pure: returns a new array, never mutates inputs.
 */
const AMRAP_TOP_SET_CUE =
  "As many clean reps as possible — stop ~1 in reserve, not to failure.";

function applyTopSetAmrapMarker(
  items: PrescriptionItem[],
  archetype: Archetype,
  profile: WeekProfile,
): PrescriptionItem[] {
  if (archetype.id === "hypertrophy_anchor") return items;
  if (items.length === 0) return items;
  const solicited =
    archetype.solicitTopSetAmrap === true && profile.intensityLabel !== "Deload";
  const lastIdx = items.length - 1;
  const last = items[lastIdx]!;
  const marked: PrescriptionItem = solicited
    ? { ...last, isAmrap: true, intensityCue: AMRAP_TOP_SET_CUE }
    : { ...last, isAmrap: false };
  return [...items.slice(0, lastIdx), marked];
}

export function buildPrescription(
  archetype: Archetype,
  weekIndex: number,
  day: DayTemplate,
  movement: { id: string; slug: string; displayName: string },
  finisherMovement?: { id: string; slug: string; displayName: string },
  /**
   * ADR 0004 — when supplied alongside a strength `day` that declares
   * `secondaryRole` + `secondaryMaxSets`, the assembler appends up to
   * `secondaryMaxSets` additional `kind: "main"` items for this second
   * movement, drawn from the front of the wave so the user still hits
   * a real top set. Ignored for non-strength days and for strength days
   * without dual-main-lift fields configured.
   */
  secondaryMovement?: { id: string; slug: string; displayName: string },
  /**
   * Optional active prescription modifications for this user+date.
   * Computed by the caller via `getActiveModifications` so this pure
   * function stays sync. When omitted (default `NO_ACTIVE_MODIFICATIONS`)
   * the output is bit-for-bit identical to pre-§7 behaviour — every
   * existing call site keeps its current contract.
   */
  activeModifications: ActiveModifications = NO_ACTIVE_MODIFICATIONS,
  /**
   * ADR 0016 — user effort/volume dial (`profiles.effort_preference`).
   * Scales the hypertrophy compound effort anchor (early-set bump + final-set
   * RIR). `"standard"` (the default) keeps every existing call site
   * byte-identical; the param is a no-op for all non-hypertrophy archetypes.
   */
  effortPreference: EffortPreference = "standard",
): PrescriptionItem[] {
  const profile = archetype.weekProfiles.find((w) => w.weekIndex === weekIndex);
  if (!profile) return [];

  // Apply active taper / recovery modifications as the very last step
  // before returning. Centralised so we don't sprinkle scaling into
  // the strength / tendon / cardio branches and risk drift.
  const finalize = (items: PrescriptionItem[]): PrescriptionItem[] =>
    applyModificationsToItems(items, activeModifications);

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
    // Deload volume trim. A reduced-volume week carries `strengthVolumeScale < 1`,
    // which drops the set count (e.g. 3 → 2). On the DELOAD week specifically,
    // KEEP THE HEAVIEST sets (slice from the end) rather than the lightest: the
    // last set carries the "top set" marker (above), and a deload that retains a
    // moderate top touch (e.g. 60/70% instead of 50/60%) preserves bar-speed /
    // neuromuscular calibration into the next block — a volume deload, not an
    // intensity deload. Non-deload reduced-volume weeks (e.g. the maintenance
    // archetype, which carries a permanent `strengthVolumeScale` without a
    // "Deload" label) keep the original front-slice so their deliberately-tuned
    // intensity ladder stays byte-identical.
    const deloadWeek = profile.intensityLabel === "Deload";
    const scaledPrimary =
      profile.strengthVolumeScale != null && profile.strengthVolumeScale < 1
        ? (() => {
            const keep = Math.max(
              1,
              Math.round(items.length * profile.strengthVolumeScale),
            );
            return deloadWeek
              ? items.slice(items.length - keep)
              : items.slice(0, keep);
          })()
        : items;
    // ADR 0011 — effort-anchor the last working set on HYPERTROPHY_ANCHOR
    // non-deload weeks. Applied BEFORE finalize() so taper/recovery
    // modifications still scale the anchored item normally.
    const anchoredPrimary = applyHypertrophyEffortAnchor(scaledPrimary, archetype, profile, effortPreference);
    // ADR 0007 — solicit a true AMRAP on the primary top set for archetypes
    // whose primary goal is strength (and a fixed-set marker otherwise).
    const primaryItems = applyTopSetAmrapMarker(anchoredPrimary, archetype, profile);

    // ADR 0004 — dual-main-lift secondary slot.
    // The secondary movement reuses the wave's intensity ladder but is
    // capped at `secondaryMaxSets` items (typically 2–3). Per
    // Androulakis-Korakakis 2020 / Spiering 2021, this is enough to
    // maintain 1RM in the secondary pattern without competing with
    // the archetype's recovery budget. The deload's volume scale also
    // applies to the secondary so a deload week stays a deload week.
    if (
      day.secondaryRole &&
      day.secondaryMaxSets != null &&
      day.secondaryMaxSets > 0 &&
      secondaryMovement
    ) {
      const secondaryAll: PrescriptionItem[] = profile.setIntensities.map((pct, i) => {
        const reps = Array.isArray(profile.setReps) ? profile.setReps[i] ?? 5 : profile.setReps;
        return {
          movementId: secondaryMovement.id,
          movementSlug: secondaryMovement.slug,
          movementName: secondaryMovement.displayName,
          kind: "main",
          sets: 1,
          reps,
          percentTm: Math.round(pct * 100),
          intensityLabel: `${Math.round(pct * 100)}% TM`,
          notes: i === profile.setIntensities.length - 1 ? "top set" : undefined,
        };
      });
      const scaledSecondary =
        profile.strengthVolumeScale != null && profile.strengthVolumeScale < 1;
      const cap = scaledSecondary
        ? Math.max(1, Math.round(day.secondaryMaxSets * profile.strengthVolumeScale!))
        : day.secondaryMaxSets;
      const keepN = Math.min(cap, secondaryAll.length);
      // On the DELOAD week, keep the heaviest sets (mirror the primary: retain
      // the top touch for calibration). Every other week — including non-deload
      // reduced-volume weeks like the maintenance archetype — keeps the existing
      // front-slice so established prescriptions stay byte-identical.
      const secondaryCapped = (scaledSecondary && deloadWeek)
        ? secondaryAll.slice(secondaryAll.length - keepN)
        : secondaryAll.slice(0, keepN);
      return finalize([...primaryItems, ...secondaryCapped]);
    }
    return finalize(primaryItems);
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
      isDeload,
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
    return finalize(items);
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
  return finalize(items);
}

/**
 * Apply an active taper / recovery modification to a freshly built
 * prescription. Pure: no DB, no time. Caller resolves the active
 * modifications via `getActiveModifications` and threads them in.
 *
 * Strength + tendon items: scaled by `strengthLoadScale`. A scale of
 * 0 drops them entirely; a fractional scale shrinks the set count
 * proportionally (matching the deload pattern in `strengthVolumeScale`
 * a few lines above). The taper "minimal" intensity action additionally
 * caps `reps` at 50% — keep weight, fewer reps — per Bosquet 2007.
 *
 * Cardio items: `durationMin` is multiplied by `cardioLoadScale`. A
 * 0 scale rounds up to 1 min so the user still sees the slot but
 * understands "rest / activation only".
 *
 * Recovery wins over taper inside `getActiveModifications`, so by the
 * time we get here `source` is unambiguous.
 */
export function applyModificationsToItems(
  items: PrescriptionItem[],
  mods: ActiveModifications,
): PrescriptionItem[] {
  if (mods.source === null) return items;

  const out: PrescriptionItem[] = [];
  const strengthBuckets = new Map<string, PrescriptionItem[]>();
  for (const item of items) {
    if (item.kind === "main" || item.kind === "tendon") {
      // Bucket = one prescribed BLOCK, whose length is its set count; the taper
      // keeps a proportion of it. The key must therefore identify the block,
      // not just the movement: a mid-workout swap can leave two independent
      // blocks carrying the same `movementId` (deadlift swapped to hip thrust
      // on a day that already mains hip thrust), and a plain `movementId` key
      // merges them into one bucket — `round(2 × 0.5) = 1` keeps ONE item where
      // two unmerged buckets keep one each. That silently deleted a lift.
      // `movementIdentityKey` keeps swapped blocks distinct (`swap:<orig>><new>`)
      // and is identical to `movementId` for every unswapped item, so untouched
      // prescriptions bucket exactly as before. Single home for the rule: plan §6.9.
      const k = `${item.kind}::${movementIdentityKey(item)}`;
      const arr = strengthBuckets.get(k) ?? [];
      arr.push(item);
      strengthBuckets.set(k, arr);
    } else if (item.kind.startsWith("cardio_")) {
      // Cardio scaling: applied per-item.
      if (mods.cardioLoadScale >= 1) {
        out.push(item);
      } else if (mods.cardioLoadScale <= 0) {
        // Drop cardio entirely on a hard zero.
        continue;
      } else {
        const scaled =
          item.durationMin != null
            ? Math.max(1, Math.round(item.durationMin * mods.cardioLoadScale))
            : item.durationMin;
        out.push({ ...item, durationMin: scaled });
      }
    } else {
      // Accessories and other kinds pass through unmodified — accessories
      // were never under the taper / recovery scope per the spec.
      out.push(item);
    }
  }

  for (const arr of strengthBuckets.values()) {
    if (mods.strengthLoadScale <= 0) continue; // recovery: full skip
    if (mods.strengthLoadScale >= 1) {
      out.push(...arr);
      continue;
    }
    // Slice to a proportional set count, matching the deload pattern.
    const keepN = Math.max(1, Math.round(arr.length * mods.strengthLoadScale));
    const kept = arr.slice(0, keepN);
    if (mods.intensityAction === "minimal") {
      // "minimal" — keep intensity, halve reps. Floor at 1.
      for (const it of kept) {
        if (it.reps != null) {
          out.push({ ...it, reps: Math.max(1, Math.floor(it.reps * 0.5)) });
        } else {
          out.push(it);
        }
      }
    } else {
      out.push(...kept);
    }
  }

  return out;
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
    const sets = item.setRange
      ? `${item.setRange.min}–${item.setRange.max}`
      : String(item.sets ?? 1);
    const dosage = item.holdSec
      ? item.holdSec.min === item.holdSec.max
        ? `${item.holdSec.min}s hold`
        : `${item.holdSec.min}–${item.holdSec.max}s hold`
      : item.repRange
        ? `${item.repRange.min}–${item.repRange.max}`
        : item.reps != null
          ? String(item.reps)
          : "";
    const cleanedNotes = cleanPrescriptionNotes(item.notes);
    const note = cleanedNotes ? ` · ${cleanedNotes}` : "";
    return `${dosage ? `${sets} × ${dosage}` : `${sets} sets`}${note}`;
  }
  if (item.kind === "accessory") {
    const sets = item.setRange
      ? `${item.setRange.min}–${item.setRange.max}`
      : String(item.sets ?? 3);
    // Carries are programmed by distance (or time), never reps. The
    // accessory-intensity matrix strips `reps` for the "carry" bucket
    // and writes `distanceM` instead. Render that here — the catch-all
    // `reps ?? 10` fallback below would silently invent a rep target
    // and lose the distance prescription.
    if (item.distanceM) {
      const { min, max } = item.distanceM;
      const dist = min === max ? `${min} m` : `${min}–${max} m`;
      return `${sets} × ${dist}`;
    }
    // Isometric accessories (planks, wall sits, dead-bug holds) have a
    // hold duration on `holdSec` instead of a rep count. Same shape.
    if (item.holdSec) {
      const { min, max } = item.holdSec;
      const hold = min === max ? `${min}s hold` : `${min}–${max}s hold`;
      return `${sets} × ${hold}`;
    }
    const reps = item.repRange
      ? `${item.repRange.min}–${item.repRange.max}`
      : String(item.reps ?? 10);
    // Internal category tags ("durability" / "functional" / "aesthetic" /
    // "power") live on intensityLabel for engine bookkeeping but must not
    // be rendered to the user — the movement name (e.g. "Farmer carry")
    // shown alongside this row is enough.
    return `${sets} × ${reps}`;
  }
  // Bodyweight + isometric paths: format hold seconds when no reps/percent are set.
  const holdMin = item.holdSec?.min ?? item.bw?.holdSeconds;
  const holdMax = item.holdSec?.max ?? item.bw?.holdSeconds;
  const weight =
    item.percentTm != null && tmKg
      ? `${roundToPlate(tmKg * (item.percentTm / 100))} kg`
      : null;
  const intensity = item.intensityLabel ?? (item.percentTm ? `${item.percentTm}% TM` : null);
  const reps = item.repRange
    ? `× ${item.repRange.min}–${item.repRange.max}`
    : item.reps != null
      ? `× ${item.reps}`
      : "";
  if (weight && intensity) return `${weight} (${intensity}) ${reps}`.trim();
  if (weight) return `${weight} ${reps}`.trim();
  if (intensity) return `${intensity} ${reps}`.trim();
  if (reps) return reps;
  if (holdMin != null && holdMax != null) {
    return holdMin === holdMax ? `${holdMin}s hold` : `${holdMin}–${holdMax}s hold`;
  }
  // Bodyweight reps from the `bw` payload — surfaces a value for items
  // where the top-level `reps` wasn't filled (e.g. tempo_reps variants
  // that only carry `bw.reps` or `bw.repRange`).
  const bwReps = item.bw?.reps;
  if (bwReps != null) return `× ${bwReps}`;
  const range = item.bw?.repRange;
  if (range && range.min != null && range.max != null) {
    return range.min === range.max ? `× ${range.min}` : `× ${range.min}–${range.max}`;
  }
  return "";
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
    return totalMin > 0 ? `${leadLabel} · ${totalMin} min` : leadLabel;
  }

  const tendon = items.filter((i) => i.kind === "tendon");
  if (tendon.length > 0 && tendon.length === items.length) {
    const sets = tendon.length;
    const reps = tendon[0]?.reps;
    const sameReps =
      reps != null && tendon.every((i) => i.reps === reps);
    if (sameReps) return `${sets} × ${reps} · Tendon`;
    const uniqueMovements = new Set(
      tendon.map((i) => i.movementId ?? i.movementSlug ?? i.movementName ?? "tendon"),
    );
    const count = uniqueMovements.size;
    return `Tendon work · ${count} movement${count === 1 ? "" : "s"}`;
  }

  const workingKinds = new Set(["main", "back_off", "power_potentiation"]);
  const working = items.filter((i) => workingKinds.has(i.kind));
  const accessories = items.filter((i) => i.kind === "accessory");

  // Group working sets by movement so multi-movement sessions
  // (bodyweight blocks emit push + pull + squat in one session) get
  // a session-level summary instead of singling out one movement.
  const movementOrder: string[] = [];
  const nameByKey = new Map<string, string>();
  const setsByKey = new Map<string, number>();
  for (const it of working) {
    const key = it.movementId ?? it.movementSlug ?? it.movementName ?? "main";
    if (!setsByKey.has(key)) {
      movementOrder.push(key);
      nameByKey.set(
        key,
        it.movementName ?? humaniseSlug(it.movementSlug) ?? "Main lift",
      );
    }
    setsByKey.set(key, (setsByKey.get(key) ?? 0) + 1);
  }
  const totalWorkingSets = working.length;
  const movementCount = movementOrder.length;

  if (movementCount > 0) {
    if (movementCount === 1) {
      const name = nameByKey.get(movementOrder[0]!)!;
      return `${name} · ${totalWorkingSets} working set${totalWorkingSets === 1 ? "" : "s"}`;
    }
    if (movementCount === 2) {
      const names = movementOrder.map((k) => nameByKey.get(k)!).join(" + ");
      return `${names} · ${totalWorkingSets} working set${totalWorkingSets === 1 ? "" : "s"}`;
    }
    return `${movementCount} strength movements · ${totalWorkingSets} working set${totalWorkingSets === 1 ? "" : "s"}`;
  }

  if (accessories.length > 0 && accessories.length === items.length) {
    const uniqueAccessoryMovements = new Set(
      accessories.map(
        (i, idx) => i.movementId ?? i.movementSlug ?? i.movementName ?? `acc-${idx}`,
      ),
    );
    const count = uniqueAccessoryMovements.size;
    return `${count} accessor${count === 1 ? "y" : "ies"}`;
  }

  return `${items.length} items`;
}

function humaniseSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const cleaned = slug.replaceAll("_", " ").trim();
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
