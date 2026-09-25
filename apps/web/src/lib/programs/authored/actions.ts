"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  authoredMovementIds, authoredRehabProtocolIds, authoredProgramDates, compileAuthoredWorkout, trainingScheduleAdvice,
  type AuthoredCatalogMovement, type AuthoredPrescriptionItem, type AuthoredProgramDefinition, type TrainingCommitment,
} from "@hta/domain";
import type { Prescription } from "@hta/db";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { todayYmd, daysBetweenYmd, mondayOfYmd, addDaysToYmd } from "@/lib/dates";
import { assertCatalogMovementAllowed, deriveLimitationsContext } from "@/lib/planner/limitations-context";
import { toCatalogMovement, CATALOG_SELECT, type DbMovement } from "@/lib/planner/picker-catalog";
import { classifySessionModality, effectiveStressLoad, type ClassifierMovement } from "@/lib/planner/session-modality";
import { prescriptionCarriesUserState } from "@/lib/sessions/prescription-mutations";
import { planForwardOnlyRewrite } from "@/lib/platform/forward-rewrite";
import { commitTrainingSchedule, loadTrainingSchedule, scheduleInputHash, scheduleReviewSchema, type ScheduleReview } from "@/lib/schedule/storage";
import { authoredProgramSchema, authoredSaveSchema, type AuthoredSaveInput } from "./schema";
import { loadOwnedActivePrograms, requireIndependentPrograms, selectProgramTarget } from "@/lib/programs/ownership";
import { loadOwnedRehabProtocols } from "@/lib/rehab-protocols/owned";
import { compileLibraryRehab } from "@/lib/rehab-protocols/prescription";

const catalogRowSchema = z.object({
  id: z.string(), slug: z.string(), display_name: z.string(), pattern: z.string(),
  metadata: z.record(z.unknown()).nullable(),
}).passthrough();
const storedRowSchema = z.object({
  id: z.string(), week_index: z.number(), day_index: z.number(), slot: z.enum(["single", "am", "pm"]),
  title: z.string().nullable(), role: z.string(), prescription: z.custom<Prescription>((value) =>
    typeof value === "object" && value !== null && "items" in value && Array.isArray(value.items)),
  completed_session_id: z.string().nullable(), skipped_at: z.string().nullable(),
  planned_at: z.string().nullable(), notes: z.string().nullable(),
});

export interface AuthoredPreview {
  id: string;
  revision: string;
  dates: { date: string; title: string; itemCount: number }[];
  overlaps: TrainingCommitment[];
  plannedRest: TrainingCommitment[];
  replaces: string | null;
  replacesBlockId: string | null;
  preserved: number;
}

function modality(value: unknown): string | null {
  if (value === "running" || value === "run") return "run";
  if (value === "cycling" || value === "bike") return "bike";
  if (value === "rowing" || value === "row") return "row";
  if (value === "ski_erg" || value === "skiing" || value === "ski") return "ski";
  return null;
}

function workoutClassification(prescription: Prescription) {
  const movements: ClassifierMovement[] = prescription.items.map((item) => item.kind.startsWith("cardio_")
    ? { kind: "conditioning", cardioBlock: { mode: item.kind === "cardio_z2" ? "z2" : "hiit", durationMinutes: item.durationMin ?? 0 }, estimatedHardSets: 0 }
    : { kind: item.kind === "main" ? "main" : "accessory", bucket: item.kind === "main" ? "main" : "accessory", estimatedHardSets: 1 });
  const sessionModality = classifySessionModality({ movements });
  return {
    role: prescription.items.every((item) => item.kind.startsWith("cardio_")) ? "cardio" : "strength",
    session_modality: sessionModality,
    effective_stress_load: effectiveStressLoad({ modality: sessionModality, hardSets: movements.reduce((sum, movement) => sum + movement.estimatedHardSets, 0) }),
  };
}

async function prepare(raw: AuthoredSaveInput) {
  const input = authoredSaveSchema.parse(raw);
  const { data: { user } } = await getAuthUser();
  if (!user) throw new Error("Sign in to save a program.");
  const client = await createClient();
  await requireIndependentPrograms(client);
  // Capture before any dependent read, then revalidate inside the write transaction.
  const snapshot = await loadTrainingSchedule(client);
  if (input.editBlockId && input.editRevision !== snapshot.revision) {
    throw new Error("This program changed in another tab. Your changes have not been saved. Reload the current version before reapplying.");
  }
  const protocols = await loadOwnedRehabProtocols(client, user.id, authoredRehabProtocolIds(input.definition));
  const movementIds = [...new Set([...authoredMovementIds(input.definition), ...protocols.flatMap((protocol) => protocol.items.map((item) => item.movementId))])];
  const [catalogResult, limitationsResult, profileResult, activeResult] = await Promise.all([
    client.from("movements").select(`${CATALOG_SELECT},metadata`).in("id", movementIds),
    client.from("limitations").select("region,kind,resolved_at,affected_muscles,affected_movement_ids,allowed_movement_ids")
      .eq("user_id", user.id).is("resolved_at", null),
    client.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    loadOwnedActivePrograms(client, user.id),
  ]);
  if (catalogResult.error || limitationsResult.error || profileResult.error) {
    throw new Error("Could not check your program and exercises. Try again.");
  }
  const catalogRows = z.array(catalogRowSchema).parse(catalogResult.data);
  const catalog: AuthoredCatalogMovement[] = catalogRows.map((row) => ({
    id: row.id, slug: row.slug, displayName: row.display_name, pattern: row.pattern, modality: modality(row.metadata?.modality),
  }));
  const limits = deriveLimitationsContext(limitationsResult.data ?? []);
  for (const row of catalogResult.data ?? []) {
    assertCatalogMovementAllowed(toCatalogMovement(row as DbMovement), limits);
  }
  const today = todayYmd(profileResult.data?.timezone ?? "UTC");
  const compileRehab = (protocolId: string, partId: string): AuthoredPrescriptionItem[] => {
    const protocol = protocols.find((entry) => entry.id === protocolId);
    if (!protocol) throw new Error("Choose an available rehab protocol from your library.");
    return compileLibraryRehab(protocol, `authored:${partId}`).map((item) => {
      const movement = catalog.find((entry) => entry.id === item.movementId);
      if (!movement || movement.pattern === "cardio") throw new Error("A rehab exercise is no longer available. Update the protocol.");
      let circuit: AuthoredPrescriptionItem["circuit"];
      if (item.circuit) {
        if (item.circuit.round == null) throw new Error("Could not prepare the rehab superset.");
        circuit = { ...item.circuit, round: item.circuit.round };
      }
      return { movementId: movement.id, movementSlug: movement.slug, movementName: movement.displayName, kind: "tendon", isAmrap: false,
        sets: item.sets, reps: item.reps, repRange: item.repRange, holdSec: item.holdSec,
        targetWeightKg: item.targetWeightKg, notes: item.notes, circuit,
        meta: { ...item.meta, authoredPartId: partId, rehab: true },
      };
    });
  };
  const active = selectProgramTarget(activeResult, input.definition.activity, input.editBlockId);
  if (input.editBlockId && (active?.id !== input.editBlockId || active.program_id !== "authored")) {
    throw new Error("This program is no longer active.");
  }
  if (input.editBlockId && input.startedOn !== active?.started_on) throw new Error("Keep the original start date when editing a program.");
  if (!input.editBlockId && input.startedOn < today) throw new Error("Choose today or a future start date.");
  const dated = authoredProgramDates(input.definition, input.startedOn);
  const rows = dated.map(({ date, workout, weekIndex, dayIndex, ref }) => {
    const prescription: Prescription = { ...compileAuthoredWorkout(workout, catalog, compileRehab), programRef: ref };
    if (prescription.items.length > 500) throw new Error("Keep each workout to 500 sets and cardio parts or fewer.");
    return {
      date, workoutId: workout.id, ref,
      week_index: weekIndex, day_index: dayIndex, slot: "single" as const,
      title: workout.name, prescription, ...workoutClassification(prescription),
    };
  });
  const weeks = Math.max(...rows.map((row) => row.week_index)) + 1;
  let existing: z.infer<typeof storedRowSchema>[] = [];
  if (input.editBlockId) {
    const result = await client.from("planned_sessions").select("id,week_index,day_index,slot,title,role,prescription,completed_session_id,skipped_at,planned_at,notes")
      .eq("user_id", user.id).eq("block_id", input.editBlockId).order("week_index").order("day_index");
    if (result.error) throw new Error("Could not load the workouts to edit. Try again.");
    existing = z.array(storedRowSchema).parse(result.data);
  }
  let scoped: { updates: ({ id: string; title: string; prescription: Prescription } & ReturnType<typeof workoutClassification>)[];
    definition: AuthoredProgramDefinition | null } | undefined;
  if (input.scope !== "program") {
    const original = await loadAuthoredProgram(input.editBlockId!);
    const workout = input.definition.workouts.find((entry) => entry.id === input.workoutId);
    const originalWorkout = original.workouts.find((entry) => entry.id === input.workoutId);
    const selected = existing.find((row) => row.id === input.plannedSessionId);
    const unchanged = (definition: AuthoredProgramDefinition) => ({ ...definition, workouts: definition.workouts.filter((entry) => entry.id !== input.workoutId) });
    if (!workout || !originalWorkout || !selected || workout.weekday !== originalWorkout.weekday ||
        JSON.stringify(unchanged(input.definition)) !== JSON.stringify(unchanged(original)) ||
        !selected.prescription.programRef?.startsWith(`authored:${workout.id}:`)) {
      throw new Error("Only the selected workout can be changed here. Edit the program to change its week.");
    }
    const dateOf = (row: z.infer<typeof storedRowSchema>) => addDaysToYmd(mondayOfYmd(input.startedOn), row.week_index * 7 + row.day_index);
    if (dateOf(selected) < today || selected.completed_session_id || selected.skipped_at) {
      throw new Error("Only upcoming, unstarted workouts can be edited.");
    }
    const eligible = input.scope === "workout" ? [selected] : existing.filter((row) =>
      row.prescription.programRef?.startsWith(`authored:${workout.id}:`) && dateOf(row) >= dateOf(selected) &&
      !row.completed_session_id && !row.skipped_at);
    const compiled = compileAuthoredWorkout(workout, catalog, compileRehab);
    if (compiled.items.length > 500) throw new Error("Keep each workout to 500 sets and cardio parts or fewer.");
    scoped = {
      updates: eligible.map((row) => ({ id: row.id, title: workout.name, ...workoutClassification(compiled), prescription: {
        ...row.prescription, ...compiled, programRef: row.prescription.programRef,
        meta: { ...row.prescription.meta, ...compiled.meta },
      } })),
      definition: input.scope === "future" ? input.definition : null,
    };
    const preview: AuthoredPreview = {
      id: scheduleInputHash({ input, scoped, revision: snapshot.revision }), revision: snapshot.revision,
      dates: eligible.map((row) => ({ date: dateOf(row), title: workout.name, itemCount: compiled.items.length })),
      overlaps: [], plannedRest: [], replaces: null, replacesBlockId: null, preserved: existing.length - eligible.length,
    };
    return { input, user, client, preview, rows, weeks, existing, rewrite: null, scoped };
  }
  const days = daysBetweenYmd(mondayOfYmd(input.startedOn), today);
  const rewrite = planForwardOnlyRewrite({
    currentWeekIndex: Math.floor(days / 7), currentDayIndex: ((days % 7) + 7) % 7, writeWeeks: weeks,
    existingFuture: existing.map((row) => ({
      id: row.id, weekIndex: row.week_index, dayIndex: row.day_index, slot: row.slot, role: row.role,
      programRef: row.prescription.programRef,
      touched: !!(row.completed_session_id || row.skipped_at || row.planned_at || row.notes?.trim() || prescriptionCarriesUserState(row.prescription)),
    })),
    newSessions: rows.map((row) => ({ weekIndex: row.week_index, dayIndex: row.day_index, slot: row.slot, role: row.role, programRef: row.ref })),
  });
  const proposed = input.editBlockId ? rewrite.insertIndices.map((index) => rows[index]!) : rows;
  const excluded = active ? { source: "primary" as const, programId: active.id, retainExistingOverlaps: !!input.editBlockId } : undefined;
  const advice = trainingScheduleAdvice(snapshot.entries, proposed.map((row) => row.date), excluded);
  const preview: AuthoredPreview = {
    id: scheduleInputHash({ input, rows, snapshot: snapshot.revision }),
    revision: snapshot.revision,
    dates: proposed.map((row) => ({ date: row.date, title: row.title, itemCount: row.prescription.items.length })),
    overlaps: advice.overlaps, plannedRest: advice.plannedRest,
    replaces: !input.editBlockId && active ? active.notes ?? "Current program" : null,
    replacesBlockId: !input.editBlockId && active ? active.id : null,
    preserved: existing.length - rewrite.deleteIds.length,
  };
  return { input, user, client, preview, rows, weeks, existing, rewrite, scoped };
}

export async function previewAuthoredProgram(input: AuthoredSaveInput): Promise<
  { ok: true; preview: AuthoredPreview } | { ok: false; error: string }
> {
  try { return { ok: true, preview: (await prepare(input)).preview }; }
  catch (error) { return { ok: false, error: error instanceof z.ZodError ? error.issues[0]?.message ?? "Review your program." : error instanceof Error ? error.message : "Could not preview your program." }; }
}

export async function saveAuthoredProgram(
  raw: AuthoredSaveInput, expectedPreview: string, rawReview: ScheduleReview,
): Promise<{ ok: true; blockId: string } | { ok: false; error: string }> {
  try {
    const review = scheduleReviewSchema.parse(rawReview);
    const input = authoredSaveSchema.parse(raw);
    const client = await createClient();
    const { data: { user } } = await getAuthUser();
    if (!user) return { ok: false, error: "Sign in to save a program." };
    const operation = input.scope !== "program" ? "authored-workout" : input.editBlockId ? "primary-update" : "primary-create";
    const inputHash = scheduleInputHash(input);
    const replay = await client.from("engine_override_events").select("context").eq("id", review.requestId).eq("user_id", user.id).maybeSingle();
    if (replay.error) throw new Error("Could not check this save. Try again.");
    if (replay.data) {
      const context = z.object({ kind: z.literal("training-schedule-v1"), operation: z.string(), inputHash: z.string(), result: z.unknown(),
        programOwnershipVersion: z.number().optional(), replacedBlockId: z.string().nullable().optional(),
      }).parse(replay.data.context);
      if (context.operation !== operation || context.inputHash !== inputHash) throw new Error("This save request was already used for a different change.");
      if (operation === "primary-create" && context.programOwnershipVersion &&
          (context.replacedBlockId ?? null) !== (review.replaceBlockId ?? null)) throw new Error("This save request belongs to a different program target.");
      const blockId = input.editBlockId ?? z.object({ block_id: z.string().uuid() }).parse(context.result).block_id;
      return { ok: true, blockId };
    }
    const prepared = await prepare(input);
    const { preview, rows, weeks, existing, rewrite, scoped } = prepared;
    if (preview.id !== expectedPreview || preview.revision !== review.revision) throw new Error("Your program or schedule changed. Review it again.");
    if (preview.overlaps.length > 0 && !review.acceptOverlap) throw new Error("Accept the overlapping workouts before saving.");
    if (preview.replacesBlockId && review.replaceBlockId !== preview.replacesBlockId) throw new Error("Confirm which program to replace.");
    if (scoped) {
      const result = await commitTrainingSchedule(client, operation, {
        updates: scoped.updates, blockId: input.editBlockId, definition: scoped.definition, programKind: input.definition.activity,
        p_rehab_bindings: authoredRehabProtocolIds(input.definition).map((id) => ({ localProtocolId: id, rehabProtocolId: id })),
      }, review, input);
      if (result.error) throw new Error(result.error.message);
      revalidatePath("/app"); revalidatePath("/app/plan"); revalidatePath("/app/programs");
      return { ok: true, blockId: input.editBlockId! };
    }
    if (!rewrite) throw new Error("Could not prepare the program changes.");
    const metadata = {
      weeks: input.editBlockId ? rewrite.newWeeks : weeks,
      days_per_week: input.definition.workouts.length,
      day_index_overrides: { days: input.definition.workouts.map((workout) => workout.weekday).sort(), twoADay: false },
      cardio_source: "internal", notes: input.definition.name,
    };
    const instance = {
      program_id: "authored", program_family: input.definition.activity,
      instance: input.definition,
      setup_input: { version: 1, definition: input.definition, startedOn: input.startedOn },
      display_name: input.definition.name, customization_version: 1,
    };
    const persistedRows = rows.map(({ date: _date, workoutId: _workoutId, ref: _ref, ...row }) => row);
    const args = input.editBlockId ? {
      p_block_id: input.editBlockId, programKind: input.definition.activity, p_strength_updates: [],
      p_deletions: existing.filter((row) => rewrite.deleteIds.includes(row.id)).map((row) => ({
        id: row.id, weekIndex: row.week_index, dayIndex: row.day_index, slot: row.slot,
        role: row.role, currentPrescription: row.prescription,
      })),
      p_insertions: rewrite.insertIndices.map((index) => persistedRows[index]),
      p_block_metadata: metadata, p_tm_percents: [], p_program_instance: instance,
    } : {
      p_block: { ...metadata, program_kind: input.definition.activity, program_id: "authored", program_family: input.definition.activity, started_on: input.startedOn,
        allows_two_a_days: false, accessory_volume: "medium" },
      p_planned_sessions: persistedRows, p_tm_percents: [], p_program_instance: instance,
    };
    const result = await commitTrainingSchedule(client, operation, { ...args,
      p_rehab_bindings: authoredRehabProtocolIds(input.definition).map((id) => ({ localProtocolId: id, rehabProtocolId: id })),
    }, review, input);
    if (result.error) throw new Error(result.error.message);
    const blockId = input.editBlockId ?? z.object({ block_id: z.string().uuid() }).parse(result.data).block_id;
    revalidatePath("/app"); revalidatePath("/app/plan"); revalidatePath("/app/programs");
    return { ok: true, blockId };
  } catch (error) {
    return { ok: false, error: error instanceof z.ZodError ? error.issues[0]?.message ?? "Review your program." : error instanceof Error ? error.message : "Could not save your program." };
  }
}

export async function loadAuthoredProgram(blockId: string) {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) throw new Error("Sign in to edit your program.");
  const result = await client.from("program_instances").select("instance,block_id")
    .eq("block_id", z.string().uuid().parse(blockId)).eq("program_id", "authored")
    .eq("user_id", user.id).eq("status", "active").is("deleted_at", null).maybeSingle();
  if (result.error || !result.data) throw new Error("This program is no longer available to edit.");
  return authoredProgramSchema.parse(result.data.instance);
}

export async function reloadAuthoredProgram(blockId: string) {
  const client = await createClient();
  const snapshot = await loadTrainingSchedule(client);
  const definition = await loadAuthoredProgram(blockId);
  return { revision: snapshot.revision, definition };
}
