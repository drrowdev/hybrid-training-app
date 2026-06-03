"use server";

/**
 * ADR 0024 addendum — live accessory-volume time estimates.
 *
 * A READ-ONLY preview action that prices a representative strength workout at
 * each accessory-volume level (Low / Medium / High) so the wizard can show the
 * user a realistic ballpark BEFORE they commit. It deliberately reuses the
 * exact engine path:
 *
 *   - `assemblePrescriptionItems` (the single source of truth for a day's
 *     ordered items, including the ADR 0020 duration-governor trim that already
 *     bounds the High level), and
 *   - `estimateSessionMinutes` (the same set-aware estimator the governor and
 *     the Plan / Preview screens use),
 *
 * so the number the user sees here equals the number the engine budgets to.
 *
 * It does NOT touch `createBlock` or any write path, so it carries zero
 * prescription-regression risk. Timing is LOAD-INDEPENDENT in this model (per-
 * set work is ~constant; rest is per-kind, not %TM-scaled), so the action skips
 * TM resolution, bodyweight-node hydration, cardio substitution and day
 * placement entirely and synthesizes a representative main lift — the set
 * COUNTS that drive duration come from the archetype week profile, not the
 * specific movement or its load.
 */

import { z } from "zod";
import type { DeclaredExperience } from "@hta/engine";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  ARCHETYPES,
  type Archetype,
  type ArchetypeId,
  type StrengthDay,
  daysForFrequency,
} from "./archetypes";
import { foldDualMainLifts } from "./main-lift-folding";
import { assemblePrescriptionItems } from "./assemble-prescription";
import { loadPickerCatalog } from "./picker-catalog";
import { resolveWarmupScheme } from "./warmups";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import { resolveEffortPreference } from "./effort-preference";
import { resolveSecondaryFocus } from "./secondary-focus";
import {
  resolveAccessoryVolumeLevel,
  type AccessoryVolumeLevel,
} from "./accessory-volume";
import { accessoryVolumeApplicability } from "./accessory-volume-recommendation";
import { readLimitationsContext } from "./limitations-context";
import { focusMusclesSchema } from "./focus-muscles";
import { estimateSessionMinutes } from "@/lib/sessions/estimate-duration";

const DECLARED_EXPERIENCE_VALUES: ReadonlySet<DeclaredExperience> = new Set([
  "beginner_lt_6m",
  "novice_6m_2y",
  "intermediate_2y_5y",
  "advanced_5y_10y",
  "highly_advanced_10y_plus",
]);

function resolveDeclaredExperience(
  raw: string | null | undefined,
): DeclaredExperience | null {
  if (!raw) return null;
  return DECLARED_EXPERIENCE_VALUES.has(raw as DeclaredExperience)
    ? (raw as DeclaredExperience)
    : null;
}

const REAL_ARCHETYPE_IDS = [
  "strength_anchor",
  "endurance_anchor",
  "rebuild",
  "hypertrophy_anchor",
  "concurrent_hybrid",
  "maintenance",
] as const;

const estimateInputSchema = z
  .object({
    archetype: z.enum(REAL_ARCHETYPE_IDS),
    daysPerWeek: z.number().int().min(1).max(14),
    secondaryFocus: z.string().nullish(),
    focusMuscles: z.array(z.string()).max(8).optional(),
    powerEmphasis: z.boolean().optional(),
  })
  .strict();

export type EstimateAccessoryVolumeInput = z.input<typeof estimateInputSchema>;

export type EstimateAccessoryVolumeResult =
  | { ok: false; error: string }
  | {
      ok: true;
      /** False when the archetype ships zero aesthetic accessories (Maintenance). */
      applicable: boolean;
      /** Estimated minutes for a representative strength workout at each level. */
      minutes: Record<AccessoryVolumeLevel, number | null>;
    };

/** Pick a full (non-deload) week so the estimate reflects a typical workout. */
function representativeWeek(archetype: Archetype): { weekIndex: number; scale: number } {
  let best = { weekIndex: 0, scale: 0 };
  for (let w = 0; w < archetype.weeks; w++) {
    const wp = archetype.weekProfiles.find((p) => p.weekIndex === w);
    const scale = wp?.strengthVolumeScale ?? 1.0;
    if (scale > best.scale) best = { weekIndex: w, scale };
  }
  return best.scale > 0 ? best : { weekIndex: 0, scale: 1.0 };
}

/**
 * Estimate a representative strength workout's duration (in minutes) at each
 * accessory-volume level for the given wizard selections. The level lever only
 * changes STRENGTH days, so the estimate is scoped to one — the first strength
 * day of the (folded) week, on a full week.
 */
export async function estimateAccessoryVolumeMinutes(
  input: EstimateAccessoryVolumeInput,
): Promise<EstimateAccessoryVolumeResult> {
  const parsed = estimateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid estimate request" };
  }

  const archetypeId = parsed.data.archetype as Exclude<ArchetypeId, "custom">;
  const archetype = ARCHETYPES[archetypeId];
  if (!archetype) return { ok: false, error: "Unknown archetype" };

  // Maintenance (and anything else shipping zero aesthetic accessories) — the
  // lever is inert, so there is nothing meaningful to compare. Report a single
  // representative number under every level so the disabled control can still
  // show a duration if desired.
  const applicability = accessoryVolumeApplicability(archetypeId);

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "warmup_scheme, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, training_experience, effort_preference",
    )
    .eq("id", user.id)
    .maybeSingle();

  const warmupScheme = resolveWarmupScheme(profile?.warmup_scheme);
  const equipment = resolveEquipment(profile);
  const experience = resolveDeclaredExperience(profile?.training_experience);
  const effortPreference = resolveEffortPreference(profile?.effort_preference);
  const secondaryFocus = resolveSecondaryFocus(parsed.data.secondaryFocus ?? null);
  const limitationsContext = await readLimitationsContext(supabase, user.id);

  const focusParse = focusMusclesSchema.safeParse(parsed.data.focusMuscles ?? []);
  const focusMuscles = focusParse.success ? focusParse.data : [];

  // The picker only runs when the archetype declares an accessoryProfile; load
  // the catalog so accessory COUNTS (and therefore the estimate) are realistic.
  let pickerCatalog = undefined as
    | Awaited<ReturnType<typeof loadPickerCatalog>>
    | undefined;
  if (archetype.accessoryProfile) {
    pickerCatalog = await loadPickerCatalog(supabase);
    if (pickerCatalog.length === 0) {
      return { ok: false, error: "Catalog load failed" };
    }
  }

  // Representative day: the first strength day of the folded week.
  const activeDays = foldDualMainLifts(
    archetype,
    daysForFrequency(archetype, parsed.data.daysPerWeek, false),
  );
  const day = activeDays.find((d): d is StrengthDay => d.kind === "strength");
  if (!day) {
    // No strength day at this frequency (pure-cardio shape) — nothing to price.
    return {
      ok: true,
      applicable: false,
      minutes: { low: null, medium: null, high: null },
    };
  }

  const { weekIndex, scale } = representativeWeek(archetype);

  // Synthesize the main lift(s): duration depends on set counts from the week
  // profile, not on which movement or its %TM, so a placeholder is faithful.
  const movement = { id: "preview-main", slug: "preview-main", displayName: "Main lift" };
  const secondaryMovement = day.secondaryRole
    ? { id: "preview-secondary", slug: "preview-secondary", displayName: "Secondary lift" }
    : undefined;
  const movementBySlug = new Map<
    string,
    { id: string; slug: string; display_name: string }
  >();
  const EMPTY_RECENCY = new Set<string>();

  const priceLevel = (level: AccessoryVolumeLevel): number | null => {
    const items = assemblePrescriptionItems(
      archetype,
      weekIndex,
      day,
      movement,
      undefined,
      movementBySlug,
      pickerCatalog,
      [],
      scale,
      parsed.data.powerEmphasis ?? false,
      warmupScheme,
      equipment,
      // Count a representative main lift so warm-ups + main sets are included.
      // (Load is irrelevant to timing; bodyweight blocks read as a close proxy.)
      false,
      experience,
      limitationsContext,
      secondaryMovement,
      focusMuscles,
      1.0,
      EMPTY_RECENCY,
      effortPreference,
      secondaryFocus,
      level,
    );
    return estimateSessionMinutes(items);
  };

  return {
    ok: true,
    applicable: applicability.enabled,
    minutes: {
      low: priceLevel("low"),
      medium: priceLevel("medium"),
      high: priceLevel("high"),
    },
  };
}
