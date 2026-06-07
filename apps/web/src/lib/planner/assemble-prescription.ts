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
import { applyGoalWeightToTargets } from "./aesthetic-goal-weight";
import { computeWeeklyCompoundCredit } from "./synergist-credit";
import type { LimitationsContext } from "./limitations-context";
import type { FocusMuscle } from "./focus-muscles";
import {
  type EffortPreference,
} from "./effort-preference";
import {
  isActiveTilt,
  secondaryVolumeTilt,
  sessionDurationCapMinutes,
  type SecondaryFocus,
} from "./secondary-focus";
import {
  accessoryVolumeCandidates,
  type AccessoryVolumeLevel,
} from "./accessory-volume";
import { FLOOR_FUNCTIONAL_RESERVE } from "./accessory-roles";
import { estimateSessionSeconds } from "@/lib/sessions/estimate-duration";
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
   * ADR 0016 — user effort dial (`profiles.effort_preference`). Forwarded to
   * `buildPrescription` for the hypertrophy compound EFFORT axis only (the ADR
   * 0016 accessory VOLUME axis was superseded by ADR 0024's `accessoryVolume`
   * level below). `"standard"` (the default) keeps every existing call site
   * byte-identical and is a no-op for non-hypertrophy archetypes.
   */
  effortPreference: EffortPreference = "standard",
  /**
   * ADR 0020 — wizard SECONDARY focus, resolved to the engine enum. A
   * `"muscle"` secondary on a strength / endurance primary tilts the accessory
   * block toward hypertrophy volume (+1 movement, +1 set/movement), then trims
   * that tilt to the session-duration cap. `"none"` (the default) is a
   * byte-identical no-op on every archetype — every existing call site keeps
   * its exact pre-ADR-0020 prescription.
   */
  secondaryFocus: SecondaryFocus = "none",
  /**
   * ADR 0024 — per-block accessory VOLUME level (`training_blocks.accessory_volume`).
   * Composes additively with the secondary-focus tilt at the same accessory
   * site: `low` trims one aesthetic movement (breadth, not depth), `high` adds
   * one movement + one set, and `medium` (the default) is a byte-identical
   * no-op on every archetype — so every existing call site keeps its exact
   * pre-ADR-0024 prescription.
   */
  accessoryVolume: AccessoryVolumeLevel = "medium",
  /**
   * Quick-generate freshness mask (deterministic quick-workout path only). A
   * per-muscle multiplier, keyed by the same fine `movements` muscle enum as
   * the picker's `perMuscleTargets` (`side_delts`, `upper_chest`, …), applied
   * to each aesthetic target AFTER the onboarding ramp so the gap-fill biases
   * toward recovered muscles. `undefined` (every planned-block caller) is a
   * byte-identical no-op — a missing key is treated as ×1.0 and the floor
   * mirrors `applyScalarToTargets`. See `quick-generate.ts`.
   */
  aestheticTargetMask?: ReadonlyMap<string, number>,
  /**
   * Quick-generate variation seed (quick-workout path only). Forwarded to the
   * accessory picker so consecutive quick generations rotate among comparable
   * candidates. `undefined` (every planned-block caller) is a byte-identical
   * no-op — the deterministic best pick. See `quick-generate.ts`.
   */
  variationSeed?: number,
  /**
   * ADR 0034 — true when the block's cardio includes a running-impact day
   * (computed once by the caller from the resolved cardio modalities). Drives
   * the durability floor's Phase-1 Achilles/calf HSR preference. Default false
   * → byte-identical (every legacy caller and the golden harness omit it).
   */
  runningCardio: boolean = false,
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

  // ADR 0030 — the deload week is no longer a fixed index (blocks run multiple
  // loading waves before one deload), so resolve it from the week profile and
  // thread it into accessory-intensity (which otherwise assumed week 3).
  const isDeloadWeek =
    archetype.weekProfiles.find((w) => w.weekIndex === weekIndex)?.intensityLabel ===
    "Deload";

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
    const accessoryProfile = archetype.accessoryProfile;
    const pickerCatalog = catalog;
    // Index the catalog by movement id once. The per-pick lookup below used
    // `pickerCatalog.find((c) => c.id === ...)` (O(n) per accessory pick); a
    // prebuilt Map makes it O(1). First-wins insertion (`has` guard) preserves
    // the exact entry `.find` would have returned, so prescriptions stay
    // byte-identical even if the catalog ever contains duplicate ids.
    const pickerCatalogById = new Map<string, (typeof pickerCatalog)[number]>();
    for (const c of pickerCatalog) {
      if (!pickerCatalogById.has(c.id)) pickerCatalogById.set(c.id, c);
    }
    const history = weekAccessoryHistory;

    const ramp = onboardingRampScalar(experience, weekIndex);
    // Focus-muscle bias (migration 0079, CP-2): when the active block has
    // user-chosen focus muscles, `defaultMuscleTargets` pulls volume from
    // non-focus aesthetic muscles toward the focus group(s). Substitution
    // invariant preserved — total set count unchanged. Beginner-onboarding ramp
    // (CP-3 / CP-5): compress accessory volume for declared beginner/novice
    // users during their first three block weeks; no-op otherwise. Both are
    // tilt-independent, so resolve them once.
    const perMuscleTargets = applyScalarToTargets(
      // ADR 0028 — goal-weighted aesthetic profile. Down-weight the physique
      // triad (side delts / biceps / calves) by ×0.5 on performance-primary
      // archetypes so the gap-fill (which ADR 0027 redirects toward
      // main-lift-uncovered muscles) doesn't over-feed vanity isolation on a
      // strength / hybrid / endurance block. Cancelled by an HONOURED
      // `muscle` secondary (an active ADR 0020 tilt) or an explicit focus
      // pick; identity on every other archetype. A `muscle` secondary on
      // concurrent_hybrid is inert per ADR 0020, so it does NOT cancel.
      applyGoalWeightToTargets(
        defaultMuscleTargets({
          focusMuscles,
          elbowForearmAtlRatio,
        }).targetsByMuscle,
        {
          archetypeId: archetype.id,
          secondaryMuscleHonored: isActiveTilt(
            secondaryVolumeTilt(archetype.id, secondaryFocus),
          ),
          focusMuscles,
        },
      ),
      ramp,
    );

    // Quick-generate freshness mask (default identity). Down-weights the
    // aesthetic target of muscles loaded in the last couple of days so a
    // one-off quick session's gap-fill flows to recovered muscles. A missing
    // key is ×1.0; the floor mirrors `applyScalarToTargets` (positive targets
    // never drop below 1). Absent for every planned-block caller → no-op.
    if (aestheticTargetMask) {
      for (const key of Object.keys(perMuscleTargets)) {
        const mult = aestheticTargetMask.get(key);
        if (mult == null || mult === 1) continue;
        const v = perMuscleTargets[key];
        if (v <= 0) continue;
        const scaled = Math.floor(v * mult);
        perMuscleTargets[key] = scaled < 1 ? 1 : scaled;
      }
    }

    // ADR 0020 secondary-focus volume tilt — an additive bump to the accessory
    // aesthetic profile (+1 set/movement, +1 movement) for a `muscle` secondary
    // on a strength / endurance primary. `NO_TILT` for every other (primary,
    // secondary) combination.
    //
    // ADR 0024 accessory-volume level — composes ADDITIVELY with the secondary
    // tilt and is floored against this archetype's own profile (never below one
    // aesthetic movement or 2 sets; a full no-op on archetypes that ship zero
    // aesthetic items). The result is the duration-governor candidate ladder,
    // fullest first. `medium` + a non-tilting secondary yields a single
    // candidate, so the closure below collapses to the exact pre-ADR-0024
    // single-pick path for every existing call site.
    const tiltCandidates = accessoryVolumeCandidates({
      aestheticBaseItems: accessoryProfile.aesthetic.itemsPerSession,
      baseSetsPerItem: accessoryProfile.aesthetic.setsPerItem,
      level: accessoryVolume,
      secondary: secondaryVolumeTilt(archetype.id, secondaryFocus),
    });

    // Build the accessory section for a given tilt magnitude WITHOUT touching
    // outer state: returns the materialised items plus the week-history delta,
    // so the governor can price candidate tilts and only commit the winner's
    // dedup history.
    const buildAccessorySection = (
      setBonus: number,
      itemBonus: number,
    ): {
      accessoryItems: PrescriptionItem[];
      historyDelta: WeekAccessoryHistoryItem[];
    } => {
      const pickerProfile = {
        ...accessoryProfile,
        aesthetic: {
          ...accessoryProfile.aesthetic,
          setsPerItem: accessoryProfile.aesthetic.setsPerItem + setBonus,
        },
      };
      const picks = pickAccessoriesForSession({
        profile: pickerProfile,
        weekDeloadScale,
        catalog: pickerCatalog,
        weekAccessoryHistory: history,
        filters: {
          blockedRegions: limitationsContext.blockedRegions,
          blockedMuscles: limitationsContext.blockedMuscles,
          blockedMovementIds: limitationsContext.blockedMovementIds,
          allowedMovementIds: limitationsContext.allowedMovementIds,
          concurrentStressActive: false, // wired in a follow-up pass
          recentlyUsedMovementIds: recentlyUsedAccessoryIds,
          tendinopathyActive: limitationsContext.tendinopathyActive,
        },
        perMuscleTargets,
        // DC-O4 tendon-floor protection (ADR 0024 addendum): the durability +
        // functional reserve (+FLOOR_FUNCTIONAL_RESERVE) is held OUTSIDE the
        // onboarding ramp so a beginner's early-week ramp scales hypertrophy
        // breadth (the aesthetic itemsPerSession + the per-muscle aesthetic
        // targets, both ramped) — NOT the low-fatigue tissue-prep floor (heavy
        // isometric / HSR / plyo / carries). Two caps:
        //   • `maxItems` (total ceiling) holds the floor/functional reserve out
        //     of the ramp, giving floor + functional fills the room the ramp
        //     used to steal — closing the lone measured gap (maintenance
        //     carries in beginner ramp weeks).
        //   • `aestheticMaxItems` keeps the ORIGINAL ramped aesthetic budget
        //     (`itemsPerSession + reserve + itemBonus`, fully ramped) so the
        //     reserve can NEVER leak into extra hypertrophy volume for a
        //     beginner.
        // At ramp = 1.0 (every non-beginner call site) both caps equal the
        // previous `itemsPerSession + 4 + itemBonus`, so the result is
        // byte-identical; only beginner/novice block weeks 0–2 change, and only
        // by GAINING protected floor/functional headroom.
        maxItems:
          applyScalarToMaxItems(
            accessoryProfile.aesthetic.itemsPerSession + itemBonus,
            ramp,
          ) + FLOOR_FUNCTIONAL_RESERVE,
        aestheticMaxItems: applyScalarToMaxItems(
          accessoryProfile.aesthetic.itemsPerSession +
            itemBonus +
            FLOOR_FUNCTIONAL_RESERVE,
          ramp,
        ),
        powerEmphasis,
        equipment,
        experience,
        // ADR 0027 Lever B — credit the week's main-lift synergist coverage so
        // the aesthetic gap-fill redirects to genuinely under-trained muscles.
        compoundCoverageCredit: computeWeeklyCompoundCredit(archetype),
        // Finding #1 — focus-muscle MEV floor. Forward the declared focus
        // muscles so the picker can guarantee each reaches its MEV landmark even
        // when the aesthetic budget is fully trimmed. Empty array (no focus
        // muscle) → no-op, byte-identical.
        focusMuscles,
        // ADR 0034 — modality- & pattern-aware durability floor. `runningCardio`
        // steers the week's first HSR to the Achilles/calf region; the day's
        // primary role steers later HSR to the day's pattern tendon region.
        // Both default to no-op (false / undefined) → byte-identical.
        runningCardio,
        dayPrimaryRole: day.kind === "strength" ? day.role : undefined,
        variationSeed,
      });
      const accessoryItems: PrescriptionItem[] = [];
      const historyDelta: WeekAccessoryHistoryItem[] = [];
      for (const p of picks) {
        const catalogEntry = pickerCatalogById.get(p.movementId);
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
          isDeload: isDeloadWeek,
        });
        const slice = accessoryItemPrescription({
          bucket,
          intensity,
          reps: p.reps,
        });
        accessoryItems.push({
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
          historyDelta.push({
            movementId: catalogEntry.id,
            bulletproofRoles: catalogEntry.bulletproofRoles,
            functionalRoles: catalogEntry.functionalRoles,
            primaryMuscles: catalogEntry.primaryMuscles,
            // ADR 0022 — record sets so the next day's per-muscle aesthetic
            // progress accumulator can credit weekly volume in sets, not items.
            sets: p.sets,
          });
        }
      }
      return { accessoryItems, historyDelta };
    };

    // ─── Power Emphasis Phase 3 — PAP / PAPE primer ───
    // Pattern-matched to the day's primary lift; honours blocked regions +
    // tendinopathy. Tilt-independent (it reads previous-block recency, not this
    // session's picks), so resolve it once — both for the duration estimate and
    // for final placement (unshifted to the front, unchanged from before).
    let primerItem: PrescriptionItem | undefined;
    if (powerTransformsApply) {
      const strengthDay = day as StrengthDay;
      const pick = pickPotentiationMovement({
        strengthRole: strengthDay.role,
        catalog: pickerCatalog,
        blockedRegions: limitationsContext.blockedRegions,
        blockedMuscles: limitationsContext.blockedMuscles,
        blockedMovementIds: limitationsContext.blockedMovementIds,
        allowedMovementIds: limitationsContext.allowedMovementIds,
        tendinopathyActive: limitationsContext.tendinopathyActive,
        recentlyUsedMovementIds: recentlyUsedAccessoryIds,
        experience,
      });
      if (pick) primerItem = buildPotentiationItem(pick.movement);
    }

    // Duration governor (ADR 0020/0024): keep the FULLEST tilt whose estimated
    // session stays within the duration cap. The candidate ladder descends from
    // the full composed tilt (level + secondary) → drop the extra movement →
    // drop the extra set → the floored identity. The estimate prices the main
    // lifts + warmups already in `items` plus the candidate accessories +
    // primer. A net-≤-identity tilt (medium, low, or a mix) is a single
    // candidate, so the picker runs exactly once and this branch is
    // byte-identical to the pre-tilt path.
    const candidates = tiltCandidates;

    let chosen = buildAccessorySection(
      candidates[0].setBonus,
      candidates[0].itemBonus,
    );
    if (candidates.length > 1) {
      const capSec =
        sessionDurationCapMinutes(archetype.id, secondaryFocus) * 60;
      for (let i = 0; i < candidates.length; i++) {
        const trial =
          i === 0
            ? chosen
            : buildAccessorySection(
                candidates[i].setBonus,
                candidates[i].itemBonus,
              );
        const sec = estimateSessionSeconds([
          ...items,
          ...trial.accessoryItems,
          ...(primerItem ? [primerItem] : []),
        ]);
        if (sec <= capSec || i === candidates.length - 1) {
          chosen = trial;
          break;
        }
      }
    }

    // Commit the chosen tilt: append the accessory items + their dedup history,
    // then prepend the (tilt-independent) power primer so it leads the session.
    for (const it of chosen.accessoryItems) items.push(it);
    for (const h of chosen.historyDelta) history.push(h);
    if (primerItem) items.unshift(primerItem);
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
        isDeload: isDeloadWeek,
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
