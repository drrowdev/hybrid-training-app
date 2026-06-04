/**
 * Quick strength generator — server-side resolver (deterministic v1).
 *
 * Gathers the same engine context `createBlock` uses (archetype, movements,
 * TMs, picker catalog, limitations, equipment, experience), reads the user's
 * 16-muscle freshness, routes the session to the freshest strength pattern, and
 * returns a built `PrescriptionItem[]` for a single off-plan strength session.
 *
 * Read-only: performs no writes. The thin server action
 * (`generateQuickStrengthSession`) calls this, then materialises the result
 * into a session row + set_logs. Kept separate so the action stays small and
 * this resolver is independently reviewable.
 *
 * RLS: every query is scoped to the passed `userId` AND runs through the
 * user-scoped Supabase client the caller hands in (never service-role).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrescriptionItem } from "@hta/db";
import type { DeclaredExperience } from "@hta/engine";
import {
  ARCHETYPES,
  STRENGTH_ROLE_LABELS,
  type Archetype,
  type ArchetypeId,
  type StrengthDay,
  type StrengthRole,
} from "./archetypes";
import { declaredExperienceToTier, tierInBand } from "./experience-tier";
import { loadPickerCatalog } from "./picker-catalog";
import {
  readLimitationsContext,
  type LimitationsContext,
} from "./limitations-context";
import { resolveWarmupScheme } from "./warmups";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import { resolveSecondaryFocus } from "./secondary-focus";
import { resolveAccessoryVolumeLevel } from "./accessory-volume";
import { resolveEffortPreference } from "./effort-preference";
import type { FocusMuscle } from "./focus-muscles";
import {
  assembleQuickStrengthItems,
  pickFreshestStrengthRole,
  type QuickLength,
} from "./quick-generate";
import { getMuscleFreshness } from "@/lib/muscle/muscle-freshness";
import type { MuscleGroup } from "@/lib/muscle/muscle-groups";
import type { MuscleFreshnessBand } from "@/lib/muscle/muscle-freshness";

type StrengthMovementRow = {
  id: string;
  slug: string;
  display_name: string;
  experience_min: number | null;
  experience_max: number | null;
};

type ResolvedMain = {
  day: StrengthDay;
  movement: { id: string; slug: string; displayName: string };
  /** True when no TM exists for the lift — main items are skipped. */
  omitMainStrength: boolean;
};

export type QuickPlanResult =
  | {
      ok: true;
      items: PrescriptionItem[];
      /** value_kg per movement, for the action's %TM → weight materialisation. */
      tmByMovementId: Map<string, number>;
      title: string;
      role: StrengthRole;
    }
  | { ok: false; error: string };

/** Off-plan archetype context resolved from the active (or most recent) block. */
type BlockContext = {
  archetypeId: Exclude<ArchetypeId, "custom">;
  focusMuscles: readonly FocusMuscle[];
  secondaryFocusRaw: string | null;
  accessoryVolumeRaw: string | null;
};

async function resolveBlockContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<BlockContext> {
  // Active block first; if the user is between blocks, fall back to their most
  // recent block (any status) so "archetype priorities" stay honest off-plan.
  const { data: rows } = await supabase
    .from("training_blocks")
    .select("archetype, focus_muscles, secondary_focus, accessory_volume, status, started_on")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("started_on", { ascending: false })
    .limit(10);

  const active = (rows ?? []).find((r) => r.status === "active");
  const chosen = active ?? (rows ?? [])[0];

  const rawArchetype = (chosen?.archetype as string | undefined) ?? "strength_anchor";
  const archetypeId: Exclude<ArchetypeId, "custom"> =
    rawArchetype !== "custom" && rawArchetype in ARCHETYPES
      ? (rawArchetype as Exclude<ArchetypeId, "custom">)
      : "strength_anchor";

  return {
    archetypeId,
    focusMuscles: Array.isArray(chosen?.focus_muscles)
      ? (chosen!.focus_muscles as FocusMuscle[])
      : [],
    secondaryFocusRaw: (chosen?.secondary_focus as string | null) ?? null,
    accessoryVolumeRaw: (chosen?.accessory_volume as string | null) ?? null,
  };
}

/**
 * Resolve a strength day's main lift: the first candidate slug that has a TM
 * within the user's experience band, then the first candidate with any TM, then
 * (no TM anywhere) the first candidate present in the catalog with main lifts
 * omitted. Returns null only when no candidate slug resolves to a movement row.
 */
function resolveMainForDay(
  day: StrengthDay,
  movementBySlug: Map<string, StrengthMovementRow>,
  tmByMovementId: Map<string, number>,
  tier: number | null,
): ResolvedMain | null {
  let firstWithTm: StrengthMovementRow | null = null;
  let firstPresent: StrengthMovementRow | null = null;
  for (const slug of day.candidateSlugs) {
    const mv = movementBySlug.get(slug);
    if (!mv) continue;
    if (!firstPresent) firstPresent = mv;
    const hasTm = tmByMovementId.has(mv.id);
    if (hasTm && !firstWithTm) firstWithTm = mv;
    if (
      hasTm &&
      tierInBand(tier, mv.experience_min ?? 0, mv.experience_max ?? 4)
    ) {
      return {
        day,
        movement: { id: mv.id, slug: mv.slug, displayName: mv.display_name },
        omitMainStrength: false,
      };
    }
  }
  if (firstWithTm) {
    return {
      day,
      movement: {
        id: firstWithTm.id,
        slug: firstWithTm.slug,
        displayName: firstWithTm.display_name,
      },
      omitMainStrength: false,
    };
  }
  if (firstPresent) {
    return {
      day,
      movement: {
        id: firstPresent.id,
        slug: firstPresent.slug,
        displayName: firstPresent.display_name,
      },
      omitMainStrength: true,
    };
  }
  return null;
}

export async function resolveQuickStrengthPlan(
  supabase: SupabaseClient,
  userId: string,
  opts: { length: QuickLength; tz?: string },
): Promise<QuickPlanResult> {
  const ctx = await resolveBlockContext(supabase, userId);
  const archetype: Archetype = ARCHETYPES[ctx.archetypeId];

  const strengthDays = archetype.days.filter(
    (d): d is StrengthDay => d.kind === "strength",
  );
  if (strengthDays.length === 0) {
    return { ok: false, error: "This archetype has no strength day to generate." };
  }

  // Profile-derived engine inputs.
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "warmup_scheme, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, bw_assessment_completed_at, bodyweight_kg, training_experience, effort_preference",
    )
    .eq("id", userId)
    .maybeSingle();

  const warmupScheme = resolveWarmupScheme(profile?.warmup_scheme);
  const equipment = resolveEquipment(profile ?? undefined);
  const experience: DeclaredExperience | null =
    profile?.training_experience != null &&
    declaredExperienceToTier(profile.training_experience as DeclaredExperience) != null
      ? (profile.training_experience as DeclaredExperience)
      : null;
  const effortPreference = resolveEffortPreference(profile?.effort_preference);
  const tier = declaredExperienceToTier(experience);

  // Movement catalog + TMs for the strength-day candidate lifts.
  const candidateSlugs = Array.from(
    new Set(strengthDays.flatMap((d) => d.candidateSlugs)),
  );
  const { data: movements, error: mvErr } = await supabase
    .from("movements")
    .select("id, slug, display_name, experience_min, experience_max")
    .in("slug", candidateSlugs)
    .is("user_id", null);
  if (mvErr) return { ok: false, error: `Movement lookup failed: ${mvErr.message}` };

  const movementBySlug = new Map(
    (movements ?? []).map((m) => [m.slug, m as StrengthMovementRow]),
  );
  const candidateMovementIds = (movements ?? []).map((m) => m.id);

  const { data: tms, error: tmErr } = await supabase
    .from("training_maxes")
    .select("movement_id, value_kg")
    .eq("user_id", userId)
    .in("movement_id", candidateMovementIds);
  if (tmErr) return { ok: false, error: `TM lookup failed: ${tmErr.message}` };

  const tmByMovementId = new Map<string, number>();
  for (const row of tms ?? []) {
    const v = Number(row.value_kg);
    if (Number.isFinite(v) && v > 0) tmByMovementId.set(row.movement_id as string, v);
  }

  // Resolve a buildable main lift per strength role, in archetype day order.
  const resolvableByRole = new Map<StrengthRole, ResolvedMain>();
  for (const day of strengthDays) {
    if (resolvableByRole.has(day.role)) continue;
    const resolved = resolveMainForDay(day, movementBySlug, tmByMovementId, tier);
    if (resolved) resolvableByRole.set(day.role, resolved);
  }
  if (resolvableByRole.size === 0) {
    return { ok: false, error: "No main lift could be resolved from the catalog." };
  }

  // Freshness → pick the freshest resolvable pattern.
  const freshnessRows = await getMuscleFreshness(supabase, userId, {
    tz: opts.tz,
  });
  const freshnessByGroup = new Map<MuscleGroup, MuscleFreshnessBand>(
    freshnessRows.map((r) => [r.muscle, r.band]),
  );
  const orderedRoles = strengthDays
    .map((d) => d.role)
    .filter((role) => resolvableByRole.has(role));
  const role = pickFreshestStrengthRole(orderedRoles, freshnessByGroup);
  if (!role) {
    return { ok: false, error: "Could not select a training pattern." };
  }
  const chosen = resolvableByRole.get(role)!;

  // Accessory catalog + limitations.
  let catalog = undefined as Awaited<ReturnType<typeof loadPickerCatalog>> | undefined;
  if (archetype.accessoryProfile) {
    catalog = await loadPickerCatalog(supabase);
    if (!catalog || catalog.length === 0) {
      return { ok: false, error: "Accessory catalog load failed." };
    }
  }
  const limitationsContext: LimitationsContext = await readLimitationsContext(
    supabase,
    userId,
  );

  const items = assembleQuickStrengthItems({
    archetype,
    day: chosen.day,
    movement: chosen.movement,
    movementBySlug: movementBySlug as unknown as Map<
      string,
      { id: string; slug: string; display_name: string }
    >,
    catalog,
    warmupScheme,
    equipment,
    omitMainStrength: chosen.omitMainStrength,
    experience,
    limitationsContext,
    focusMuscles: ctx.focusMuscles,
    effortPreference,
    secondaryFocus: resolveSecondaryFocus(ctx.secondaryFocusRaw),
    accessoryVolume: resolveAccessoryVolumeLevel(ctx.accessoryVolumeRaw),
    freshnessByGroup,
    length: opts.length,
  });

  if (items.length === 0) {
    return { ok: false, error: "Generated session was empty." };
  }

  return {
    ok: true,
    items,
    tmByMovementId,
    title: `Quick workout · ${STRENGTH_ROLE_LABELS[role]}`,
    role,
  };
}
