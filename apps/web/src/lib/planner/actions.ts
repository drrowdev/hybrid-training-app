"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prescription } from "@hta/db";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { todayYmd, ymdToUtc, daysBetweenYmd } from "@/lib/dates";
import { getUserTimezone } from "./queries";
import {
  type CardioDay,
  allCandidateLiftSlugs,
  daySlotKey,
  deloadCardioPlan,
  cardioProgressionPlan,
  requiredFixedSlugs,  resolveCardioSlugForTier,
  STRENGTH_ROLE_LABELS,
} from "./archetypes";
import { allAccessorySlugs } from "./accessories";
import { foldDualMainLifts } from "./main-lift-folding";
import { assemblePrescriptionItems } from "./assemble-prescription";
import { expandPrescriptionSetItems } from "./expand-prescription-sets";
import { swapPlannedSessions } from "./swap";
import { recordOverrideEvent } from "@/lib/engine/overrides";
import {
  readLimitationsContext,
} from "./limitations-context";
import { loadCardioCatalog } from "./cardio-catalog";
import {
  resolvePreferredCardioModality,
  sanitizePreferredModalities,
} from "./preferred-cardio-modality";
import { declaredExperienceToTier } from "./experience-tier";
import {
  resolveWarmupScheme,
} from "./warmups";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import { focusMusclesSchema } from "./focus-muscles";
import { resolveEffortPreference } from "./effort-preference";
import { getElbowForearmAtlRatio } from "@/lib/stats/region-spike-queries";
import { archivePriorActiveBlocks } from "./archive-prior-blocks";
import { descriptiveSessionTitle } from "./session-title";

// ─── Per-session prescription assembly ──────────────────────────────
// The block-level derivations + week×day loop that build the
// `planned_sessions` insert rows live in a dedicated pure module so the
// extraction stays DB-free and unit-testable. `classifyPlannedSession`
// is re-exported there for the createCustomBlock path.
import {
  assembleBlockSessions,
  classifyPlannedSession,
  type PlannedSessionInsertRow,
} from "./assemble-block-sessions";
// ─── Block DB context-build ─────────────────────────────────────────
// The archetype lookup + profile/catalog/TM/bodyweight loads + per-day
// strength-movement resolution that produce the `BlockAssemblyContext`
// live in a dedicated module so the upcoming hybrid program engine can
// reuse them. The three movement-resolver helpers are exported there and
// re-used by the createCustomBlock path below.
import {
  buildBlockAssemblyContext,
  pickStrengthMovementForBand,
  pickSecondaryStrengthMovement,
  resolveDeclaredExperience,
} from "./build-block-assembly-context";
// ─── Block wizard input parsing ─────────────────────────────────────
// `createBlockSchema` + the wizard-input → `BuildBlockAssemblyContextInput`
// mapping live in a dedicated DB-free module (a `"use server"` file may only
// export async functions, so the schema/helper can't live here). Both
// `createBlock` and the hybrid program engine import the SAME mapper so they
// stay parity-identical by construction (ADR 0046 Phase 0).
import { parseCreateBlockInput } from "./create-block-input";

export type CreateBlockResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Create a new block from the wizard input. Returns a result object so the
 * client wizard can surface the failure reason inline instead of crashing
 * the whole page.
 */
export async function createBlock(formData: FormData): Promise<CreateBlockResult> {
  const parsedInput = parseCreateBlockInput({
    archetype: formData.get("archetype"),
    startedOn: formData.get("startedOn"),
    daysPerWeek: formData.get("daysPerWeek"),
    dayIndexOverrides: formData.get("dayIndexOverrides") ?? undefined,
    powerEmphasis: formData.get("powerEmphasis") ?? undefined,
    cardioSource: formData.get("cardioSource") ?? undefined,
    cardioSourceName: formData.get("cardioSourceName") ?? undefined,
    // Focus muscles arrive as repeated `focusMuscles` form fields.
    // Empty getAll() → [] → focusMusclesSchema's `.default([])` path.
    focusMuscles: formData
      .getAll("focusMuscles")
      .map((v) => (typeof v === "string" ? v : ""))
      .filter((v) => v.length > 0),
    goal: (formData.get("goal") as string | null) || undefined,
    secondaryFocus: (formData.get("secondaryFocus") as string | null) || undefined,
    accessoryVolume: (formData.get("accessoryVolume") as string | null) || undefined,
  });
  if (!parsedInput.ok) {
    return { ok: false, error: parsedInput.error };
  }
  const { input, parsed, dayIndexOverrides } = parsedInput;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const built = await buildBlockAssemblyContext(supabase, user.id, input);
  if (!built.ok) return built;
  const { ctx, meta } = built;

  // Data-integrity fix: the prior active block is archived AFTER the new block
  // and its planned_sessions are committed (see archivePriorActiveBlocks /
  // the post-insert call below), so a failure here can never orphan the user.
  const { data: block, error: blockErr } = await supabase
    .from("training_blocks")
    .insert({
      user_id: user.id,
      archetype: ctx.archetype.id,
      started_on: parsed.startedOn,
      weeks: ctx.archetype.weeks,
      status: "active",
      days_per_week: parsed.daysPerWeek,
      day_index_overrides: dayIndexOverrides,
      power_emphasis: parsed.powerEmphasis,
      focus_muscles: parsed.focusMuscles,
      goal: parsed.goal ?? null,
      secondary_focus: parsed.secondaryFocus ?? null,
      accessory_volume: parsed.accessoryVolume ?? "medium",
      cardio_source: parsed.cardioSource,
      cardio_source_name: parsed.cardioSourceName,
      notes: meta.hasAnyTm
        ? null
        : meta.bwHasAnyFamily
          ? "Bodyweight block — main lifts prescribed from your assessed skill nodes."
          : "Bodyweight-only block — main-lift progression coming soon. Accessories programmed per RPE/RIR.",
    })
    .select("id")
    .single();

  if (blockErr || !block) {
    return { ok: false, error: blockErr?.message ?? "Failed to create block" };
  }

  const rows = assembleBlockSessions(ctx, block.id, user.id);

  const { error: psErr } = await supabase.from("planned_sessions").insert(rows);
  if (psErr) {
    // Roll back the block we just created so we don't leave a zombie. The
    // prior active block was never archived, so the user keeps it intact.
    await supabase.from("training_blocks").delete().eq("id", block.id);
    return { ok: false, error: `Couldn't create planned sessions: ${psErr.message}` };
  }

  // New block + its planned_sessions are committed: now archive the prior
  // active block(s). Non-fatal on failure — see archivePriorActiveBlocks.
  const { error: archErr } = await archivePriorActiveBlocks(supabase, user.id, block.id);
  if (archErr) {
    console.error(`createBlock: failed to archive prior active block: ${archErr}`);
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/stats");
  // Bodyweight Phase 6 — capture a diagnostics snapshot now that the
  // block's planned sessions exist (drift detection reads the
  // planner items via `planned_sessions`, so the post-creation
  // shape is the one we want frozen). Non-blocking.
  try {
    const { captureBwDiagnosticsSnapshot } = await import(
      "@/lib/planner/bw-diagnostics-snapshot"
    );
    await captureBwDiagnosticsSnapshot({ supabase, userId: user.id });
  } catch (e) {
    console.error("captureBwDiagnosticsSnapshot (createBlock) failed:", e);
  }
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
  /** Migration 0079 — per-block focus muscle groups (0–2). */
  focusMuscles: focusMusclesSchema,
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

  // ADR 0005 — fold missing main-lift patterns onto existing strength
  // days when the compiled custom archetype lands below the 4-strength-
  // day frequency. Pure post-compile transformation; downstream
  // resolution + row emission consume the folded shape identically to
  // the curated ENDURANCE_ANCHOR templates.
  archetype.days = foldDualMainLifts(archetype, archetype.days);

  if (daysPerWeek < 1) {
    return { ok: false, error: "Pick at least one non-rest day." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // Pull the user's warmup-ladder config + equipment so custom blocks
  // also pick up auto-warmups for main lifts and respect the
  // equipment-aware accessory filter. NULL → defaults via resolvers.
  const { data: customProfile } = await supabase
    .from("profiles")
    .select("warmup_scheme, equipment, barbell_kg, trap_bar_kg, plate_inventory_kg, bw_assessment_completed_at, training_experience, effort_preference, preferred_cardio_modalities")
    .eq("id", user.id)
    .maybeSingle();
  const customWarmupScheme = resolveWarmupScheme(customProfile?.warmup_scheme);
  const customEquipment = resolveEquipment(customProfile);
  const customExperience = resolveDeclaredExperience(customProfile?.training_experience);
  const customEffortPreference = resolveEffortPreference(customProfile?.effort_preference);

  // ADR 0017 — ranked cardio-modality preference (custom-block path).
  const customPreferredCardioModalities = sanitizePreferredModalities(
    customProfile?.preferred_cardio_modalities as readonly unknown[] | null,
  );
  const customCardioCatalog =
    customPreferredCardioModalities.length > 0
      ? await loadCardioCatalog(supabase)
      : [];
  const customCardioCatalogBySlug = new Map(
    customCardioCatalog.map((c) => [c.slug, c]),
  );

  // Resolve all required movements.
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

  const customTier = declaredExperienceToTier(customExperience);
  const resolved = new Map<string, { movementId: string; slug: string; displayName: string }>();
  const resolvedSecondary = new Map<string, { movementId: string; slug: string; displayName: string }>();
  const missingRoles: string[] = [];
  for (const day of archetype.days) {
    if (day.kind !== "strength") continue;
    const chosen = pickStrengthMovementForBand({
      candidateSlugs: day.candidateSlugs,
      movementBySlug,
      tmMovementIds,
      tier: customTier,
    });
    if (chosen) resolved.set(daySlotKey(day), chosen);
    else missingRoles.push(STRENGTH_ROLE_LABELS[day.role]);

    // ADR 0004 — dual-main-lift secondary resolution (custom block path).
    // See createBlock for rationale: secondary is required, not opt-in.
    if (day.secondaryCandidateSlugs && day.secondaryCandidateSlugs.length > 0) {
      const secondary = pickSecondaryStrengthMovement({
        candidateSlugs: day.secondaryCandidateSlugs,
        movementBySlug,
        tmMovementIds,
        tier: customTier,
      });
      if (secondary) {
        resolvedSecondary.set(daySlotKey(day), secondary);
      } else if (day.secondaryRole) {
        missingRoles.push(STRENGTH_ROLE_LABELS[day.secondaryRole]);
      }
    }
  }
  if (missingRoles.length > 0) {
    return {
      ok: false,
      error: `No TM set for: ${missingRoles.join(", ")}. Go to Settings → Training maxes and add one for each.`,
    };
  }

  // Read profile-level limitations once for the whole custom block.
  const customLimitationsContext = await readLimitationsContext(
    supabase,
    user.id,
  );

  // Migration 0079 — elbow/forearm ATL ratio for the forearm gate.
  const customTzForBlock = await getUserTimezone(user.id);
  const customElbowForearmAtlRatio = parsed.data.focusMuscles.includes("forearms")
    ? await getElbowForearmAtlRatio(supabase, user.id, customTzForBlock)
    : 1.0;

  // Data-integrity fix: archive the prior active block AFTER the new block and
  // its planned_sessions are committed (post-insert call below), never before.
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
      focus_muscles: parsed.data.focusMuscles,
    })
    .select("id")
    .single();
  if (blockErr || !block) return { ok: false, error: blockErr?.message ?? "Failed to create block" };

  const rows: PlannedSessionInsertRow[] = [];
  for (let week = 0; week < archetype.weeks; week++) {
    for (const day of archetype.days) {
      let movement: { id: string; slug: string; displayName: string };
      let finisherMovement: { id: string; slug: string; displayName: string } | undefined;
      let secondaryMovement: { id: string; slug: string; displayName: string } | undefined;
      // ADR 0037 — effective (deload-downgraded) cardio day for the assembler.
      let cardioDayOverride: CardioDay | undefined;

      if (day.kind === "strength") {
        const resolvedMv = resolved.get(daySlotKey(day));
        if (!resolvedMv) continue;
        movement = { id: resolvedMv.movementId, slug: resolvedMv.slug, displayName: resolvedMv.displayName };
        // ADR 0004 — dual-main-lift secondary movement, when resolved.
        const resolvedSec = resolvedSecondary.get(daySlotKey(day));
        if (resolvedSec) {
          secondaryMovement = {
            id: resolvedSec.movementId,
            slug: resolvedSec.slug,
            displayName: resolvedSec.displayName,
          };
        }
      } else if (day.kind === "cardio") {
        // PR W2 — surface D. Per-tier cardio resolution (custom block path).
        // ADR 0037 — coherent deload: downgrade the maximal VO2 day to a
        // sub-maximal touch and drop the alactic finisher on the deload week.
        const cwProfile = archetype.weekProfiles.find((w) => w.weekIndex === week);
        const dPlan = deloadCardioPlan(day, cwProfile, archetype.days.length, customTier);
        const effCardioKind = dPlan?.cardioKindOverride ?? day.cardioKind;
        const baseCardioSlug =
          dPlan?.slugOverride ?? resolveCardioSlugForTier(day, customTier);
        // ADR 0017 — preferred-modality substitution (intensity-preserving).
        const resolvedCardio = resolvePreferredCardioModality({
          defaultSlug: baseCardioSlug,
          cardioKind:
            effCardioKind === "cardio_external" ? "cardio_other" : effCardioKind,
          preferred: customPreferredCardioModalities,
          ownedCardio: customEquipment.cardio,
          userTier: customTier,
          catalog: customCardioCatalog,
        });
        const sub = resolvedCardio.substituted
          ? customCardioCatalogBySlug.get(resolvedCardio.slug)
          : undefined;
        if (sub) {
          movement = { id: sub.id, slug: sub.slug, displayName: sub.displayName };
        } else {
          const mv = movementBySlug.get(resolvedCardio.slug);
          if (!mv) continue;
          movement = { id: mv.id, slug: mv.slug, displayName: mv.display_name };
        }
        if (day.finisher && !dPlan?.dropFinisher) {
          const fin = movementBySlug.get(day.finisher.movementSlug);
          if (fin) finisherMovement = { id: fin.id, slug: fin.slug, displayName: fin.display_name };
        }
        // ADR 0038 — cardio progression. A custom block's archetype id is
        // "custom" → tier "none", so this is always a no-op here; wired for
        // parallelism with the createBlock loop.
        const pPlan = dPlan
          ? null
          : cardioProgressionPlan({ day, archetype, weekIndex: week, secondaryFocus: null });
        if (dPlan || pPlan) {
          cardioDayOverride = {
            ...day,
            ...(dPlan
              ? {
                  cardioKind: effCardioKind,
                  finisher: dPlan.dropFinisher ? undefined : day.finisher,
                  ...(dPlan.cardioKindOverride
                    ? { hrCap: undefined, protocolNote: undefined }
                    : {}),
                }
              : {}),
            ...(pPlan?.durationMinOverride != null
              ? { durationMin: pPlan.durationMinOverride }
              : {}),
            ...(pPlan?.protocolNoteOverride != null
              ? { protocolNote: pPlan.protocolNoteOverride }
              : {}),
          };
        }
      } else {
        const mv = movementBySlug.get(day.movementSlug);
        if (!mv) continue;
        movement = { id: mv.id, slug: mv.slug, displayName: mv.display_name };
      }

      const items = assemblePrescriptionItems(
        archetype,
        week,
        cardioDayOverride ?? day,
        movement,
        finisherMovement,
        movementBySlug,
        undefined,
        undefined,
        1.0,
        false,
        customWarmupScheme,
        customEquipment,
        false,
        customExperience,
        customLimitationsContext,
        secondaryMovement,
        parsed.data.focusMuscles,
        customElbowForearmAtlRatio,
        new Set<string>(),
        customEffortPreference,
      );

      // Phase 5 — stamp modality + effective_stress_load on every
      // planned-session row so the ceiling engine and UI chip can
      // read them without re-classifying.
      const customClass = classifyPlannedSession(items, archetype.id);

      const prescription: Prescription = {
        items: expandPrescriptionSetItems(items),
      };
      const isDeload = archetype.weekProfiles.find((w) => w.weekIndex === week)?.intensityLabel === "Deload";

      let base = day.title;
      if (day.kind === "strength") {
        // Folded dual-main-lift days name both resolved lifts so the day
        // isn't mislabelled after only its first lift (see standard path).
        base =
          day.secondaryRole && secondaryMovement
            ? `${movement.displayName} + ${secondaryMovement.displayName}`
            : movement.displayName;
      }
      const title = descriptiveSessionTitle(day.kind, base, isDeload);

      rows.push({
        block_id: block.id,
        user_id: user.id,
        week_index: week,
        day_index: day.dayIndex,
        slot: day.slot ?? "single",
        title,
        role: day.role,
        prescription,
        session_modality: customClass.modality,
        effective_stress_load: customClass.load,
      });
    }
  }

  const { error: psErr } = await supabase.from("planned_sessions").insert(rows);
  if (psErr) {
    await supabase.from("training_blocks").delete().eq("id", block.id);
    return { ok: false, error: `Couldn't create planned sessions: ${psErr.message}` };
  }

  // New block + its planned_sessions are committed: now archive the prior
  // active block(s). Non-fatal on failure — see archivePriorActiveBlocks.
  const { error: archErr } = await archivePriorActiveBlocks(supabase, user.id, block.id);
  if (archErr) {
    console.error(`createCustomBlock: failed to archive prior active block: ${archErr}`);
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  // Bodyweight Phase 6 — diagnostics snapshot, see createBlock note.
  try {
    const { captureBwDiagnosticsSnapshot } = await import(
      "@/lib/planner/bw-diagnostics-snapshot"
    );
    await captureBwDiagnosticsSnapshot({ supabase, userId: user.id });
  } catch (e) {
    console.error("captureBwDiagnosticsSnapshot (createCustomBlock) failed:", e);
  }
  return { ok: true };
}

const blockIdSchema = z.object({ id: z.string().uuid() });

const endBlockSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().max(280).optional(),
});

export async function endBlock(formData: FormData): Promise<void> {
  const parsed = endBlockSchema.safeParse({
    id: formData.get("id"),
    reason: (formData.get("reason") as string | null) ?? undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  // Capture engine context BEFORE the archive write so the snapshot
  // reflects the block as the user last saw it (active, week N of K).
  // DC-K4: every override carries the engine state at decision time.
  const [{ data: blockRow }, { data: completionRow }] = await Promise.all([
    supabase
      .from("training_blocks")
      .select("archetype, weeks, started_on")
      .eq("id", parsed.data.id)
      .maybeSingle(),
    supabase
      .from("planned_sessions")
      .select("id, completed_session_id, skipped_at", { count: "exact" })
      .eq("block_id", parsed.data.id),
  ]);

  await supabase
    .from("training_blocks")
    .update({ status: "archived", archived_at: nowIso, ended_at: nowIso })
    .eq("id", parsed.data.id);

  const {
    data: { user },
  } = await getAuthUser();
  if (user) {
    const totalPlanned = completionRow?.length ?? 0;
    const totalDone = (completionRow ?? []).filter(
      (r) => r.completed_session_id || r.skipped_at,
    ).length;
    const percentThrough = totalPlanned > 0 ? totalDone / totalPlanned : 0;
    const weeks = blockRow?.weeks as number | undefined;
    const startedOn = blockRow?.started_on as string | undefined;
    let weeksCompleted: number | undefined;
    if (startedOn) {
      const startMs = Date.parse(`${startedOn}T00:00:00Z`);
      if (!Number.isNaN(startMs)) {
        const days = Math.max(0, Math.floor((Date.now() - startMs) / 86_400_000));
        weeksCompleted = Math.floor(days / 7);
        if (typeof weeks === "number") {
          weeksCompleted = Math.min(weeksCompleted, weeks);
        }
      }
    }
    await recordOverrideEvent(supabase, {
      userId: user.id,
      eventType: "manual_end",
      occurredAt: nowIso,
      blockId: parsed.data.id,
      reason: parsed.data.reason ?? null,
      context: {
        archetype: blockRow?.archetype as string | undefined,
        weeks,
        weeksCompleted,
        percentThrough: Number(percentThrough.toFixed(3)),
      },
    });
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
}

/**
 * Soft-delete a training block. Distinct from `endBlock` which writes
 * status='archived' to mark "no longer active". `deleteBlock` is the
 * stronger intent: remove from history, recoverable for 30 days via
 * the Trash page. AGENTS.md DC-K4 — destructive, reversible.
 *
 * Cascade is implicit: every query that lists planned_sessions joins
 * through the block and the block filter `deleted_at IS NULL` hides
 * the children too. Hard cascade to planned_sessions only fires when
 * the block is permanently deleted (FK ON DELETE CASCADE in 0008).
 *
 * RLS (training_blocks_update_self) covers ownership; the explicit
 * `eq("user_id", ...)` is defense in depth.
 */
export async function deleteBlock(
  formData: FormData,
): Promise<{ ok: true; blockId: string } | { ok: false; error: string }> {
  const parsed = blockIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("training_blocks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/plan/history");
  revalidatePath("/app/stats");
  revalidatePath("/app/settings/trash");
  return { ok: true, blockId: parsed.data.id };
}

/** Restore a soft-deleted block — flips `deleted_at` back to NULL. */
export async function restoreBlock(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Missing block id." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("training_blocks")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/plan/history");
  revalidatePath("/app/stats");
  revalidatePath("/app/settings/trash");
  return { ok: true };
}

/**
 * Hard-delete a block. Only callable from the Trash page after the
 * user types the block's archetype name as type-to-confirm. Cascades
 * to planned_sessions via the FK in migration 0008
 * (planned_sessions.block_id ON DELETE CASCADE).
 */
export async function permanentlyDeleteBlock(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "Missing block id." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("training_blocks")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/plan/history");
  revalidatePath("/app/stats");
  revalidatePath("/app/settings/trash");
  return { ok: true };
}

const linkPlannedSchema = z.object({
  plannedId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

/**
 * Link a past planned_session to an already-logged sessions row. Used
 * by the past-unfulfilled match modal in the calendar views: when the
 * user identifies a Strava-imported activity (or any logged session
 * on the same calendar day) as the realisation of a planned slot, we
 * point `completed_session_id` at it. RLS + the inner-join through
 * training_blocks ensures only the owning user can mutate the row.
 */
export async function linkPlannedToSession(formData: FormData): Promise<void> {
  const parsed = linkPlannedSchema.safeParse({
    plannedId: formData.get("plannedId"),
    sessionId: formData.get("sessionId"),
  });
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("planned_sessions")
    .update({ completed_session_id: parsed.data.sessionId })
    .eq("id", parsed.data.plannedId);
  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const skipSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().max(280).optional(),
});

export async function skipPlannedSession(formData: FormData): Promise<void> {
  const parsed = skipSchema.safeParse({
    id: formData.get("id"),
    reason: (formData.get("reason") as string | null) ?? undefined,
  });
  if (!parsed.success) return;
  const supabase = await createClient();
  const skippedAt = new Date().toISOString();

  // Read planned + block context BEFORE the update so the audit row
  // carries the engine state the user actually saw when skipping.
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select(
      "id, user_id, block_id, week_index, day_index, training_blocks!inner(archetype, started_on)",
    )
    .eq("id", parsed.data.id)
    .maybeSingle();

  await supabase
    .from("planned_sessions")
    .update({ skipped_at: skippedAt })
    .eq("id", parsed.data.id);

  if (planned) {
    const block = (planned as unknown as {
      training_blocks: { archetype: string; started_on: string };
    }).training_blocks;
    const startedOn = block?.started_on as string | undefined;
    const weekIndex = planned.week_index as number;
    const dayIndex = planned.day_index as number;
    let weekday: number | undefined;
    if (startedOn) {
      const startMs = Date.parse(`${startedOn}T12:00:00Z`);
      if (!Number.isNaN(startMs)) {
        const dayMs = startMs + (weekIndex * 7 + dayIndex) * 86_400_000;
        const d = new Date(dayMs);
        weekday = ((d.getUTCDay() + 6) % 7) + 1;
      }
    }
    await recordOverrideEvent(supabase, {
      userId: planned.user_id as string,
      eventType: "skip",
      occurredAt: skippedAt,
      plannedSessionId: parsed.data.id,
      blockId: planned.block_id as string,
      reason: parsed.data.reason ?? null,
      context: {
        archetype: block?.archetype,
        weekIndex,
        dayIndex,
        weekday,
      },
    });
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
}

const unskipSchema = z.object({ id: z.string().uuid() });

const moveSchema = z.object({
  id: z.string().uuid(),
  weekIndex: z.number().int().min(0),
  dayIndex: z.number().int().min(0).max(6),
});

/**
 * Move a planned session to a new (week_index, day_index) slot. If the
 * target slot already holds a planned_sessions row (and neither row is
 * completed), the two rows swap. Out-of-block target weeks are rejected
 * silently. Completed/skipped sessions can be moved but the partner
 * (if any) is left in place.
 *
 * UI-only operation: the engine's stress budget / recovery math is
 * unchanged — the user can already reorder days via the wizard.
 */
export async function movePlannedSession(formData: FormData): Promise<void> {
  const parsed = moveSchema.safeParse({
    id: formData.get("id"),
    weekIndex: Number(formData.get("weekIndex")),
    dayIndex: Number(formData.get("dayIndex")),
  });
  if (!parsed.success) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, block_id, week_index, day_index, slot")
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!planned) return;

  const { data: block } = await supabase
    .from("training_blocks")
    .select("weeks")
    .eq("id", planned.block_id)
    .maybeSingle();
  if (!block) return;
  if (parsed.data.weekIndex >= (block.weeks as number)) return;

  // No-op if already on the target slot.
  if (
    planned.week_index === parsed.data.weekIndex &&
    planned.day_index === parsed.data.dayIndex
  ) {
    return;
  }

  // Find what (if anything) currently sits on the target slot. Limit to
  // the same block + same slot label so a 2-a-day doesn't get clobbered
  // by a 1-a-day swap (we only swap matching slots).
  const { data: existing } = await supabase
    .from("planned_sessions")
    .select("id, week_index, day_index, slot")
    .eq("block_id", planned.block_id)
    .eq("user_id", user.id)
    .eq("week_index", parsed.data.weekIndex)
    .eq("day_index", parsed.data.dayIndex);

  const target = (existing ?? []).find((r) => r.slot === planned.slot);

  if (target && target.id !== planned.id) {
    // Atomic-ish swap with rollback on partial failure. See
    // ./swap.ts for the parking-slot strategy + rationale. The helper
    // throws on any DB error so we surface failures to the caller
    // instead of silently leaving a row stranded at the guard slot.
    await swapPlannedSessions({
      client: supabase as unknown as Parameters<typeof swapPlannedSessions>[0]["client"],
      userId: user.id,
      sourceId: planned.id,
      sourceWeek: planned.week_index,
      sourceDay: planned.day_index,
      targetId: target.id,
      targetWeek: parsed.data.weekIndex,
      targetDay: parsed.data.dayIndex,
      blockWeeks: block.weeks as number,
    });
  } else {
    const { error: moveErr } = await supabase
      .from("planned_sessions")
      .update({ week_index: parsed.data.weekIndex, day_index: parsed.data.dayIndex })
      .eq("id", planned.id)
      .eq("user_id", user.id);
    if (moveErr) {
      throw new Error(
        `movePlannedSession: failed to move ${planned.id}: ${moveErr.message}`,
      );
    }
  }

  // Moving a day clears any explicit planned_at (the absolute timestamp
  // referred to the OLD calendar date — keeping it would put the
  // session on the wrong wall-clock day).
  const { error: clearErr } = await supabase
    .from("planned_sessions")
    .update({ planned_at: null })
    .in("id", target ? [planned.id, target.id] : [planned.id])
    .eq("user_id", user.id);
  if (clearErr) {
    throw new Error(
      `movePlannedSession: failed to clear planned_at after move: ${clearErr.message}`,
    );
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
}

export async function unskipPlannedSession(formData: FormData): Promise<void> {
  const parsed = unskipSchema.safeParse({ id: formData.get("id") });
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
  } = await getAuthUser();
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
 * Maximum allowed back-date for retroactive session logging, in days.
 *
 * Anything beyond two weeks is almost certainly user error (a typo
 * in the date picker, or "I'll just back-fill the whole previous
 * month"), which would silently scramble adherence + ESL attribution.
 * The picker pre-fill defaults to the planned date so the legitimate
 * "I logged yesterday's workout today" path never bumps against this.
 */
const MAX_RETRO_PERFORMED_AT_DAYS = 14;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a retroactive `performedAt` YYYY-MM-DD against the user
 * timezone. Returns the start-of-day UTC instant for the picked date,
 * or throws a user-facing Error.
 */
async function resolveRetroPerformedAt(
  performedAt: string,
  userId: string,
): Promise<Date> {
  // Cheap structural check first — we don't want to round-trip to
  // profiles just to reject "lol nope".
  if (!YMD_RE.test(performedAt)) {
    throw new Error("Invalid performed_at: expected YYYY-MM-DD");
  }
  const [y, m, d] = performedAt.split("-").map((s) => Number.parseInt(s, 10));
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new Error("Invalid performed_at: not a real calendar date");
  }
  const tz = await getUserTimezone(userId);
  const today = todayYmd(tz);
  const delta = daysBetweenYmd(performedAt, today); // today - picked
  if (delta < 0) {
    throw new Error("performed_at cannot be in the future");
  }
  if (delta > MAX_RETRO_PERFORMED_AT_DAYS) {
    throw new Error(
      `performed_at cannot be more than ${MAX_RETRO_PERFORMED_AT_DAYS} days in the past`,
    );
  }
  return ymdToUtc(performedAt, tz);
}

/**
 * Start a real session from a planned slot.
 *
 * Creates a sessions row pre-populated with the planned title + a set_log
 * stub per prescription item (no weights yet — user logs them as actual sets),
 * and links it back to the planned_session.
 *
 * Honours an optional `performedAt` form field (YYYY-MM-DD) — when
 * present, the new session is back-dated to start-of-day in the user's
 * timezone. See `startSessionDirect` for the validation rules.
 */
export async function startSessionFromPlan(formData: FormData): Promise<void> {
  const parsed = startPlannedSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) throw new Error("Invalid planned session id");
  const rawPerformedAt = formData.get("performedAt");
  const performedAt =
    typeof rawPerformedAt === "string" && rawPerformedAt.length > 0
      ? rawPerformedAt
      : undefined;
  await startSessionDirect(parsed.data.id, performedAt ? { performedAt } : undefined);
}

/**
 * Start a planned session WITHOUT a pre-session check-in.
 *
 * This is the single source of truth for materialising a planned
 * session into a real `sessions` row. The legacy
 * `startCheckInSession` path that also wrote `fatigue` / `soreness`
 * onto the new sessions row was removed when the pre-workout
 * interstitial was deleted, and the follow-up Today-page wellness
 * check-in card has since also been retired (see
 * chore/retire-wellness-checkin). The `wellness` table and engine
 * read path stay intact for optionality. Callers that need the
 * URL-driven version use the `/app/sessions/start/[plannedId]` page
 * which auto-invokes this helper and redirects.
 *
 * Side effects (must stay in lockstep with the planner's expectations):
 *   1. INSERT a new `sessions` row carrying the planned title, slot,
 *      and planned_at (so the planner can correlate it back).
 *   2. UPDATE the matching `planned_sessions` row's
 *      `completed_session_id` so the plan calendar knows the row is
 *      now linked-and-in-progress.
 *   3. Revalidate `/app` + `/app/plan` so the CTAs flip on the next
 *      paint. SKIPPED when `options.skipRevalidate` is set — the
 *      URL-driven `/app/sessions/start/[plannedId]` page invokes this
 *      helper DURING RENDER, where `revalidatePath` is unsupported in
 *      Next 16 (it throws). That path relies on `/app` + `/app/plan`
 *      being cookie-dynamic routes (router-cache `staleTimes.dynamic=0`),
 *      so a fresh server render on the next navigation reflects the
 *      started session without an explicit revalidate.
 *   4. Redirect to `/app/sessions/<new-id>` — the session log surface.
 *
 * Idempotent re-entry: if the planned row already has a
 * `completed_session_id`, we skip the insert and redirect to that
 * session (matches the behaviour the deleted interstitial had).
 */
export async function startSessionDirect(
  plannedId: string,
  options?: { performedAt?: string; skipRevalidate?: boolean },
): Promise<never> {
  const parsed = startPlannedSchema.safeParse({ id: plannedId });
  if (!parsed.success) throw new Error("Invalid planned session id");

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // Resolve the back-date BEFORE the planned-session lookup so we
  // surface the error path before any DB mutation. `resolveRetro…`
  // throws a user-facing message that the form action surfaces via
  // Next's error overlay.
  const retroPerformedAt =
    options?.performedAt != null
      ? await resolveRetroPerformedAt(options.performedAt, user.id)
      : null;

  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, title, slot, planned_at, prescription, completed_session_id, user_id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!planned) throw new Error("Planned session not found");
  if (planned.user_id !== user.id) throw new Error("Planned session not found");

  // Idempotent re-entry: reuse the existing linked session if any.
  if (planned.completed_session_id) {
    redirect(`/app/sessions/${planned.completed_session_id}`);
  }

  const sessionPayload: {
    user_id: string;
    title: string;
    slot: string;
    planned_at: string | null;
    performed_at?: string;
  } = {
    user_id: user.id,
    title: planned.title,
    slot: planned.slot ?? "single",
    planned_at: planned.planned_at,
  };
  if (retroPerformedAt) {
    sessionPayload.performed_at = retroPerformedAt.toISOString();
  }

  const { data: session, error: sessErr } = await supabase
    .from("sessions")
    .insert(sessionPayload)
    .select("id")
    .single();

  if (sessErr || !session) throw new Error(sessErr?.message ?? "Failed to start session");

  // Conditional link so a concurrent caller (e.g. middle-click that
  // bypasses the client-side one-tap lock) cannot overwrite an earlier
  // winner. If the UPDATE affects zero rows, another request already
  // linked first — delete our orphan insert and redirect to the winner.
  const { data: linked, error: linkErr } = await supabase
    .from("planned_sessions")
    .update({ completed_session_id: session.id })
    .eq("id", planned.id)
    .is("completed_session_id", null)
    .select("id, completed_session_id")
    .maybeSingle();

  if (linkErr) throw new Error(linkErr.message);

  if (!linked) {
    // Lost the race. Clean up the orphaned session and reuse the winner.
    await supabase.from("sessions").delete().eq("id", session.id);
    const { data: winner } = await supabase
      .from("planned_sessions")
      .select("completed_session_id")
      .eq("id", planned.id)
      .maybeSingle();
    if (winner?.completed_session_id) {
      if (!options?.skipRevalidate) {
        revalidatePath("/app");
        revalidatePath("/app/plan");
      }
      redirect(`/app/sessions/${winner.completed_session_id}`);
    }
    throw new Error("Failed to link planned session after race");
  }

  if (!options?.skipRevalidate) {
    revalidatePath("/app");
    revalidatePath("/app/plan");
  }
  redirect(`/app/sessions/${session.id}`);
}
