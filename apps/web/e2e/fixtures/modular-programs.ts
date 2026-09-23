import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { PlatformContext, ProgramEngine } from "@hta/program-core";
import type { Page } from "@playwright/test";
import {
  authoredMovementIds, authoredProgramDates, authoredRehabProtocolIds, compileAuthoredWorkout, poolCourse,
  SWIM_COURSE_VERSION, type AuthoredCatalogMovement, type AuthoredProgramDefinition, type AuthoredWorkoutPart,
} from "@hta/domain";
import { acceptanceAssert as assert } from "../../scripts/swim-acceptance-errors";
import { authoredProgramSchema } from "../../src/lib/programs/authored/schema";
import { classifySessionModality, effectiveStressLoad, type ClassifierMovement } from "../../src/lib/planner/session-modality";
import { loadOwnedRehabProtocols } from "../../src/lib/rehab-protocols/owned";
import { compileLibraryRehab } from "../../src/lib/rehab-protocols/prescription";
import { planPrivateSwimCourse } from "../../src/lib/swim/course-planning";
import { syntheticCourse } from "../../src/lib/swim/__tests__/course-fixtures";
import { addDaysToYmd } from "../../src/lib/dates";
import { buildProgramInstanceWrite } from "../../src/lib/platform/program-instance";
import type { MovementResolver } from "../../src/lib/platform/adapter";
import { programSetupAuditInput } from "../../src/lib/platform/setup-audit";
import { STATIC_ENGINE_MOVEMENTS } from "../../src/lib/platform/movement-keys";
import { DEFAULT_ROUNDING_KG } from "../../src/lib/platform/rounding";

export function nativeTemplateInput<I>(args: {
  engine: ProgramEngine<I>; values: Record<string, unknown>; ctx: PlatformContext;
  resolveMovement: MovementResolver; kind: "strength" | "hybrid"; weekdays: number[]; startedOn: string;
  startWeekIndex?: number;
}) {
  const { engine, values, ctx, resolveMovement, kind, weekdays, startedOn, startWeekIndex } = args;
  const instance = engine.setup({ values }, ctx);
  const write = buildProgramInstanceWrite({
    engine, instance, ctx, resolveMovement, weekdays, startedOn, startWeekIndex, programOwnedLoads: true,
  });
  assert(write.sessions.length > 0 && write.skipped.length === 0, "Native template must retain every prescribed item");
  return {
    p_block: { program_id: engine.meta.id, program_family: engine.meta.family, program_kind: kind,
      started_on: startedOn, weeks: write.weeks, days_per_week: write.daysPerWeek,
      day_index_overrides: write.dayIndexOverrides, cardio_source: "internal", allows_two_a_days: false,
      accessory_volume: "medium", notes: engine.meta.name },
    p_planned_sessions: write.sessions.map((session) => ({
      week_index: session.weekIndex, day_index: session.dayIndex, slot: session.slot,
      title: session.title, role: session.role, prescription: session.prescription,
      session_modality: session.sessionModality, effective_stress_load: session.effectiveStressLoad,
    })),
    p_tm_percents: [],
    p_program_instance: { program_id: engine.meta.id, program_family: engine.meta.family, instance,
      setup_input: programSetupAuditInput({ values, weekdays, startedOn, startWeekIndex }),
      display_name: null, customization_version: null },
  };
}

export async function prepareNativeMeasurements(actor: SupabaseClient) {
  const signed = await actor.auth.getUser();
  assert(signed.error === null && signed.data.user, "Authenticated native owner required");
  const oneRepMaxes = { bench: 100, squat: 100, deadlift: 150, press: 60 };
  const keys = Object.keys(oneRepMaxes);
  const result = await actor.from("movements").select("id,slug,display_name")
    .in("slug", keys.map((key) => STATIC_ENGINE_MOVEMENTS[key]!.slug)).is("user_id", null);
  assert(result.error === null, "Native measurement library read failed");
  const movements = z.array(z.object({ id: z.string().uuid(), slug: z.string(), display_name: z.string() })).length(4).parse(result.data);
  const resolveMovement: MovementResolver = (key) => {
    const row = movements.find((entry) => entry.slug === STATIC_ENGINE_MOVEMENTS[key]?.slug);
    return row ? { movementId: row.id, slug: row.slug, displayName: row.display_name } : undefined;
  };
  const maxes = await actor.from("training_maxes").insert(Object.entries(oneRepMaxes).map(([key, oneRmKg]) => {
    const movement = resolveMovement(key);
    assert(movement, "Native measurement movement missing");
    return { user_id: signed.data.user!.id, movement_id: movement.movementId, one_rm_kg: oneRmKg, tm_percent: 97 };
  })).select("movement_id");
  assert(maxes.error === null && maxes.data?.length === 4, "Native owned measurement preparation failed");
  return { ctx: { oneRepMaxes, roundingKg: DEFAULT_ROUNDING_KG }, resolveMovement };
}

export function authoredProgramInput(
  definition: AuthoredProgramDefinition, startedOn: string, catalog: readonly AuthoredCatalogMovement[],
  compileRehab?: Parameters<typeof compileAuthoredWorkout>[2],
) {
  authoredProgramSchema.parse(definition);
  const planned = authoredProgramDates(definition, startedOn).map(({ workout, weekIndex, dayIndex, ref }) => {
    const prescription = { ...compileAuthoredWorkout(workout, catalog, compileRehab), programRef: ref };
    const movements: ClassifierMovement[] = prescription.items.map((item) => item.kind.startsWith("cardio_")
      ? { kind: "conditioning", cardioBlock: { mode: item.kind === "cardio_z2" ? "z2" : "hiit", durationMinutes: item.durationMin ?? 0 }, estimatedHardSets: 0 }
      : { kind: item.kind === "main" ? "main" : "accessory", bucket: item.kind === "main" ? "main" : "accessory", estimatedHardSets: 1 });
    const modality = classifySessionModality({ movements });
    return {
      week_index: weekIndex, day_index: dayIndex, slot: "single", title: workout.name, prescription,
      role: prescription.items.every((item) => item.kind.startsWith("cardio_")) ? "cardio" : "strength",
      session_modality: modality,
      effective_stress_load: effectiveStressLoad({ modality, hardSets: movements.reduce((sum, item) => sum + item.estimatedHardSets, 0) }),
    };
  });
  return {
    p_block: { program_id: "authored", program_family: definition.activity, started_on: startedOn,
      weeks: Math.max(...planned.map((row) => row.week_index)) + 1, days_per_week: definition.workouts.length,
      day_index_overrides: { days: definition.workouts.map((workout) => workout.weekday) },
      cardio_source: "internal", allows_two_a_days: false, accessory_volume: "medium", notes: definition.name },
    p_planned_sessions: planned, p_tm_percents: [],
    p_program_instance: { program_id: "authored", program_family: definition.activity, display_name: definition.name,
      customization_version: 1, instance: definition, setup_input: { version: 1, definition, startedOn } },
  };
}

export function nativeProgramDefinition(
  activity: AuthoredProgramDefinition["activity"], name: string, weekday: number,
  liftId: string, runId: string, protocolId?: string,
): AuthoredProgramDefinition {
  const lift: AuthoredWorkoutPart = { id: randomUUID(), kind: "movement", movement: {
    id: randomUUID(), movementId: liftId, role: "main", sets: 1, dose: { kind: "reps", reps: 5 },
    weightKg: 20, restSeconds: 0, notes: "",
  } };
  const run: AuthoredWorkoutPart = { id: randomUUID(), kind: "cardio", movementId: runId, modality: "run",
    intensity: "z2", repeats: 1, notes: "", intervals: [
      { id: randomUUID(), label: "Easy run", effort: "easy", target: { kind: "time", seconds: 60 } },
    ] };
  return {
    version: 1, activity, name, weeks: 1, workouts: [{ id: randomUUID(), name: `${name} workout`, weekday,
      parts: [...(activity === "strength" ? [lift] : activity === "running" ? [run] : [run, lift]),
        ...(protocolId ? [{ id: randomUUID(), kind: "rehab" as const, protocolId }] : [])] }],
  };
}

export async function nativeScheduleCommit(actor: SupabaseClient, operation: string, args: object, acceptOverlap = false) {
  const snapshot = await actor.rpc("training_schedule_snapshot");
  assert(snapshot.error === null, "Owned native schedule snapshot failed");
  const revision = z.object({ revision: z.string().min(1) }).parse(snapshot.data).revision;
  const committed = await actor.rpc("independent_program_schedule_commit", {
    p_operation: operation, p_args: args, p_expected_revision: revision,
    p_request_id: randomUUID(), p_input_hash: createHash("sha256").update(JSON.stringify(args)).digest("hex"),
    p_accept_overlap: acceptOverlap,
  });
  assert(committed.error === null, "Owned native schedule preparation failed");
  return committed.data as unknown;
}

export async function prepareNativeProgram(
  actor: SupabaseClient, definition: AuthoredProgramDefinition, startedOn: string, replaceBlockId?: string,
) {
  const signed = await actor.auth.getUser();
  assert(signed.error === null && signed.data.user, "Authenticated native owner required");
  const userId = signed.data.user.id;
  const protocols = await loadOwnedRehabProtocols(actor, userId, authoredRehabProtocolIds(definition));
  const ids = [...new Set([...authoredMovementIds(definition), ...protocols.flatMap((protocol) => protocol.items.map((item) => item.movementId))])];
  const rows = await actor.from("movements").select("id,slug,display_name,pattern,metadata").in("id", ids);
  assert(rows.error === null, "Owned native library read failed");
  const catalog = z.array(z.object({
    id: z.string().uuid(), slug: z.string(), display_name: z.string(), pattern: z.string(),
    metadata: z.record(z.unknown()).nullable(),
  })).parse(rows.data).map((row) => ({
    id: row.id, slug: row.slug, displayName: row.display_name, pattern: row.pattern,
    modality: row.metadata?.modality === "running" ? "run" : null,
  }));
  const input = authoredProgramInput(definition, startedOn, catalog, (protocolId, partId) => {
    const protocol = protocols.find((candidate) => candidate.id === protocolId);
    assert(protocol, "Owned native rehab protocol missing");
    return compileLibraryRehab(protocol, `authored:${partId}`).map((item) => {
      const movement = catalog.find((candidate) => candidate.id === item.movementId);
      assert(movement && movement.pattern !== "cardio" && (!item.circuit || item.circuit.round !== undefined),
        "Native rehab prescription is incomplete");
      const circuit = item.circuit ? { ...item.circuit, round: item.circuit.round! } : undefined;
      return { movementId: movement.id, movementName: movement.displayName, movementSlug: movement.slug,
        kind: "tendon" as const, isAmrap: false as const, circuit,
        sets: item.sets, reps: item.reps, repRange: item.repRange, holdSec: item.holdSec,
        targetWeightKg: item.targetWeightKg, notes: item.notes,
        meta: { ...item.meta, authoredPartId: partId, rehab: true } };
    });
  });
  const result = await nativeScheduleCommit(actor, "primary-create", {
    ...input, p_block: { ...input.p_block, program_kind: definition.activity },
    p_rehab_bindings: protocols.map((protocol) => ({ localProtocolId: protocol.id, rehabProtocolId: protocol.id })),
    ...(replaceBlockId ? { p_replace_block_id: replaceBlockId } : {}),
  }, true);
  return z.object({ block_id: z.string().uuid(), program_instance_id: z.string().uuid() }).parse(result);
}

export async function prepareNativeCourse(actor: SupabaseClient, startDate: string) {
  const signed = await actor.auth.getUser();
  assert(signed.error === null && signed.data.user, "Authenticated native owner required");
  const sunday = new Date(`${startDate}T00:00:00Z`).getUTCDay();
  const planned = planPrivateSwimCourse({
    source: syntheticCourse(), startDate, weekdays: [sunday, (sunday + 2) % 7], poolChoices: [],
    setup: { course: poolCourse(25, 1, "m"), goal: "endurance", experience: "trained", knownStrokes: ["freestyle"],
      equipment: [], recentComfortableLengths: 40, sessionBudgetMinutes: null },
  });
  assert(planned.totals.length === 0, "Native course requires a separate set-total review");
  const result = await nativeScheduleCommit(actor, "swim-create", {
    p_started_on: startDate, p_ends_on: addDaysToYmd(startDate, planned.definition.schedule.weeks * 7 - 1),
    p_definition: planned.definition, p_workouts: planned.workouts,
    p_state: { version: 1, observations: [], acceptedCalibration: null, decisions: [{
      id: randomUUID(), kind: "setup", decision: "accepted", recordedAt: new Date().toISOString(),
      ruleVersion: SWIM_COURSE_VERSION, generatorVersion: SWIM_COURSE_VERSION,
      inputSnapshot: { operation: "course-import", totals: [], acceptSetTotals: false, strengthDays: [],
        workouts: planned.workouts.map((row) => ({ slotId: row.definition.slotId, course: row.definition.issued.snapshot.course })) },
    }] },
  }, true);
  return z.object({ plan: z.object({ id: z.string().uuid() }),
    workouts: z.array(z.object({ id: z.string().uuid(), scheduled_date: z.string() })).length(3) }).parse(result);
}

export async function readNativeOutbox(page: Page) {
  const rows = await page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const open = indexedDB.open("hta-offline", 1);
    open.onupgradeneeded = () => { open.transaction?.abort(); reject(new Error("Native outbox has not been initialized")); };
    open.onerror = () => reject(open.error ?? new Error("Native outbox could not be read"));
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction("outbox", "readonly");
      const request = transaction.objectStore("outbox").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Native outbox entries could not be read"));
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Native outbox read aborted")); };
    };
  }));
  return z.array(z.object({ id: z.string().uuid(), sessionId: z.string().uuid(), op: z.string() }).passthrough()).parse(rows);
}
