"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prescription, PrescriptionItem } from "@hta/db";

/**
 * Wire shape for `planned_sessions` INSERTs via the Supabase REST API.
 *
 * PostgREST takes the literal JS keys you send and looks them up as
 * column names — it does NOT translate from Drizzle's camelCase property
 * names to the underlying snake_case DB columns. The Drizzle-derived
 * `NewPlannedSession` type uses camelCase (blockId, userId, weekIndex,
 * …) which PostgREST rejects with PGRST204 ("Could not find the
 * 'blockId' column of 'planned_sessions' in the schema cache").
 *
 * This type is intentionally typed against the *DB column names* so the
 * TypeScript compiler will reject any future drift back to camelCase.
 */
type PlannedSessionInsertRow = {
  block_id: string;
  user_id: string;
  week_index: number;
  day_index: number;
  slot: "single" | "am" | "pm";
  title: string;
  role: string;
  prescription: Prescription;
};
import { createClient } from "@/lib/supabase/server";
import {
  ARCHETYPES,
  type Archetype,
  type ArchetypeId,
  type DayTemplate,
  type StrengthDay,
  allCandidateLiftSlugs,
  buildPrescription,
  daysForFrequency,
  daySlotKey,
  minDaysForArchetype,
  requiredFixedSlugs,
  shouldIncludeAccessories,
  STRENGTH_ROLE_LABELS,
} from "./archetypes";
import { ACCESSORY_POOLS, allAccessorySlugs } from "./accessories";
import {
  pickAccessoriesForSession,
  type CatalogMovement,
  type WeekContextItem,
} from "./accessory-picker";
import type { BulletproofRole, FunctionalRole } from "./accessory-roles";
import {
  applyPowerClampToMainItems,
  archetypeSupportsPowerTransforms,
  buildPotentiationItem,
  pickPotentiationMovement,
} from "./power-emphasis-transform";

type DbMovement = {
  id: string;
  slug: string;
  display_name: string;
  primary_region: string;
  secondary_regions: string[] | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  is_compound: boolean;
  bulletproof_roles: string[] | null;
  functional_roles: string[] | null;
  is_supported: boolean;
  eccentric_load_score: number | null;
  stim_to_fatigue_score: number | null;
  high_strain_tendon: boolean;
};

function toCatalogMovement(m: DbMovement): CatalogMovement {
  return {
    id: m.id,
    slug: m.slug,
    displayName: m.display_name,
    primaryMuscles: m.primary_muscles ?? [],
    secondaryMuscles: m.secondary_muscles ?? [],
    primaryRegion: m.primary_region,
    secondaryRegions: m.secondary_regions ?? [],
    bulletproofRoles: (m.bulletproof_roles ?? []) as BulletproofRole[],
    functionalRoles: (m.functional_roles ?? []) as FunctionalRole[],
    isSupported: m.is_supported,
    isCompound: m.is_compound,
    eccentricLoadScore: m.eccentric_load_score,
    stimToFatigueScore: m.stim_to_fatigue_score,
    highStrainTendon: m.high_strain_tendon,
  };
}

/** Default per-muscle weekly target (MV-floor for trained lifter, Schoenfeld 2017). */
const DEFAULT_MUSCLE_TARGET = 6;
const AESTHETIC_TARGET_MUSCLES = [
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps",
  "calves",
  "abs",
  "upper_chest",
  "lats",
  "mid_back",
  "hamstrings",
  "forearms",
];

function defaultMuscleTargets(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of AESTHETIC_TARGET_MUSCLES) out[m] = DEFAULT_MUSCLE_TARGET;
  return out;
}

/**
 * Helper: assemble the day's prescription items, optionally appending the
 * curated accessory pool when the archetype + day allow it. Centralised so
 * createBlock and createCustomBlock stay in lockstep.
 *
 * When the archetype declares an `accessoryProfile`, the dynamic picker is
 * used (lib/planner/accessory-picker.ts). Otherwise we fall back to the
 * legacy static `ACCESSORY_POOLS` for backward compatibility.
 */
function assemblePrescriptionItems(
  archetype: Archetype,
  weekIndex: number,
  day: DayTemplate,
  movement: { id: string; slug: string; displayName: string },
  finisherMovement: { id: string; slug: string; displayName: string } | undefined,
  movementBySlug: Map<string, { id: string; slug: string; display_name: string }>,
  /** Full catalog for the picker. Optional for backward-compat callers. */
  catalog?: CatalogMovement[],
  /** Rolling per-week context — updated by caller in place. */
  weekContext?: WeekContextItem[],
  /** Week deload scalar from the archetype's week profile. */
  weekDeloadScale: number = 1.0,
  /** Wizard "Add power emphasis" toggle — persisted on `training_blocks.power_emphasis`. */
  powerEmphasis: boolean = false,
): PrescriptionItem[] {
  const items = buildPrescription(archetype, weekIndex, day, movement, finisherMovement);
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

  // Dynamic picker path.
  if (archetype.accessoryProfile && catalog && weekContext) {
    const picks = pickAccessoriesForSession({
      profile: archetype.accessoryProfile,
      weekDeloadScale,
      catalog,
      weekContext,
      filters: {
        blockedRegions: new Set(),
        concurrentStressActive: false, // wired in a follow-up pass
        recentlyUsedMovementIds: new Set(),
        tendinopathyActive: false,
      },
      perMuscleTargets: defaultMuscleTargets(),
      maxItems: archetype.accessoryProfile.aesthetic.itemsPerSession + 4, // small budget for durability + functional fills
      powerEmphasis,
    });
    for (const p of picks) {
      items.push({
        movementId: p.movementId,
        movementSlug: p.slug,
        movementName: p.displayName,
        kind: "accessory",
        sets: p.sets,
        reps: p.reps,
        intensityLabel: p.reason,
        notes: p.rationale,
      });
      const catalogEntry = catalog.find((c) => c.id === p.movementId);
      if (catalogEntry) {
        weekContext.push({
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
        blockedRegions: new Set(),
        tendinopathyActive: false,
        recentlyUsedMovementIds: new Set(),
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
      items.push({
        movementId: mv.id,
        movementSlug: mv.slug,
        movementName: mv.display_name,
        kind: "accessory",
        sets: a.sets,
        reps: parseInt(a.reps, 10),
        intensityLabel: a.muscleTarget,
        notes: a.rationale,
      });
    }
  }
  return items;
}

const createBlockSchema = z.object({
  archetype: z.enum([
    "strength_anchor",
    "endurance_anchor",
    "rebuild",
    "hypertrophy_anchor",
    "concurrent_hybrid",
    "maintenance",
  ] satisfies [ArchetypeId, ...ArchetypeId[]]),
  startedOn: z.string().date(),
  daysPerWeek: z.coerce.number().int().min(1).max(7),
  /**
   * Optional JSON-stringified ``{ days: number[], twoADay: boolean }`` from
   * the block wizard's "Lay out your week" step. Persisted on the block row
   * so re-runs honour the user's calendar layout.
   */
  dayIndexOverrides: z.string().optional(),
  /**
   * Wizard "Add power emphasis" toggle (step 2). Optional + coerced from
   * FormData ("true" / "false" / "on" / undefined). When omitted or
   * falsy the block is created with power_emphasis = false.
   */
  powerEmphasis: z
    .union([z.literal("true"), z.literal("false"), z.literal("on"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true" || v === "on"),
});

export type CreateBlockResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Create a new block from the wizard input. Returns a result object so the
 * client wizard can surface the failure reason inline instead of crashing
 * the whole page.
 */
export async function createBlock(formData: FormData): Promise<CreateBlockResult> {
  const parsed = createBlockSchema.safeParse({
    archetype: formData.get("archetype"),
    startedOn: formData.get("startedOn"),
    daysPerWeek: formData.get("daysPerWeek"),
    dayIndexOverrides: formData.get("dayIndexOverrides") ?? undefined,
    powerEmphasis: formData.get("powerEmphasis") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Parse + validate the dayIndexOverrides JSON payload (wizard step 5).
  let dayIndexOverrides: { days: number[]; twoADay: boolean } | null = null;
  if (parsed.data.dayIndexOverrides) {
    try {
      const raw = JSON.parse(parsed.data.dayIndexOverrides) as {
        days?: unknown;
        twoADay?: unknown;
      };
      if (
        Array.isArray(raw.days) &&
        raw.days.every((d): d is number => typeof d === "number" && d >= 0 && d <= 6) &&
        typeof raw.twoADay === "boolean"
      ) {
        dayIndexOverrides = { days: raw.days as number[], twoADay: raw.twoADay };
      }
    } catch {
      // Bad JSON — silently drop; the block can still be created without overrides.
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const archetype = ARCHETYPES[parsed.data.archetype];
  if (!archetype) return { ok: false, error: "Unknown archetype" };

  // Look up the user's two-a-day preference so we pick the right day pool.
  const { data: profile } = await supabase
    .from("profiles")
    .select("allows_two_a_days")
    .eq("id", user.id)
    .maybeSingle();
  const allowsTwoADays = Boolean(profile?.allows_two_a_days ?? false);

  const minDays = minDaysForArchetype(archetype, allowsTwoADays);
  if (parsed.data.daysPerWeek < minDays) {
    return {
      ok: false,
      error: `${archetype.name} needs at least ${minDays} training days/week.`,
    };
  }
  const activeDays = daysForFrequency(archetype, parsed.data.daysPerWeek, allowsTwoADays);

  const candidateSlugs = allCandidateLiftSlugs(archetype);
  const fixedSlugs = requiredFixedSlugs(archetype);
  const accessorySlugs = allAccessorySlugs();
  const allSlugs = Array.from(new Set([...candidateSlugs, ...fixedSlugs, ...accessorySlugs]));

  const { data: movements, error: mvErr } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .in("slug", allSlugs)
    .is("user_id", null);
  if (mvErr) return { ok: false, error: `Movement lookup failed: ${mvErr.message}` };

  const movementBySlug = new Map((movements ?? []).map((m) => [m.slug, m]));

  // Picker catalog — full global catalog with role tags. Loaded only when
  // the archetype has an accessoryProfile so legacy archetypes pay nothing.
  let pickerCatalog: CatalogMovement[] = [];
  if (archetype.accessoryProfile) {
    const { data: full, error: catErr } = await supabase
      .from("movements")
      .select(
        "id, slug, display_name, primary_region, secondary_regions, primary_muscles, secondary_muscles, is_compound, bulletproof_roles, functional_roles, is_supported, eccentric_load_score, stim_to_fatigue_score, high_strain_tendon",
      )
      .is("user_id", null);
    if (catErr) return { ok: false, error: `Catalog load failed: ${catErr.message}` };
    pickerCatalog = (full as DbMovement[]).map(toCatalogMovement);
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

  const resolved = new Map<string, { movementId: string; slug: string; displayName: string }>();
  const missingRoles: string[] = [];

  for (const day of activeDays) {
    if (day.kind !== "strength") continue;
    let chosen: { movementId: string; slug: string; displayName: string } | null = null;
    for (const slug of day.candidateSlugs) {
      const mv = movementBySlug.get(slug);
      if (mv && tmByMovementId.has(mv.id)) {
        chosen = { movementId: mv.id, slug: mv.slug, displayName: mv.display_name };
        break;
      }
    }
    if (chosen) resolved.set(daySlotKey(day), chosen);
    else missingRoles.push(STRENGTH_ROLE_LABELS[day.role]);
  }

  if (missingRoles.length > 0) {
    return {
      ok: false,
      error: `No TM set for: ${missingRoles.join(", ")}. Go to Settings → Training maxes and add one for each.`,
    };
  }

  const { error: archErr } = await supabase
    .from("training_blocks")
    .update({ status: "archived" })
    .eq("user_id", user.id)
    .eq("status", "active");
  if (archErr) return { ok: false, error: `Couldn't archive prior block: ${archErr.message}` };

  const { data: block, error: blockErr } = await supabase
    .from("training_blocks")
    .insert({
      user_id: user.id,
      archetype: archetype.id,
      started_on: parsed.data.startedOn,
      weeks: archetype.weeks,
      status: "active",
      days_per_week: parsed.data.daysPerWeek,
      day_index_overrides: dayIndexOverrides,
      power_emphasis: parsed.data.powerEmphasis,
    })
    .select("id")
    .single();

  if (blockErr || !block) {
    return { ok: false, error: blockErr?.message ?? "Failed to create block" };
  }

  const rows: PlannedSessionInsertRow[] = [];
  for (let week = 0; week < archetype.weeks; week++) {
    const weekProfile = archetype.weekProfiles.find((w) => w.weekIndex === week);
    const weekDeloadScale = weekProfile?.strengthVolumeScale ?? 1.0;
    const weekContext: WeekContextItem[] = [];
    for (const day of activeDays) {
      let movement: { id: string; slug: string; displayName: string };
      let finisherMovement: { id: string; slug: string; displayName: string } | undefined;

      if (day.kind === "strength") {
        const resolvedMv = resolved.get(daySlotKey(day));
        if (!resolvedMv) continue;
        movement = { id: resolvedMv.movementId, slug: resolvedMv.slug, displayName: resolvedMv.displayName };
      } else if (day.kind === "cardio") {
        const mv = movementBySlug.get(day.movementSlug);
        if (!mv) continue;
        movement = { id: mv.id, slug: mv.slug, displayName: mv.display_name };
        if (day.finisher) {
          const fin = movementBySlug.get(day.finisher.movementSlug);
          if (fin) finisherMovement = { id: fin.id, slug: fin.slug, displayName: fin.display_name };
        }
      } else {
        // tendon
        const mv = movementBySlug.get(day.movementSlug);
        if (!mv) continue;
        movement = { id: mv.id, slug: mv.slug, displayName: mv.display_name };
      }

      const items = assemblePrescriptionItems(
        archetype,
        week,
        day,
        movement,
        finisherMovement,
        movementBySlug,
        pickerCatalog,
        weekContext,
        weekDeloadScale,
        parsed.data.powerEmphasis,
      );
      const prescription: Prescription = { items };
      const isDeload = weekProfile?.intensityLabel === "Deload";

      let title = day.title;
      if (day.kind === "strength") {
        title = `${movement.displayName}${isDeload ? " (deload)" : ""}`;
      } else if (isDeload) {
        title = `${day.title} (deload)`;
      }

      rows.push({
        block_id: block.id,
        user_id: user.id,
        week_index: week,
        day_index: day.dayIndex,
        slot: day.slot ?? "single",
        title,
        role: day.role,
        prescription,
      });
    }
  }

  const { error: psErr } = await supabase.from("planned_sessions").insert(rows);
  if (psErr) {
    // Roll back the block we just created so we don't leave a zombie.
    await supabase.from("training_blocks").delete().eq("id", block.id);
    return { ok: false, error: `Couldn't create planned sessions: ${psErr.message}` };
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  return { ok: true };
}

// ─── Custom block ──────────────────────────────────────────────────

const customDayKindEnum = z.enum([
  "rest",
  "strength_squat",
  "strength_horizontal_press",
  "strength_deadlift",
  "strength_vertical_press",
  "cardio_z2_short",
  "cardio_z2_long",
  "cardio_z2_long_plus_alactic",
  "cardio_vo2",
  "cardio_alactic",
  "tendon_hsr_knee",
  "tendon_hsr_hinge",
]);

const customInputSchema = z.object({
  name: z.string().trim().max(80).optional(),
  weeks: z.coerce.number().int().min(2).max(8),
  startedOn: z.string().date(),
  waveTemplate: z.enum(["fives", "threes", "peaking_wave", "hypertrophy", "maintenance", "rebuild_flat"]),
  days: z
    .array(
      z.object({
        dayIndex: z.coerce.number().int().min(0).max(6),
        slot: z.enum(["am", "pm", "single"]).optional(),
        kind: customDayKindEnum,
        durationMinOverride: z.coerce.number().int().min(5).max(240).optional(),
      }),
    )
    .min(1)
    .max(14),
});

/**
 * Create a block from a user-built custom archetype.
 *
 * Compiles the input into the same Archetype shape curated presets use,
 * then runs the standard buildPrescription pipeline. Stores
 * archetype = "custom" and the user-supplied name in the notes column.
 */
export async function createCustomBlock(formData: FormData): Promise<CreateBlockResult> {
  // The builder posts a JSON-encoded config in the "config" field.
  const configRaw = formData.get("config");
  if (typeof configRaw !== "string") return { ok: false, error: "Missing config payload" };

  let configJson: unknown;
  try {
    configJson = JSON.parse(configRaw);
  } catch (e) {
    return { ok: false, error: `Invalid config JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  const parsed = customInputSchema.safeParse(configJson);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid custom block config" };
  }

  // Defer to the compiler to convert the input into an Archetype.
  const { compileCustomArchetype, customInputMinDays } = await import("./custom");
  const daysPerWeek = customInputMinDays({ ...parsed.data, daysPerWeek: 0 });
  const archetype = compileCustomArchetype({ ...parsed.data, daysPerWeek });

  if (daysPerWeek < 1) {
    return { ok: false, error: "Pick at least one non-rest day." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve all required movements.
  const candidateSlugs = allCandidateLiftSlugs(archetype);
  const fixedSlugs = requiredFixedSlugs(archetype);
  const accessorySlugs = allAccessorySlugs();
  const allSlugs = Array.from(new Set([...candidateSlugs, ...fixedSlugs, ...accessorySlugs]));

  const { data: movements, error: mvErr } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .in("slug", allSlugs)
    .is("user_id", null);
  if (mvErr) return { ok: false, error: `Movement lookup failed: ${mvErr.message}` };

  const movementBySlug = new Map((movements ?? []).map((m) => [m.slug, m]));

  const missingFixed = fixedSlugs.filter((s) => !movementBySlug.has(s));
  if (missingFixed.length > 0) {
    return {
      ok: false,
      error: `Catalog is missing required movements: ${missingFixed.join(", ")}.`,
    };
  }

  // Resolve strength roles → user variants via TM.
  const candidateMovementIds = candidateSlugs
    .map((s) => movementBySlug.get(s)?.id)
    .filter((id): id is string => !!id);
  const { data: tms, error: tmErr } = await supabase
    .from("training_maxes")
    .select("movement_id")
    .in("movement_id", candidateMovementIds);
  if (tmErr) return { ok: false, error: `TM lookup failed: ${tmErr.message}` };
  const tmMovementIds = new Set((tms ?? []).map((r) => r.movement_id));

  const resolved = new Map<string, { movementId: string; slug: string; displayName: string }>();
  const missingRoles: string[] = [];
  for (const day of archetype.days) {
    if (day.kind !== "strength") continue;
    let chosen: { movementId: string; slug: string; displayName: string } | null = null;
    for (const slug of day.candidateSlugs) {
      const mv = movementBySlug.get(slug);
      if (mv && tmMovementIds.has(mv.id)) {
        chosen = { movementId: mv.id, slug: mv.slug, displayName: mv.display_name };
        break;
      }
    }
    if (chosen) resolved.set(daySlotKey(day), chosen);
    else missingRoles.push(STRENGTH_ROLE_LABELS[day.role]);
  }
  if (missingRoles.length > 0) {
    return {
      ok: false,
      error: `No TM set for: ${missingRoles.join(", ")}. Go to Settings → Training maxes and add one for each.`,
    };
  }

  await supabase
    .from("training_blocks")
    .update({ status: "archived" })
    .eq("user_id", user.id)
    .eq("status", "active");

  const { data: block, error: blockErr } = await supabase
    .from("training_blocks")
    .insert({
      user_id: user.id,
      archetype: "custom",
      started_on: parsed.data.startedOn,
      weeks: archetype.weeks,
      status: "active",
      days_per_week: daysPerWeek,
      notes: archetype.name,
    })
    .select("id")
    .single();
  if (blockErr || !block) return { ok: false, error: blockErr?.message ?? "Failed to create block" };

  const rows: PlannedSessionInsertRow[] = [];
  for (let week = 0; week < archetype.weeks; week++) {
    for (const day of archetype.days) {
      let movement: { id: string; slug: string; displayName: string };
      let finisherMovement: { id: string; slug: string; displayName: string } | undefined;

      if (day.kind === "strength") {
        const resolvedMv = resolved.get(daySlotKey(day));
        if (!resolvedMv) continue;
        movement = { id: resolvedMv.movementId, slug: resolvedMv.slug, displayName: resolvedMv.displayName };
      } else if (day.kind === "cardio") {
        const mv = movementBySlug.get(day.movementSlug);
        if (!mv) continue;
        movement = { id: mv.id, slug: mv.slug, displayName: mv.display_name };
        if (day.finisher) {
          const fin = movementBySlug.get(day.finisher.movementSlug);
          if (fin) finisherMovement = { id: fin.id, slug: fin.slug, displayName: fin.display_name };
        }
      } else {
        const mv = movementBySlug.get(day.movementSlug);
        if (!mv) continue;
        movement = { id: mv.id, slug: mv.slug, displayName: mv.display_name };
      }

      const items = assemblePrescriptionItems(archetype, week, day, movement, finisherMovement, movementBySlug);
      const prescription: Prescription = { items };
      const isDeload = archetype.weekProfiles.find((w) => w.weekIndex === week)?.intensityLabel === "Deload";

      let title = day.title;
      if (day.kind === "strength") {
        title = `${movement.displayName}${isDeload ? " (deload)" : ""}`;
      } else if (isDeload) {
        title = `${day.title} (deload)`;
      }

      rows.push({
        block_id: block.id,
        user_id: user.id,
        week_index: week,
        day_index: day.dayIndex,
        slot: day.slot ?? "single",
        title,
        role: day.role,
        prescription,
      });
    }
  }

  const { error: psErr } = await supabase.from("planned_sessions").insert(rows);
  if (psErr) {
    await supabase.from("training_blocks").delete().eq("id", block.id);
    return { ok: false, error: `Couldn't create planned sessions: ${psErr.message}` };
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  return { ok: true };
}

const blockIdSchema = z.object({ id: z.string().uuid() });

export async function endBlock(formData: FormData): Promise<void> {
  const parsed = blockIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  await supabase
    .from("training_blocks")
    .update({ status: "archived" })
    .eq("id", parsed.data.id);
  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const skipSchema = z.object({ id: z.string().uuid() });

export async function skipPlannedSession(formData: FormData): Promise<void> {
  const parsed = skipSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("planned_sessions")
    .update({ skipped_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  revalidatePath("/app");
  revalidatePath("/app/plan");
}

export async function unskipPlannedSession(formData: FormData): Promise<void> {
  const parsed = skipSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("planned_sessions")
    .update({ skipped_at: null })
    .eq("id", parsed.data.id);
  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const setPlannedTimeSchema = z.object({
  id: z.string().uuid(),
  hhmm: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm"),
});

/**
 * Set an explicit planned_at on a planned_session. Computes the UTC instant
 * from the user's profile timezone + the day's calendar date + the HH:mm
 * the user entered. Empty / cleared input is treated as null (revert to
 * profile window default).
 */
export async function setPlannedTime(formData: FormData): Promise<void> {
  const raw = {
    id: formData.get("id"),
    hhmm: formData.get("hhmm"),
  };
  // Empty time field clears the override.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const idValid = typeof raw.id === "string" && /^[0-9a-f-]{36}$/i.test(raw.id);
  if (!idValid) return;
  const id = raw.id as string;

  if (!raw.hhmm || raw.hhmm === "") {
    await supabase
      .from("planned_sessions")
      .update({ planned_at: null })
      .eq("id", id)
      .eq("user_id", user.id);
    revalidatePath("/app");
    revalidatePath("/app/plan");
    return;
  }

  const parsed = setPlannedTimeSchema.safeParse(raw);
  if (!parsed.success) return;

  // Look up the planned session + its block to compute the day's date.
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, week_index, day_index, block_id")
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!planned) return;

  const { data: block } = await supabase
    .from("training_blocks")
    .select("started_on")
    .eq("id", planned.block_id)
    .maybeSingle();
  if (!block) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const tz = profile?.timezone ?? "UTC";

  // Compute the calendar date this slot falls on.
  const { dayDate } = await import("./queries");
  const date = dayDate(block.started_on, planned.week_index, planned.day_index);
  const { localTimeToUTC } = await import("./time-of-day");
  const utc = localTimeToUTC(date, parsed.data.hhmm, tz);

  await supabase
    .from("planned_sessions")
    .update({ planned_at: utc.toISOString() })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);

  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const startPlannedSchema = z.object({ id: z.string().uuid() });

/**
 * Start a real session from a planned slot.
 *
 * Creates a sessions row pre-populated with the planned title + a set_log
 * stub per prescription item (no weights yet — user logs them as actual sets),
 * and links it back to the planned_session.
 */
export async function startSessionFromPlan(formData: FormData): Promise<void> {
  const parsed = startPlannedSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) throw new Error("Invalid planned session id");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, title, slot, planned_at, prescription, completed_session_id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!planned) throw new Error("Planned session not found");

  // Reuse the existing linked session if any.
  if (planned.completed_session_id) {
    redirect(`/app/sessions/${planned.completed_session_id}`);
  }

  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      title: planned.title,
      slot: planned.slot ?? "single",
      planned_at: planned.planned_at,
    })
    .select("id")
    .single();

  if (sessErr || !session) throw new Error(sessErr?.message ?? "Failed to start session");

  await supabase
    .from("planned_sessions")
    .update({ completed_session_id: session.id })
    .eq("id", planned.id);

  revalidatePath("/app");
  revalidatePath("/app/plan");
  redirect(`/app/sessions/${session.id}`);
}

const startCheckInSchema = z.object({
  id: z.string().uuid(),
  fatigue: z.coerce.number().int().min(1).max(5).optional(),
  soreness: z.coerce.number().int().min(1).max(5).optional(),
  notes: z.string().trim().max(280).optional().nullable(),
});

/**
 * Start a planned session WITH a pre-session check-in.
 *
 * Same flow as startSessionFromPlan but additionally writes the DC-P1
 * sliders onto the new sessions row. When fatigue / soreness are absent
 * (user clicked Skip), persists null so the GRM falls back to 1.00 and
 * downstream analytics knows the check-in was skipped.
 */
export async function startCheckInSession(formData: FormData): Promise<void> {
  const parsed = startCheckInSchema.safeParse({
    id: formData.get("id"),
    fatigue: formData.get("fatigue") || undefined,
    soreness: formData.get("soreness") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid check-in");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, title, slot, planned_at, completed_session_id")
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!planned) throw new Error("Planned session not found");

  // Reuse the existing linked session if any (idempotent re-entry).
  if (planned.completed_session_id) {
    redirect(`/app/sessions/${planned.completed_session_id}`);
  }

  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      title: planned.title,
      slot: planned.slot ?? "single",
      planned_at: planned.planned_at,
      fatigue: parsed.data.fatigue ?? null,
      soreness: parsed.data.soreness ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single();

  if (sessErr || !session) throw new Error(sessErr?.message ?? "Failed to start session");

  await supabase
    .from("planned_sessions")
    .update({ completed_session_id: session.id })
    .eq("id", planned.id);

  revalidatePath("/app");
  revalidatePath("/app/plan");
  redirect(`/app/sessions/${session.id}`);
}
