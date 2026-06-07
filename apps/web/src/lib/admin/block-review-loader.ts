/**
 * Server loader for the admin plan-review export. Gathers a generated
 * block + the athlete's full context into the pure `BlockReviewData`
 * shape consumed by `buildBlockReviewMarkdown`.
 *
 * Everything is scoped to the authenticated admin's own user id (the
 * validation use case is: the admin generates a block on their account,
 * then exports it for review). RLS applies; no service-role client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrescriptionItem } from "@hta/db";

import { getPlannedDays } from "@/lib/planner/queries";
import { getTrainingMaxContext } from "@/lib/training-maxes/queries";
import { ARCHETYPES, type ArchetypeId } from "@/lib/planner/archetypes";
import { deloadWeekIndexFor } from "@/lib/planner/deload-skip";
import { cleanPrescriptionNotes } from "@/lib/planner/clean-prescription-notes";
import { FOCUS_MUSCLE_LABEL, type FocusMuscle } from "@/lib/planner/focus-muscles";
import { isMaxIntentRpe, MAX_INTENT_LABEL } from "@/lib/sessions/effort-label";
import type {
  BlockReviewData,
  ReviewItem,
  ReviewSession,
} from "./block-review-export";

type BlockRow = {
  id: string;
  archetype: string;
  started_on: string | null;
  weeks: number | null;
  status: string | null;
  goal: string | null;
  secondary_focus: string | null;
  focus_muscles: string[] | null;
  accessory_volume: string | null;
  power_emphasis: boolean | null;
};

/** Compact equipment summary for the review doc (preset + populated groups). */
function summariseEquipment(equipment: unknown): string[] {
  if (!equipment || typeof equipment !== "object") return [];
  const e = equipment as Record<string, unknown>;
  const out: string[] = [];
  if (typeof e.preset === "string") out.push(`preset: ${e.preset}`);
  for (const key of [
    "bars",
    "plates",
    "dumbbells",
    "kettlebells",
    "machines",
    "cardio",
  ]) {
    const v = e[key];
    if (Array.isArray(v) && v.length > 0) out.push(`${key} (${v.length})`);
    else if (v && typeof v === "object") out.push(key);
  }
  return out;
}

function fmtRange(r: { min: number; max: number } | undefined, prefix: string): string | null {
  if (!r) return null;
  return r.min === r.max ? `${prefix}${r.min}` : `${prefix}${r.min}-${r.max}`;
}

function itemSetsReps(it: PrescriptionItem): string | null {
  if (it.durationMin != null) return `${it.durationMin} min`;
  if (it.bw) {
    const { sets, reps, repRange, holdSeconds } = it.bw;
    if (holdSeconds != null) return `${sets}×${holdSeconds}s hold`;
    if (repRange) return `${sets}×${repRange.min}-${repRange.max}`;
    if (reps != null) return `${sets}×${reps}`;
    return `${sets} sets`;
  }
  if (it.holdSec) {
    const sets = it.sets ?? 1;
    return `${sets}×${fmtRange(it.holdSec, "")}s hold`;
  }
  if (it.distanceM) {
    const sets = it.sets ?? 1;
    return `${sets}×${fmtRange(it.distanceM, "")}m carry`;
  }
  if (it.sets != null && it.reps != null) return `${it.sets}×${it.reps}`;
  if (it.sets != null) return `${it.sets} sets`;
  return null;
}

function itemIntensity(it: PrescriptionItem): string | null {
  const parts: string[] = [];
  if (it.percentTm != null) parts.push(`${it.percentTm}% TM`);
  if (it.intensityLabel) parts.push(it.intensityLabel);
  const rir = fmtRange(it.targetRir, "RIR ");
  if (rir) parts.push(rir);
  const rpe = isMaxIntentRpe(it.targetRpe)
    ? MAX_INTENT_LABEL
    : fmtRange(it.targetRpe, "RPE ");
  if (rpe) parts.push(rpe);
  if (it.hrCap) parts.push(it.hrCap);
  if (it.protocolNote) parts.push(it.protocolNote);
  return parts.length > 0 ? parts.join(", ") : null;
}

function itemTempo(it: PrescriptionItem): string | null {
  if (it.tempoEccentricSec != null) return `${it.tempoEccentricSec}s lower`;
  if (it.bw?.tempoEccentricSec != null) return `${it.bw.tempoEccentricSec}s lower`;
  return null;
}

function itemSuperset(it: PrescriptionItem): string | null {
  const meta = it.meta as { supersetGroup?: unknown; supersetSlot?: unknown } | undefined;
  const g = meta?.supersetGroup;
  const s = meta?.supersetSlot;
  if (typeof g === "string" && g.length > 0) {
    return typeof s === "string" && s.length > 0 ? `${g}/${s}` : g;
  }
  return null;
}

function mapItem(it: PrescriptionItem): ReviewItem {
  return {
    kind: it.kind,
    movementName: it.movementName ?? it.movementSlug ?? null,
    setsReps: itemSetsReps(it),
    intensity: itemIntensity(it),
    tempo: itemTempo(it),
    isAmrap: it.isAmrap === true,
    supersetGroup: itemSuperset(it),
    why: cleanPrescriptionNotes(it.notes ?? it.bw?.notes ?? null),
  };
}

/**
 * Assemble the review snapshot for a block. When `blockId` is omitted,
 * uses the admin's most recent active block.
 */
export async function loadBlockReviewData(
  supabase: SupabaseClient,
  userId: string,
  blockId?: string,
): Promise<BlockReviewData | null> {
  const blockCols =
    "id, archetype, started_on, weeks, status, goal, secondary_focus, focus_muscles, accessory_volume, power_emphasis";

  let blockRes;
  if (blockId) {
    blockRes = await supabase
      .from("training_blocks")
      .select(blockCols)
      .eq("id", blockId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
  } else {
    blockRes = await supabase
      .from("training_blocks")
      .select(blockCols)
      .eq("user_id", userId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("started_on", { ascending: false })
      .limit(1)
      .maybeSingle();
  }
  const block = (blockRes.data as BlockRow | null) ?? null;
  if (!block) return null;

  const [profileRes, limitationsRes, tmCtx, plannedDays] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "training_experience, bodyweight_kg, body_comp_phase, phase_target_weeks, training_days_per_week, allows_two_a_days, equipment",
      )
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("limitations")
      .select("region, kind, severity, affected_muscles")
      .eq("user_id", userId)
      .is("resolved_at", null)
      .order("started_at", { ascending: false })
      .limit(20),
    getTrainingMaxContext(),
    getPlannedDays(block.id, block.started_on ?? new Date().toISOString().slice(0, 10)),
  ]);

  const profile = (profileRes.data ?? null) as {
    training_experience: string | null;
    bodyweight_kg: number | string | null;
    body_comp_phase: string | null;
    phase_target_weeks: number | null;
    training_days_per_week: number | null;
    allows_two_a_days: boolean | null;
    equipment: unknown;
  } | null;

  const limitations = ((limitationsRes.data ?? []) as Array<{
    region: string | null;
    kind: string | null;
    severity: string | null;
    affected_muscles: string[] | null;
  }>).map((l) => ({
    region: l.region ?? null,
    kind: l.kind ?? null,
    severity: l.severity ?? null,
    affectedMuscles: Array.isArray(l.affected_muscles) ? l.affected_muscles : [],
  }));

  const trainingMaxes = tmCtx.rows.map((r) => ({
    movementName: r.movementName,
    oneRmKg: r.oneRmKg,
    effectivePercent: r.effectivePercent,
    tmKg: r.tmKg,
    source: r.source,
  }));

  const archetype = ARCHETYPES[block.archetype as Exclude<ArchetypeId, "custom">];
  const archetypeWeekProfiles =
    archetype?.weekProfiles.map((p) => ({
      weekIndex: p.weekIndex,
      intensityLabel: p.intensityLabel,
      setIntensities: p.setIntensities ?? [],
      setReps: p.setReps,
    })) ?? [];

  const focusMuscles = (block.focus_muscles ?? []).map(
    (m) => FOCUS_MUSCLE_LABEL[m as FocusMuscle] ?? m,
  );

  const bw = profile?.bodyweight_kg;

  const sessions: ReviewSession[] = plannedDays.map((d) => ({
    weekIndex: d.weekIndex,
    dayIndex: d.dayIndex,
    slot: d.slot,
    title: d.title,
    role: d.role ?? null,
    // modality + load aren't on PlannedDay; surfaced from the raw row would
    // need a second query — the prescription detail below is the substance.
    modality: null,
    effectiveStressLoad: null,
    items: (d.prescription.items ?? []).map(mapItem),
  }));

  return {
    generatedAt: new Date().toISOString(),
    athlete: {
      experienceTier: profile?.training_experience ?? null,
      bodyweightKg: bw != null ? Number(bw) : null,
      bodyCompPhase: profile?.body_comp_phase ?? null,
      phaseTargetWeeks: profile?.phase_target_weeks ?? null,
      trainingDaysPerWeek: profile?.training_days_per_week ?? null,
      allowsTwoADays: profile?.allows_two_a_days ?? null,
      equipment: summariseEquipment(profile?.equipment ?? null),
    },
    limitations,
    trainingMaxes,
    block: {
      archetypeId: block.archetype,
      archetypeName: archetype?.name ?? block.archetype,
      archetypeOneLiner: archetype?.oneLiner ?? null,
      weeks: block.weeks ?? archetypeWeekProfiles.length,
      startedOn: block.started_on ?? null,
      status: block.status ?? null,
      goal: block.goal ?? null,
      secondaryFocus: block.secondary_focus ?? null,
      focusMuscles,
      accessoryVolume: block.accessory_volume ?? null,
      powerEmphasis: block.power_emphasis ?? null,
      deloadWeekIndex: deloadWeekIndexFor(block.archetype, block.weeks ?? 0),
    },
    archetypeWeekProfiles,
    sessions,
  };
}
