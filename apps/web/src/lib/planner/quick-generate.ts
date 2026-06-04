/**
 * Quick strength generator (deterministic v1) — freshness-aware, archetype-aware
 * one-off strength session for the Today-page "Quick workout" card.
 *
 * Pure planning core only (no I/O). The server action gathers engine inputs,
 * calls these helpers, and materialises the result into a session row.
 *
 * Two freshness levers, both grounded in the muscle-recovery window
 * (resistance-trained myofibrillar protein synthesis is elevated ~24–48h and
 * returns toward baseline by ~36–72h — Damas 2016 PMID 26666744; MacDougall
 * 1995; Schoenfeld dose-response). For a one-off bonus session we want to train
 * what is RECOVERED, not re-hammer what was just trained:
 *
 *   1. Pattern routing — pick the strength ROLE (squat / press / hinge / press)
 *      whose prime movers are freshest, so the main lift lands on a recovered
 *      pattern.
 *   2. Aesthetic freshness mask — down-weight the accessory gap-fill on muscle
 *      groups loaded in the last couple of days so the isolation work flows to
 *      fresh muscles.
 *
 * Both are CP-1 / Stage-A heuristics (no calibration data). The mask is applied
 * to the picker's per-muscle target map via the optional `aestheticTargetMask`
 * hook on `assemblePrescriptionItems` (default identity → byte-identical for
 * every planned-block caller).
 */
import type { Archetype, StrengthRole } from "./archetypes";
import type { StrengthDay } from "./archetypes";
import type { PrescriptionItem } from "@hta/db";
import type { DeclaredExperience } from "@hta/engine";
import type { Equipment } from "@/lib/settings/equipment-schema";
import { assemblePrescriptionItems } from "./assemble-prescription";
import type { CatalogMovement } from "./accessory-picker";
import type { WarmupScheme } from "./warmups";
import type { LimitationsContext } from "./limitations-context";
import type { FocusMuscle } from "./focus-muscles";
import type { EffortPreference } from "./effort-preference";
import type { SecondaryFocus } from "./secondary-focus";
import type { AccessoryVolumeLevel } from "./accessory-volume";
import { estimateSessionMinutes } from "@/lib/sessions/estimate-duration";
import { AESTHETIC_TARGET_MUSCLES } from "./focus-muscle-targets";
import {
  MUSCLE_FROM_DB_ENUM,
  type MuscleGroup,
} from "@/lib/muscle/muscle-groups";
import type { MuscleFreshnessBand } from "@/lib/muscle/muscle-freshness";

/** Requested quick-session length. */
export type QuickLength = "short" | "normal";

/** Session-duration budget per length (minutes). Trim-to-fit ceiling. */
// heuristic — practitioner time budgets (CP-1), no calibration data
export const SHORT_CAP_MIN = 30;
export const NORMAL_CAP_MIN = 60;

export function durationCapMinutes(length: QuickLength): number {
  return length === "short" ? SHORT_CAP_MIN : NORMAL_CAP_MIN;
}

/**
 * Prime movers per strength role, in the 16-muscle freshness taxonomy. Used to
 * score how recovered a role's main lift would be. Deliberately the PRIME
 * movers only (not every synergist) so the score reflects the muscles that
 * actually limit the lift.
 */
// heuristic — prime-mover anatomy (CP-1), per standard movement classification
export const STRENGTH_ROLE_PRIME_MUSCLES: Record<StrengthRole, MuscleGroup[]> = {
  squat: ["quads", "glutes"],
  horizontal_press: ["chest", "triceps"],
  deadlift: ["hamstrings", "glutes", "erectors"],
  vertical_press: ["shoulders", "triceps"],
};

/**
 * Recovery value of a freshness band in [0,1]. A never-trained or ≥4-day-rested
 * muscle is fully fresh; a muscle loaded in the last <2 days is the least ready.
 */
// heuristic — recovery-window mapping (CP-1), per Damas 2016 / MPS kinetics
export function freshnessValue(band: MuscleFreshnessBand): number {
  switch (band) {
    case "untouched":
    case "fresh":
      return 1.0;
    case "ready":
      return 0.6;
    case "loaded":
      return 0.2;
  }
}

/**
 * Mean recovery value across a role's prime movers. Higher = fresher = better
 * candidate for today's main lift. A role whose muscles are missing from the
 * freshness map (shouldn't happen — the map covers all 16) reads as fully
 * fresh so it is never spuriously demoted.
 */
export function scoreRoleFreshness(
  role: StrengthRole,
  freshnessByGroup: ReadonlyMap<MuscleGroup, MuscleFreshnessBand>,
): number {
  const muscles = STRENGTH_ROLE_PRIME_MUSCLES[role];
  if (muscles.length === 0) return 1.0;
  let sum = 0;
  for (const m of muscles) {
    const band = freshnessByGroup.get(m);
    sum += band ? freshnessValue(band) : 1.0;
  }
  return sum / muscles.length;
}

/**
 * Pick the freshest strength role from a candidate list. Stable: the first
 * candidate wins ties, so callers pass roles in the archetype's own day order
 * (anchors first) to keep the choice deterministic and identity-aligned.
 */
export function pickFreshestStrengthRole(
  candidateRoles: readonly StrengthRole[],
  freshnessByGroup: ReadonlyMap<MuscleGroup, MuscleFreshnessBand>,
): StrengthRole | null {
  let best: StrengthRole | null = null;
  let bestScore = -Infinity;
  for (const role of candidateRoles) {
    const score = scoreRoleFreshness(role, freshnessByGroup);
    if (score > bestScore) {
      bestScore = score;
      best = role;
    }
  }
  return best;
}

/**
 * Per-band multiplier applied to a muscle's weekly aesthetic target. A muscle
 * trained in the last <2 days is heavily de-prioritised (but not zeroed — a
 * light maintenance touch is fine); a 2–3-day muscle is partially down-weighted;
 * a fresh / never-trained muscle keeps its full target.
 */
// heuristic — recovery-aware accessory bias (CP-1), no calibration data
export const FRESHNESS_TARGET_MULTIPLIER: Record<MuscleFreshnessBand, number> = {
  loaded: 0.34,
  ready: 0.67,
  fresh: 1.0,
  untouched: 1.0,
};

/**
 * Build the aesthetic-target freshness mask, keyed by the fine `movements`
 * muscle enum (the same keys `defaultMuscleTargets` produces — `side_delts`,
 * `upper_chest`, …). Each fine-enum muscle collapses to its 16-group via
 * `MUSCLE_FROM_DB_ENUM`; the group's freshness band picks the multiplier.
 *
 * Muscles with no group mapping, or whose group is missing from the freshness
 * map, are omitted (the assembler treats a missing key as ×1.0).
 */
export function buildAestheticFreshnessMask(
  freshnessByGroup: ReadonlyMap<MuscleGroup, MuscleFreshnessBand>,
): Map<string, number> {
  const mask = new Map<string, number>();
  for (const fineMuscle of AESTHETIC_TARGET_MUSCLES) {
    const group = MUSCLE_FROM_DB_ENUM[fineMuscle];
    if (!group) continue;
    const band = freshnessByGroup.get(group);
    if (!band) continue;
    mask.set(fineMuscle, FRESHNESS_TARGET_MULTIPLIER[band]);
  }
  return mask;
}

/**
 * The week-profile index a quick one-off session should borrow its intensity
 * wave from: the first NON-deload working week. A bonus session should never
 * inherit a deload's reduced load, and the first working week is the most
 * predictable "normal" intensity for the archetype. Falls back to 0.
 */
export function quickWorkingWeekIndex(archetype: Archetype): number {
  const idx = archetype.weekProfiles.findIndex(
    (w) => (w.strengthVolumeScale ?? 1) >= 1,
  );
  return idx >= 0 ? idx : 0;
}

/**
 * Inputs the server action resolves (mirroring `createBlock`) and hands to the
 * pure assembler. Everything here is read-only engine context.
 */
export type QuickAssembleParams = {
  archetype: Archetype;
  /** The chosen freshest strength day (single pattern; no dual-main-lift). */
  day: StrengthDay;
  /** Resolved main-lift movement for the day's role. */
  movement: { id: string; slug: string; displayName: string };
  movementBySlug: Map<string, { id: string; slug: string; display_name: string }>;
  catalog?: CatalogMovement[];
  warmupScheme?: WarmupScheme;
  equipment?: Equipment;
  /** True when the user has no TM for the main lift (bodyweight / new user). */
  omitMainStrength: boolean;
  experience: DeclaredExperience | null;
  limitationsContext?: LimitationsContext;
  focusMuscles?: readonly FocusMuscle[];
  effortPreference?: EffortPreference;
  secondaryFocus?: SecondaryFocus;
  accessoryVolume?: AccessoryVolumeLevel;
  /** Per-group freshness bands from `getMuscleFreshness`. */
  freshnessByGroup: ReadonlyMap<MuscleGroup, MuscleFreshnessBand>;
  length: QuickLength;
};

/**
 * Build a quick strength session's `PrescriptionItem[]` for the freshest
 * pattern, freshness-masked, then trim accessories to the length budget.
 *
 * Trimming drops trailing accessory items first. The picker appends accessories
 * in priority order (durability → functional → power → aesthetic), so trimming
 * from the end removes vanity gap-fill before the durability / functional floor.
 * Main lifts and warmups are never trimmed.
 */
export function assembleQuickStrengthItems(
  params: QuickAssembleParams,
): PrescriptionItem[] {
  const weekIndex = quickWorkingWeekIndex(params.archetype);
  const mask = buildAestheticFreshnessMask(params.freshnessByGroup);

  const items = assemblePrescriptionItems(
    params.archetype,
    weekIndex,
    params.day,
    params.movement,
    undefined, // finisherMovement — strength-only quick session
    params.movementBySlug,
    params.catalog,
    [], // fresh per-week accessory history — a one-off session
    1.0, // weekDeloadScale — quick session borrows a working (non-deload) week
    false, // powerEmphasis — kept simple for quick sessions
    params.warmupScheme,
    params.equipment,
    params.omitMainStrength,
    params.experience,
    params.limitationsContext,
    undefined, // secondaryMovement — single pattern, no dual-main-lift
    params.focusMuscles ?? [],
    1.0, // elbowForearmAtlRatio — gate short-circuit
    new Set<string>(), // recentlyUsedAccessoryIds — no previous-block recency
    params.effortPreference ?? "standard",
    params.secondaryFocus ?? "none",
    params.accessoryVolume ?? "medium",
    mask,
  );

  return trimToDurationCap(items, durationCapMinutes(params.length));
}

/**
 * Drop trailing accessory items until the estimated session duration fits the
 * cap (or no trimmable accessory remains). Non-accessory items (main, warmup,
 * tendon, cardio) are never removed.
 */
export function trimToDurationCap(
  items: PrescriptionItem[],
  capMinutes: number,
): PrescriptionItem[] {
  const out = [...items];
  // Guard against pathological loops: at most one pass per accessory item.
  let guard = out.length + 1;
  while (guard-- > 0) {
    const est = estimateSessionMinutes(out);
    if (est == null || est <= capMinutes) break;
    const lastAccessoryIdx = findLastIndex(
      out,
      (it) => it.kind === "accessory",
    );
    if (lastAccessoryIdx < 0) break; // nothing trimmable — keep the mains
    out.splice(lastAccessoryIdx, 1);
  }
  return out;
}

function findLastIndex<T>(
  arr: readonly T[],
  pred: (item: T) => boolean,
): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i]!)) return i;
  }
  return -1;
}

