/**
 * Pure prescription-assembly module — extracted from the `"use server"`
 * planner actions so it can be imported directly from test files (mirrors
 * the `external-cardio.ts` pattern). Contains NO server-only code and NO
 * DB/Supabase access: it is a deterministic function of its arguments.
 *
 * `assemblePrescriptionItems` is the single source of truth for how a day's
 * ordered `PrescriptionItem[]` is built (main lifts + warmups + power primer
 * + accessories). Both `createBlock` and `createCustomBlock` consume it so
 * they stay in lockstep.
 */
import type { PrescriptionItem } from "@hta/db";
import type { DeclaredExperience } from "@hta/engine";
import type { Equipment } from "@/lib/settings/equipment-schema";
import {
  type Archetype,
  type DayTemplate,
  type StrengthDay,
  buildPrescription,
  shouldIncludeAccessories,
} from "./archetypes";
import { ACCESSORY_POOLS } from "./accessories";
import {
  pickAccessoriesForSession,
  type CatalogMovement,
  type WeekAccessoryHistoryItem,
} from "./accessory-picker";
import {
  accessoryIntensity,
  accessoryItemPrescription,
  inferAccessoryBucket,
} from "./accessory-intensity";
import {
  applyPowerClampToMainItems,
  archetypeSupportsPowerTransforms,
  buildPotentiationItem,
  pickPotentiationMovement,
} from "./power-emphasis-transform";
import {
  applyScalarToMaxItems,
  applyScalarToTargets,
  onboardingRampScalar,
} from "./onboarding-ramp";
import {
  DEFAULT_WARMUP_SCHEME,
  generateWarmupItems,
  type WarmupScheme,
} from "./warmups";
import { defaultMuscleTargets } from "./focus-muscle-targets";
import type { LimitationsContext } from "./limitations-context";
import type { FocusMuscle } from "./focus-muscles";
import {
  hypertrophyAccessorySetsPerItem,
  type EffortPreference,
} from "./effort-preference";
/**
 * Mutates `items` in place, prepending a warmup ladder for every
 * distinct main-lift movement. The ladder is built off the heaviest
 * planned `kind === "main"` set per movement so a wave-loaded session
 * (e.g. 65/75/85% TM) gets one ramp keyed to the top set, not three
 * separate ramps.
 *
 * `kind === "back_off"` is intentionally NOT a warmup trigger — back-off
 * sets always follow main sets and don't need their own ramp.
 */
function prependWarmupsForMainLifts(
  items: PrescriptionItem[],
  scheme: WarmupScheme,
): void {
  if (scheme.setCount <= 0) return;

  // Find the heaviest main set per movement and remember the position
  // of that movement's FIRST main item so we can insert before it.
  type TopInfo = {
    movementId: string;
    movementSlug?: string;
    movementName?: string;
    topPct: number;
    firstMainIdx: number;
  };
  const byMovement = new Map<string, TopInfo>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.kind !== "main") continue;
    if (it.percentTm == null) continue;
    const existing = byMovement.get(it.movementId);
    if (!existing) {
      byMovement.set(it.movementId, {
        movementId: it.movementId,
        movementSlug: it.movementSlug,
        movementName: it.movementName,
        topPct: it.percentTm,
        firstMainIdx: i,
      });
    } else if (it.percentTm > existing.topPct) {
      existing.topPct = it.percentTm;
    }
  }

  if (byMovement.size === 0) return;

  // Insert from the LATEST first-main index back to the earliest so
  // the recorded indices stay valid as we mutate `items`.
  const ordered = Array.from(byMovement.values()).sort(
    (a, b) => b.firstMainIdx - a.firstMainIdx,
  );
  for (const info of ordered) {
    const warmups = generateWarmupItems(info.movementId, info.topPct, scheme, {
      movementSlug: info.movementSlug,
      movementName: info.movementName,
    });
    if (warmups.length === 0) continue;
    items.splice(info.firstMainIdx, 0, ...warmups);
  }
}

/**
 * Helper: assemble the day's prescription items, optionally appending the
 * curated accessory pool when the archetype + day allow it. Centralised so
 * createBlock and createCustomBlock stay in lockstep.
 *
 * When the archetype declares an `accessoryProfile`, the dynamic picker is
 * used (lib/planner/accessory-picker.ts). Otherwise we fall back to the
 * legacy static `ACCESSORY_POOLS` for backward compatibility.
 *
 * ## Contract
 *
 * **Output ordering (stable, relied on by the renderer/logger).** The returned
 * array is always: `[warmups] → [main lift(s) + folded secondary] → [power
 * primer] → [accessories]`. Warmups are spliced in front of each main movement
 * by `prependWarmups`; the power primer (when `powerEmphasis`) sits between the
 * mains and the accessories; accessories are appended last in picker order
 * (durability deficits → functional → muscle targets → aesthetic fill).
 *
 * **Determinism.** Pure function of its arguments — no DB/Supabase/clock/random
 * access. Identical inputs always yield an identical array. This is what the
 * golden-master suite pins.
 *
 * **`weekAccessoryHistory` is mutated in place (by design).** The caller passes
 * ONE array per generated *week* and reuses it across that week's days. Each day
 * this function reads the array to credit already-prescribed accessory roles /
 * muscles toward the weekly floor, then **pushes this day's picked accessories
 * onto it** so later days in the same week see the running history. Callers must
 * therefore create a fresh `[]` per week (never share one across weeks, never
 * reuse a frozen snapshot). When the arg is `undefined`, the dynamic picker is
 * skipped entirely and the legacy static pools are used.
 *
 * **Byte-identical default invariant.** Every parameter from `catalog` onward is
 * optional/defaulted so legacy/in-flight callers and the golden harness produce
 * the exact pre-existing prescription. In particular `effortPreference`
 * defaults to `"standard"` (a no-op on every axis) and `recentlyUsedAccessoryIds`
 * defaults to empty (no ADR-0012 rotation) — do not change a default without a
 * golden-master update.
 */
export function assemblePrescriptionItems(
  archetype: Archetype,
  weekIndex: number,
  day: DayTemplate,
  movement: { id: string; slug: string; displayName: string },
  finisherMovement: { id: string; slug: string; displayName: string } | undefined,
  movementBySlug: Map<string, { id: string; slug: string; display_name: string }>,
  /** Full catalog for the picker. Optional for backward-compat callers. */
  catalog?: CatalogMovement[],
  /** Rolling per-week context — updated by caller in place. */
  weekAccessoryHistory?: WeekAccessoryHistoryItem[],
  /** Week deload scalar from the archetype's week profile. */
  weekDeloadScale: number = 1.0,
  /** Wizard "Add power emphasis" toggle — persisted on `training_blocks.power_emphasis`. */
  powerEmphasis: boolean = false,
  /**
   * User's warmup-ladder configuration (from `profiles.warmup_scheme`).
   * Pre-resolved by the caller via `resolveWarmupScheme` so we don't
   * re-validate per day. `setCount === 0` skips warmup generation.
   */
  warmupScheme: WarmupScheme = DEFAULT_WARMUP_SCHEME,
  /**
   * User's equipment inventory (from `profiles.equipment`). When supplied
   * the dynamic picker drops candidates whose required implement is
   * missing — see `equipment-requirements.ts`.
   */
  equipment?: Equipment,
  /**
   * When true, the strength day's main-lift items (and their auto-warmup
   * ramp) are skipped — only accessories + power primer are emitted.
   * Set by the caller for the bodyweight-only / no-TM path where there
   * is no %TM number to multiply against.
   */
  omitMainStrength: boolean = false,
  /**
   * Declared training experience (`profiles.training_experience`). When
   * a beginner tier, the accessory picker and potentiation picker both
   * drop plyometric / ballistic / Olympic candidates. `null` keeps the
   * legacy unfiltered behaviour. See `experience-tier-scope.md` §4.
   */
  experience: DeclaredExperience | null = null,
  /**
   * Profile-level limitations read once per block-generation request.
   * When supplied, the dynamic accessory picker and power-emphasis
   * primer picker honour `blockedRegions` and `tendinopathyActive`.
   * Default is the no-limitations context — preserves the previous
   * hard-coded behaviour for callers that haven't been migrated.
   */
  limitationsContext: LimitationsContext = {
    blockedRegions: new Set(),
    blockedMuscles: new Set(),
    blockedMovementIds: new Set(),
    allowedMovementIds: new Set(),
    tendinopathyActive: false,
  },
  /**
   * ADR 0004 — dual-main-lift secondary movement for strength days that
   * declare `secondaryRole` + `secondaryMaxSets`. Forwarded to
   * `buildPrescription`. Undefined for every other day.
   */
  secondaryMovement?: { id: string; slug: string; displayName: string },
  /**
   * Migration 0079 — per-block focus muscle groups (0–2). Forwarded to
   * `defaultMuscleTargets` so the accessory picker biases its
   * per-muscle target map toward the user's chosen muscles via the
   * substitution-with-cap model. Empty array = pre-PR baseline.
   */
  focusMuscles: readonly FocusMuscle[] = [],
  /**
   * Elbow/forearm ATL ratio (current / 4-wk trailing avg). When
   * forearms is a focus muscle and this exceeds 1.25, the engine
   * silently caps forearm volume at MEV per Wernbom 2007 + Baar 2017.
   * Defaults to 1.0 (no spike) — callers without history data
   * short-circuit the gate cleanly.
   */
  elbowForearmAtlRatio: number = 1.0,
  /**
   * ADR 0012 — accessory + power-primer movement ids prescribed in the
   * PREVIOUS block for THIS day's role. The dynamic picker and the
   * potentiation primer demote these (scaled by movement value) so
   * high-value compound staples recur while redundant work rotates each
   * block. Empty for first-ever blocks → byte-identical to pre-ADR-0012.
   */
  recentlyUsedAccessoryIds: Set<string> = new Set(),
  /**
   * ADR 0016 — user effort/volume dial (`profiles.effort_preference`).
   * Forwarded to `buildPrescription` for the hypertrophy compound effort
   * axis, and applied locally below for the hypertrophy accessory VOLUME
   * axis (sets-per-movement). `"standard"` (the default) keeps every
   * existing call site byte-identical and is a no-op for non-hypertrophy
   * archetypes.
   */
  effortPreference: EffortPreference = "standard",
): PrescriptionItem[] {
  const items =
    day.kind === "strength" && omitMainStrength
      ? []
      : buildPrescription(
          archetype,
          weekIndex,
          day,
          movement,
          finisherMovement,
          secondaryMovement,
          undefined,
          effortPreference,
        );
  if (day.kind !== "strength") return items;

  // ─── Power Emphasis Phase 3 — main-lift transforms ───
  // Clamp top set + rewrite reps for any set above the rewrite
  // threshold. No-op on archetypes without heavy strength to cap
  // (endurance / rebuild / maintenance).
  const powerTransformsApply =
    powerEmphasis && archetypeSupportsPowerTransforms(archetype.id);
  if (powerTransformsApply) {
    applyPowerClampToMainItems(items);
  }

  // ─── Auto-warmup ladder ───
  // Prepend warmup items for every main-lift movement (one ramp per
  // movement, built off its TOP planned working set so a 65/75/85
  // wave gets one warmup series, not three). `setCount === 0`
  // disables the feature for the user. No-op when items has no main
  // lifts (the bodyweight-only path).
  prependWarmupsForMainLifts(items, warmupScheme);

  // Dynamic picker path.
  if (archetype.accessoryProfile && catalog && weekAccessoryHistory) {
    // ADR 0016 volume axis — for the hypertrophy archetype only, scale the
    // aesthetic sets-per-movement by the user's effort/volume dial. Movement
    // SELECTION is untouched (the picker's role / focus / dedup invariants
    // hold); only how many sets each chosen accessory carries moves. `low`
    // trims, `high` pushes toward the 10–12 effective-sets/muscle/week zone.
    // `standard` and every non-hypertrophy archetype are byte-identical.
    const pickerProfile =
      archetype.id === "hypertrophy_anchor" && effortPreference !== "standard"
        ? {
            ...archetype.accessoryProfile,
            aesthetic: {
              ...archetype.accessoryProfile.aesthetic,
              setsPerItem: hypertrophyAccessorySetsPerItem(
                effortPreference,
                archetype.accessoryProfile.aesthetic.setsPerItem,
              ),
            },
          }
        : archetype.accessoryProfile;
    const picks = pickAccessoriesForSession({
      profile: pickerProfile,
      weekDeloadScale,
      catalog,
      weekAccessoryHistory,
      filters: {
        blockedRegions: limitationsContext.blockedRegions,
        blockedMuscles: limitationsContext.blockedMuscles,
        blockedMovementIds: limitationsContext.blockedMovementIds,
        allowedMovementIds: limitationsContext.allowedMovementIds,
        concurrentStressActive: false, // wired in a follow-up pass
        recentlyUsedMovementIds: recentlyUsedAccessoryIds,
        tendinopathyActive: limitationsContext.tendinopathyActive,
      },
      // Beginner-onboarding ramp (CP-3 heuristic, CP-5 principle):
      // compress accessory volume for declared beginner/novice users
      // during their first three block weeks. No-op for everyone else
      // and from week 4 onward. Main lifts, warmups, and cardio are
      // not affected — the ramp is applied at the accessory picker
      // boundary only.
      //
      // Focus-muscle bias (migration 0079, CP-2): when the active
      // block has user-chosen focus muscles, `defaultMuscleTargets`
      // pulls volume from non-focus aesthetic muscles toward the
      // focus group(s). Substitution invariant preserved — total set
      // count unchanged. Concurrent-load mod stays available even
      // though we don't currently feed it (the picker's existing
      // concurrent path is the truth-of-record for set scaling).
      perMuscleTargets: applyScalarToTargets(
        defaultMuscleTargets({
          focusMuscles,
          elbowForearmAtlRatio,
        }).targetsByMuscle,
        onboardingRampScalar(experience, weekIndex),
      ),
      maxItems: applyScalarToMaxItems(
        archetype.accessoryProfile.aesthetic.itemsPerSession + 4, // small budget for durability + functional fills
        onboardingRampScalar(experience, weekIndex),
      ),
      powerEmphasis,
      equipment,
      experience,
    });
    for (const p of picks) {
      const catalogEntry = catalog.find((c) => c.id === p.movementId);
      const bucket = inferAccessoryBucket({
        reason: p.reason,
        slug: catalogEntry?.slug ?? p.slug,
        primaryRegion: catalogEntry?.primaryRegion,
        primaryMuscles: catalogEntry?.primaryMuscles,
        isCompound: catalogEntry?.isCompound,
        bulletproofRoles: catalogEntry?.bulletproofRoles,
        functionalRoles: catalogEntry?.functionalRoles,
        highStrainTendon: catalogEntry?.highStrainTendon,
      });
      const intensity = accessoryIntensity({
        archetype: archetype.id,
        bucket,
        weekIndex,
      });
      const slice = accessoryItemPrescription({
        bucket,
        intensity,
        reps: p.reps,
      });
      items.push({
        movementId: p.movementId,
        movementSlug: p.slug,
        movementName: p.displayName,
        kind: "accessory",
        sets: p.sets,
        intensityLabel: p.reason,
        notes: p.rationale ? p.rationale : undefined,
        ...slice,
      });
      if (catalogEntry) {
        weekAccessoryHistory.push({
          movementId: catalogEntry.id,
          bulletproofRoles: catalogEntry.bulletproofRoles,
          functionalRoles: catalogEntry.functionalRoles,
          primaryMuscles: catalogEntry.primaryMuscles,
        });
      }
    }
    // ─── Power Emphasis Phase 3 — PAP / PAPE primer ───
    // Prepended *after* the rest of the prescription is assembled so
    // it's the first item the lifter sees. Pattern-matched to the
    // day's primary lift; honours blocked regions + tendinopathy.
    if (powerTransformsApply) {
      const strengthDay = day as StrengthDay;
      const pick = pickPotentiationMovement({
        strengthRole: strengthDay.role,
        catalog,
        blockedRegions: limitationsContext.blockedRegions,
        blockedMuscles: limitationsContext.blockedMuscles,
        blockedMovementIds: limitationsContext.blockedMovementIds,
        allowedMovementIds: limitationsContext.allowedMovementIds,
        tendinopathyActive: limitationsContext.tendinopathyActive,
        recentlyUsedMovementIds: recentlyUsedAccessoryIds,
        experience,
      });
      if (pick) {
        items.unshift(buildPotentiationItem(pick.movement));
      }
    }
    return items;
  }

  // Legacy static-pool fallback.
  if (shouldIncludeAccessories(archetype, day as StrengthDay)) {
    const pool = ACCESSORY_POOLS[(day as StrengthDay).role] ?? [];
    for (const a of pool) {
      const mv = movementBySlug.get(a.slug);
      if (!mv) continue;
      // Legacy items don't carry catalog metadata — infer from slug
      // alone. Bucket falls back to "compound" if no keyword hits, which
      // gives a sensible RIR 2–3 default for unknown legacy accessories.
      const bucket = inferAccessoryBucket({ slug: a.slug });
      const intensity = accessoryIntensity({
        archetype: archetype.id,
        bucket,
        weekIndex,
      });
      const slice = accessoryItemPrescription({
        bucket,
        intensity,
        reps: parseInt(a.reps, 10),
      });
      items.push({
        movementId: mv.id,
        movementSlug: mv.slug,
        movementName: mv.display_name,
        kind: "accessory",
        sets: a.sets,
        intensityLabel: a.muscleTarget,
        notes: a.rationale,
        ...slice,
      });
    }
  }
  return items;
}
