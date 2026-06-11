import type { SupabaseClient } from "@supabase/supabase-js";
import type { MovementFamily, MovementNode } from "@hta/db";
import type { DeclaredExperience } from "@hta/engine";
import {
  ARCHETYPES,
  type ArchetypeId,
  allCandidateLiftSlugs,
  daysForFrequency,
  daySlotKey,
  minDaysForArchetype,
  requiredFixedSlugs,
  STRENGTH_ROLE_LABELS,
} from "./archetypes";
import { allAccessorySlugs } from "./accessories";
import { foldDualMainLifts } from "./main-lift-folding";
import {
  applyPlacementsToActiveDays,
  type DayIndexOverrides,
} from "./wizard/placements";
import { type CatalogMovement } from "./accessory-picker";
import { readLimitationsContext } from "./limitations-context";
import { loadPickerCatalog } from "./picker-catalog";
import { loadCardioCatalog } from "./cardio-catalog";
import { sanitizePreferredModalities } from "./preferred-cardio-modality";
import {
  resolveGoalModality,
  type GoalModality,
} from "./cardio-modality-plan";
import { declaredExperienceToTier, tierInBand } from "./experience-tier";
import { resolveWarmupScheme } from "./warmups";
import {
  resolveEquipment,
  hasLoadableMainLift,
} from "@/lib/settings/equipment-presets";
import { type BwFamilyContext } from "./bw-main-items";
import { type FocusMuscle } from "./focus-muscles";
import { resolveEffortPreference } from "./effort-preference";
import { resolveSecondaryFocus } from "./secondary-focus";
import { resolveAccessoryVolumeLevel } from "./accessory-volume";
import { getElbowForearmAtlRatio } from "@/lib/stats/region-spike-queries";
import { getPreviousBlockAccessoryIdsByRole } from "./accessory-history-queries";
import { getUserTimezone } from "./queries";
import { type BlockAssemblyContext } from "./assemble-block-sessions";

/**
 * Movement-row shape used by the main-lift resolver. Only the columns
 * actually read at the call site — the resolver doesn't need the full
 * `DbMovement` projection (no muscles / roles / scores).
 */
type StrengthMovementRow = {
  id: string;
  slug: string;
  display_name: string;
  experience_min: number | null;
  experience_max: number | null;
};

/**
 * PR W2 — pick the first candidate slug whose movement falls within
 * the user's experience band AND has a TM logged. Encodes Surface B
 * (main-lift resolver) so a user with TMs for `[back-squat-high-bar,
 * pause-back-squat]` picks the high-bar at tier 0 and the pause variant
 * only when the band allows it. Tier `null` (no declaration) preserves
 * the legacy "first candidate with a TM" behaviour.
 *
 * Returns `null` if no in-band candidate has a TM — caller handles the
 * out-of-band fallback (use the TM anyway, log a dev warning) so the
 * filter doesn't block training.
 */
export function pickStrengthMovementForBand({
  candidateSlugs,
  movementBySlug,
  tmMovementIds,
  tier,
}: {
  candidateSlugs: readonly string[];
  movementBySlug: Map<string, StrengthMovementRow>;
  tmMovementIds: Set<string>;
  tier: number | null;
}): { movementId: string; slug: string; displayName: string } | null {
  for (const slug of candidateSlugs) {
    const mv = movementBySlug.get(slug);
    if (!mv) continue;
    if (!tmMovementIds.has(mv.id)) continue;
    if (!tierInBand(tier, mv.experience_min ?? 0, mv.experience_max ?? 4)) continue;
    return { movementId: mv.id, slug: mv.slug, displayName: mv.display_name };
  }
  return null;
}

/**
 * ADR 0004 — resolve the dual-main-lift secondary movement for a strength
 * day that declares `secondaryCandidateSlugs`. Mirrors the in-band-with-TM
 * → out-of-band-TM fallback used for the primary slot, BUT does **not**
 * fall back to a no-TM catalog reference: if no TM is set anywhere in the
 * secondary candidate list, this returns null and the prescription emits
 * the primary lift only. The secondary slot is opt-in via TM.
 */
export function pickSecondaryStrengthMovement({
  candidateSlugs,
  movementBySlug,
  tmMovementIds,
  tier,
}: {
  candidateSlugs: readonly string[];
  movementBySlug: Map<string, StrengthMovementRow>;
  tmMovementIds: Set<string>;
  tier: number | null;
}): { movementId: string; slug: string; displayName: string } | null {
  const inBand = pickStrengthMovementForBand({ candidateSlugs, movementBySlug, tmMovementIds, tier });
  if (inBand) return inBand;
  for (const slug of candidateSlugs) {
    const mv = movementBySlug.get(slug);
    if (mv && tmMovementIds.has(mv.id)) {
      return { movementId: mv.id, slug: mv.slug, displayName: mv.display_name };
    }
  }
  return null;
}

/**
 * Whitelist the 5 declared experience tiers shipped in migration 0052.
 * Anything else (null, legacy values, undeclared) collapses to null so
 * the accessory picker treats the user as "not declared" and keeps the
 * pre-PR-W1 behaviour (no filtering).
 */
const DECLARED_EXPERIENCE_VALUES: ReadonlySet<DeclaredExperience> = new Set([
  "beginner_lt_6m",
  "novice_6m_2y",
  "intermediate_2y_5y",
  "advanced_5y_10y",
  "highly_advanced_10y_plus",
]);

export function resolveDeclaredExperience(
  raw: string | null | undefined,
): DeclaredExperience | null {
  if (!raw) return null;
  return DECLARED_EXPERIENCE_VALUES.has(raw as DeclaredExperience)
    ? (raw as DeclaredExperience)
    : null;
}

/**
 * Wizard / caller-supplied inputs the DB context-build needs. Mirrors the
 * `createBlockSchema` parsed shape (minus the FormData plumbing) plus the
 * already-parsed `dayIndexOverrides` payload.
 */
export type BuildBlockAssemblyContextInput = {
  archetypeId: ArchetypeId;
  startedOn: string;
  daysPerWeek: number;
  dayIndexOverrides: DayIndexOverrides | null;
  powerEmphasis: boolean;
  focusMuscles: readonly FocusMuscle[];
  goal?: string;
  secondaryFocus?: string;
  accessoryVolume?: string;
  cardioSource: "internal" | "external";
  cardioSourceName: string | null;
};

/**
 * Result of the DB context-build. On success it carries the fully-built
 * {@link BlockAssemblyContext} (the same object `createBlock` used to build
 * inline) plus the `meta` fields `createBlock` still needs AFTER the build
 * to write the `training_blocks` row.
 */
export type BuildBlockAssemblyContextResult =
  | {
      ok: true;
      ctx: BlockAssemblyContext;
      meta: { hasAnyTm: boolean; bwHasAnyFamily: boolean };
    }
  | { ok: false; error: string };

/**
 * Pure (behaviour-preserving) extraction of `createBlock`'s DB
 * context-build phase: look up the archetype, load the profile, resolve
 * every per-block local (two-a-days / warmups / equipment / experience /
 * effort / secondary focus / accessory volume / cardio preferences),
 * resolve the GOAL cardio modality, load catalogs, fold + place the active
 * days, resolve per-day strength movements, load TMs + bodyweight context,
 * and read the limitations / forearm-spike / recency context.
 *
 * Performs DB reads via `supabase` but holds NO request-scoped state of its
 * own — every input arrives via `input` / `userId`. Returns the assembled
 * {@link BlockAssemblyContext} so the caller can run
 * `assembleBlockSessions(ctx, blockId, userId)`, plus the `meta` the caller
 * needs to write the `training_blocks` row (notably the `notes` text).
 *
 * Early validation failures (min days, movement/catalog/TM lookups, missing
 * fixed movements, missing TM roles) return `{ ok: false, error }`.
 */
export async function buildBlockAssemblyContext(
  supabase: SupabaseClient,
  userId: string,
  input: BuildBlockAssemblyContextInput,
): Promise<BuildBlockAssemblyContextResult> {
  const archetype = ARCHETYPES[input.archetypeId as keyof typeof ARCHETYPES];
  if (!archetype) return { ok: false, error: "Unknown archetype" };

  // Look up the user's two-a-day preference + warmup-ladder config + equipment so we pick the right day pool, prepend warmups, and only prescribe movements they can actually do.
  const { data: profile } = await supabase
    .from("profiles")
    .select("allows_two_a_days, warmup_scheme, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, bw_assessment_completed_at, bodyweight_kg, training_experience, effort_preference, preferred_cardio_modalities")
    .eq("id", userId)
    .maybeSingle();
  const allowsTwoADays = Boolean(profile?.allows_two_a_days ?? false);
  const warmupScheme = resolveWarmupScheme(profile?.warmup_scheme);
  const equipment = resolveEquipment(profile);
  const experience = resolveDeclaredExperience(profile?.training_experience);
  const effortPreference = resolveEffortPreference(profile?.effort_preference);
  // ADR 0020 — resolved wizard secondary focus that drives the volume tilt.
  // `none` for legacy / custom blocks → byte-identical pre-ADR-0020 engine.
  const secondaryFocus = resolveSecondaryFocus(input.secondaryFocus);
  // ADR 0024 — per-block accessory volume level (`low | medium | high`).
  // `medium` (the default) is a byte-identical no-op on every archetype.
  const accessoryVolume = resolveAccessoryVolumeLevel(input.accessoryVolume);

  // ADR 0017 — ranked cardio-modality preference. The catalog is loaded
  // lazily; with no preference set the resolver is a no-op and the default
  // (running) prescription is byte-identical to the pre-0017 behaviour.
  const preferredCardioModalities = sanitizePreferredModalities(
    profile?.preferred_cardio_modalities as readonly unknown[] | null,
  );
  // ADR 0039 — specificity-aware modality plan. Resolve the block's GOAL cardio
  // modality: an upcoming A-priority event wins, else the user's top preference,
  // else running. Only an EVENT goal unlocks the specificity/diversification
  // behaviour (so non-event blocks stay byte-identical). Cheap, user-scoped read.
  const { data: upcomingEvent } = await supabase
    .from("events")
    .select("modality")
    .eq("user_id", userId)
    .eq("priority", "A")
    .gte("event_date", input.startedOn)
    .order("event_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  const goalModality: GoalModality = resolveGoalModality({
    eventModality: (upcomingEvent?.modality as string | null) ?? null,
    preferred: preferredCardioModalities,
  });
  const cardioCatalog =
    preferredCardioModalities.length > 0 || goalModality.source === "event"
      ? await loadCardioCatalog(supabase)
      : [];
  const cardioCatalogBySlug = new Map(cardioCatalog.map((c) => [c.slug, c]));

  const minDays = minDaysForArchetype(
    archetype,
    allowsTwoADays,
    equipment.preset === "bodyweight_only",
  );
  if (input.daysPerWeek < minDays) {
    return {
      ok: false,
      error: `${archetype.name} needs at least ${minDays} training days/week.`,
    };
  }
  const canonicalActiveDays = foldDualMainLifts(
    archetype,
    daysForFrequency(archetype, input.daysPerWeek, allowsTwoADays),
  );
  // Honour the user's Step-5 arrangement (Mon/Tue/Thu/Sat etc.) when the
  // wizard supplied placements. Without this remap the canonical archetype
  // template order leaks through and overrides whatever the user picked.
  // See `wizard/placements.ts` for the matching strategy + fallbacks.
  const activeDays = applyPlacementsToActiveDays(
    canonicalActiveDays,
    input.dayIndexOverrides?.placements ?? null,
  );

  const candidateSlugs = allCandidateLiftSlugs(archetype);
  const fixedSlugs = requiredFixedSlugs(archetype);
  const accessorySlugs = allAccessorySlugs();
  const allSlugs = Array.from(new Set([...candidateSlugs, ...fixedSlugs, ...accessorySlugs]));

  const { data: movements, error: mvErr } = await supabase
    .from("movements")
    .select("id, slug, display_name, experience_min, experience_max")
    .in("slug", allSlugs)
    .is("user_id", null);
  if (mvErr) return { ok: false, error: `Movement lookup failed: ${mvErr.message}` };

  const movementBySlug = new Map((movements ?? []).map((m) => [m.slug, m]));

  // Picker catalog — full global catalog with role tags. Loaded only when
  // the archetype has an accessoryProfile so legacy archetypes pay nothing.
  let pickerCatalog: CatalogMovement[] = [];
  if (archetype.accessoryProfile) {
    pickerCatalog = await loadPickerCatalog(supabase);
    if (pickerCatalog.length === 0) {
      return { ok: false, error: "Catalog load failed" };
    }
  }

  const missingFixed = fixedSlugs.filter((s) => !movementBySlug.has(s));
  if (missingFixed.length > 0) {
    return {
      ok: false,
      error: `Catalog is missing required movements: ${missingFixed.join(", ")}. Re-seed movements.`,
    };
  }

  const candidateMovementIds = candidateSlugs
    .map((s) => movementBySlug.get(s)?.id)
    .filter((id): id is string => !!id);

  const { data: tms, error: tmErr } = await supabase
    .from("training_maxes")
    .select("movement_id, updated_at")
    .in("movement_id", candidateMovementIds);

  if (tmErr) return { ok: false, error: `TM lookup failed: ${tmErr.message}` };

  const tmByMovementId = new Map((tms ?? []).map((r) => [r.movement_id, r.updated_at]));

  /**
   * Bodyweight-only / no-TM path. When the user has no training maxes
   * at all (e.g. they picked the bodyweight-only equipment preset and
   * skipped the TM step), the planner can't produce %TM-based main
   * lift items. Build the block anyway with accessories + tendon work
   * only — the picker keys off equipment, so a bodyweight setup yields
   * push-up / pull-up / single-leg / plank variants prescribed via
   * RPE / RIR rather than %TM.
   */
  const hasAnyTm = tmByMovementId.size > 0;

  // ─── Bodyweight Phase 3 — main-lift prescription ─────────────────
  // When the user has no loadable kit AND has populated bw_progress
  // (via the Phase 2 assessment wizard), the planner emits BW main +
  // back-off items per session from the per-family DAG node. Detection
  // matches the plan: `!hasLoadableMainLift(equipment)` AND at least
  // one bw_progress row.
  const bwActive = !hasLoadableMainLift(equipment);
  const bwByFamily = new Map<MovementFamily, BwFamilyContext>();
  if (bwActive) {
    const { data: bwRows } = await supabase
      .from("bw_progress")
      .select("family, current_node_id, clean_rep_history")
      .eq("user_id", userId);
    const nodeIds = (bwRows ?? [])
      .map((r) => r.current_node_id as string | null)
      .filter((id): id is string => !!id);
    if (nodeIds.length > 0) {
      const { data: nodes } = await supabase
        .from("movement_nodes")
        .select(
          "id, family, node_key, display_name, prerequisites, external_load_capable, isometric_capable, unilateral, default_tempo_seconds, tut_per_rep_seconds, difficulty_anchor, created_at",
        )
        .in("id", nodeIds);
      const nodeById = new Map<string, MovementNode>();
      for (const n of nodes ?? []) {
        // PostgREST returns snake_case columns; hydrate into the typed
        // MovementNode shape used by the matrix helper.
        const row = n as Record<string, unknown>;
        nodeById.set(row.id as string, {
          id: row.id as string,
          family: row.family as MovementFamily,
          nodeKey: row.node_key as string,
          displayName: row.display_name as string,
          prerequisites: (row.prerequisites as string[]) ?? [],
          externalLoadCapable: Boolean(row.external_load_capable),
          isometricCapable: Boolean(row.isometric_capable),
          unilateral: Boolean(row.unilateral),
          defaultTempoSeconds: row.default_tempo_seconds as number,
          tutPerRepSeconds: row.tut_per_rep_seconds as number,
          difficultyAnchor: row.difficulty_anchor as number,
          createdAt: row.created_at as unknown as Date,
        });
      }

      // Resolve a real `movements` row per node so the focus view's
      // per-movement grouping keeps working. We look up by slug ==
      // node_key against the global catalog; nodes without a matching
      // catalog movement borrow whichever movement row the day already
      // resolved to (set later, inside the day loop).
      const bwNodeSlugs = Array.from(
        new Set(Array.from(nodeById.values()).map((n) => n.nodeKey)),
      );
      const { data: bwMovements } = await supabase
        .from("movements")
        .select("id, slug, display_name")
        .in("slug", bwNodeSlugs)
        .is("user_id", null);
      const bwMovementBySlug = new Map(
        (bwMovements ?? []).map((m) => [m.slug as string, m] as const),
      );

      // Phase 4 — fetch DAG children of every current node so we can
      // stamp the "Next:" preview onto each BW prescription item.
      // One round-trip via `overlaps` against the prerequisites
      // array; results filtered to same-family children below.
      const { data: childRowsRaw } = await supabase
        .from("movement_nodes")
        .select(
          "id, family, node_key, display_name, prerequisites, external_load_capable, isometric_capable, unilateral, default_tempo_seconds, tut_per_rep_seconds, difficulty_anchor, created_at",
        )
        .overlaps("prerequisites", nodeIds);
      const childrenByCurrentId = new Map<string, MovementNode[]>();
      for (const r of (childRowsRaw ?? []) as Array<Record<string, unknown>>) {
        const childNode: MovementNode = {
          id: r.id as string,
          family: r.family as MovementFamily,
          nodeKey: r.node_key as string,
          displayName: r.display_name as string,
          prerequisites: (r.prerequisites as string[]) ?? [],
          externalLoadCapable: Boolean(r.external_load_capable),
          isometricCapable: Boolean(r.isometric_capable),
          unilateral: Boolean(r.unilateral),
          defaultTempoSeconds: r.default_tempo_seconds as number,
          tutPerRepSeconds: r.tut_per_rep_seconds as number,
          difficultyAnchor: r.difficulty_anchor as number,
          createdAt: r.created_at as unknown as Date,
        };
        for (const prereq of childNode.prerequisites) {
          if (!nodeIds.includes(prereq)) continue;
          const arr = childrenByCurrentId.get(prereq) ?? [];
          arr.push(childNode);
          childrenByCurrentId.set(prereq, arr);
        }
      }

      for (const row of bwRows ?? []) {
        const node = nodeById.get(row.current_node_id as string);
        if (!node) continue;
        const family = row.family as MovementFamily;
        const movementRow = bwMovementBySlug.get(node.nodeKey);
        const cleanRepHistory = Array.isArray(row.clean_rep_history)
          ? (row.clean_rep_history as ReadonlyArray<{ reps?: number; seconds?: number }>)
          : [];
        bwByFamily.set(family, {
          family,
          node,
          // Fallback: when the catalog has no row matching the node_key
          // we still need a uuid for movementId — borrow the node's own
          // id, which is rejected by `movement-grouping` only if it
          // collides with a real movements row (it doesn't — disjoint
          // tables). The focus view reads displayName off the item, not
          // the movements row, so the rendered name stays correct.
          movementId: movementRow?.id ?? node.id,
          movementSlug: (movementRow?.slug as string | undefined) ?? node.nodeKey,
          movementName:
            (movementRow?.display_name as string | undefined) ?? node.displayName,
          cleanRepHistory,
          candidateNextNodes: childrenByCurrentId.get(node.id) ?? [],
        });
      }
    }
  }
  const bwHasAnyFamily = bwByFamily.size > 0;

  const userTier = declaredExperienceToTier(experience);
  const resolved = new Map<string, { movementId: string; slug: string; displayName: string }>();
  // ADR 0004 — parallel map keyed by daySlotKey for dual-main-lift secondaries.
  const resolvedSecondary = new Map<string, { movementId: string; slug: string; displayName: string }>();
  const missingRoles: string[] = [];

  for (const day of activeDays) {
    if (day.kind !== "strength") continue;
    let chosen = pickStrengthMovementForBand({
      candidateSlugs: day.candidateSlugs,
      movementBySlug,
      tmMovementIds: new Set(tmByMovementId.keys()),
      tier: userTier,
    });
    // Out-of-band fallback: if the user has TMs but ONLY for movements
    // outside their declared band, honour the TM rather than blocking
    // them from training. They explicitly entered it.
    if (!chosen) {
      for (const slug of day.candidateSlugs) {
        const mv = movementBySlug.get(slug);
        if (mv && tmByMovementId.has(mv.id)) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[planner] using out-of-band TM ${slug} for tier ${userTier ?? "null"} (band ${mv.experience_min}..${mv.experience_max})`,
            );
          }
          chosen = { movementId: mv.id, slug: mv.slug, displayName: mv.display_name };
          break;
        }
      }
    }
    // Fallback for the no-TM path: use the first available candidate
    // movement purely as a catalog reference. The day will be built
    // accessory-only below (no %TM items), so this is only used so the
    // row has a valid movement_id to attach the prescription to.
    if (!chosen && !hasAnyTm) {
      // Honour the tier here too — first in-band candidate, fall back
      // to first candidate of any tier.
      for (const slug of day.candidateSlugs) {
        const mv = movementBySlug.get(slug);
        if (
          mv &&
          tierInBand(userTier, mv.experience_min ?? 0, mv.experience_max ?? 4)
        ) {
          chosen = { movementId: mv.id, slug: mv.slug, displayName: mv.display_name };
          break;
        }
      }
      if (!chosen) {
        for (const slug of day.candidateSlugs) {
          const mv = movementBySlug.get(slug);
          if (mv) {
            chosen = { movementId: mv.id, slug: mv.slug, displayName: mv.display_name };
            break;
          }
        }
      }
    }
    if (chosen) resolved.set(daySlotKey(day), chosen);
    else missingRoles.push(STRENGTH_ROLE_LABELS[day.role]);

    // ADR 0004 — dual-main-lift secondary resolution. Secondary slot
    // is required (not opt-in): if the day declares a secondaryRole,
    // a TM-backed secondary movement MUST resolve or the user gets
    // the same actionable error as a missing primary TM. Otherwise
    // the user silently loses the entire upper-body maintenance dose
    // that is the whole point of ADR 0004.
    if (day.secondaryCandidateSlugs && day.secondaryCandidateSlugs.length > 0) {
      const secondary = pickSecondaryStrengthMovement({
        candidateSlugs: day.secondaryCandidateSlugs,
        movementBySlug,
        tmMovementIds: new Set(tmByMovementId.keys()),
        tier: userTier,
      });
      if (secondary) {
        resolvedSecondary.set(daySlotKey(day), secondary);
      } else if (day.secondaryRole) {
        missingRoles.push(STRENGTH_ROLE_LABELS[day.secondaryRole]);
      }
    }
  }

  if (missingRoles.length > 0 && hasAnyTm) {
    return {
      ok: false,
      error: `No TM set for: ${missingRoles.join(", ")}. Go to Settings → Training maxes and add one for each.`,
    };
  }

  // Read profile-level limitations once for the whole block — picker
  // honours `blockedRegions` + `tendinopathyActive` on every day.
  const limitationsContext = await readLimitationsContext(supabase, userId);

  // Migration 0079 — elbow/forearm ATL ratio for the forearm
  // tendon-gate. Computed once per block-generation so we don't
  // re-query for every session. Fails open to 1.0 (no spike) when
  // history is missing.
  const userTimezoneForBlock = await getUserTimezone(userId);
  const elbowForearmAtlRatio = input.focusMuscles.includes("forearms")
    ? await getElbowForearmAtlRatio(supabase, userId, userTimezoneForBlock)
    : 1.0;

  // ADR 0012 — previous-block accessory recency, grouped by day-role, for
  // value-weighted block rotation. Read BEFORE inserting the new block so the
  // "most recent block" is the still-active prior block (the one we'll archive
  // at the very end). Only loaded when the archetype actually runs the dynamic
  // picker; empty otherwise (and for a user's first-ever block) → byte-identical
  // to pre-ADR-0012.
  const recencyByRole = archetype.accessoryProfile
    ? await getPreviousBlockAccessoryIdsByRole(supabase, userId)
    : new Map<string, Set<string>>();

  const ctx: BlockAssemblyContext = {
    archetype,
    activeDays,
    allowsTwoADays,
    resolved,
    resolvedSecondary,
    movementBySlug,
    pickerCatalog,
    userTier,
    warmupScheme,
    equipment,
    experience,
    limitationsContext,
    elbowForearmAtlRatio,
    recencyByRole,
    effortPreference,
    secondaryFocus,
    accessoryVolume,
    profileBodyweightKg: profile?.bodyweight_kg,
    bwAssessmentCompletedAt: profile?.bw_assessment_completed_at,
    preferredCardioModalities,
    goalModality,
    cardioCatalog,
    cardioCatalogBySlug,
    bwActive,
    hasAnyTm,
    bwByFamily,
    bwHasAnyFamily,
    cardioSource: input.cardioSource,
    cardioSourceName: input.cardioSourceName,
    powerEmphasis: input.powerEmphasis,
    focusMuscles: input.focusMuscles,
  };

  return { ok: true, ctx, meta: { hasAnyTm, bwHasAnyFamily } };
}
