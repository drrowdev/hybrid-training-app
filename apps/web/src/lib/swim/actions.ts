"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  estimateCriticalSwimSpeed, poolCourseEquals,
  SWIM_ASSESSMENT_VERSION, type SwimWorkout, type SwimError,
} from "@hta/domain";
import {
  generateSwimPlan, applySwimProposal, applyAcceptedBenchmark, recordSwimDecision,
  SWIM_GENERATOR_VERSION, type SwimPlan,
} from "@hta/engine";
import type { SwimActualResult, SwimDecisionRecord } from "@hta/db";
import { addDaysToYmd } from "@/lib/dates";
import { recomputeAfterCompletedSessionMutation } from "@/lib/sessions/post-completion-recompute";
import type { ActionResult } from "@/lib/offline/outbox-core";
import * as storage from "./storage";
import { assertSwimSafety, swimWorkoutSafetyExposure } from "./safety";
import { parseActualForm, parseSetupForm, parseBenchmarkForm, parseSwimDate, parseSwimObservation } from "./forms";
import { swimContext, ownedSwimPlan, ownedSwimWorkout, swimActionFailure, SwimActionError } from "./server-context";
import {
  standaloneWeekRequests, swimPlanDefinition, swimWorkoutDefinition, SWIM_SCHEDULE_VERSION,
  type StandalonePlanDefinition, type StandaloneWorkoutDefinition, type SwimBenchmarkPreview,
} from "./model";
import {
  swimToday, loadSwimHistory, deriveSwimWeekCandidate, persistedSwimPlan, swimInputId,
} from "./queries";
import type { SwimResumePreview } from "./view-types";
import { formatPoolCourse } from "@hta/domain";
import { formatSwimTime } from "./time";

function refreshSwims(sessionId?: string) {
  for (const path of ["/app", "/app/plan", "/app/swim", "/app/stats", "/app/sessions"]) revalidatePath(path);
  revalidatePath("/app/swim/[workoutId]", "page");
  if (sessionId) revalidatePath(`/app/sessions/${sessionId}`);
}

async function checkWorkouts(client: Parameters<typeof assertSwimSafety>[0], userId: string, workouts: readonly SwimWorkout[]) {
  const regions = new Set(workouts.flatMap((workout) => swimWorkoutSafetyExposure(workout).regions));
  const slugs = new Set(workouts.map((workout) => workout.sections.some((section) =>
    section.items.some((item) => item.effort !== "easy" && item.effort !== "steady"))
    ? "swim-intervals" : "swim-easy"));
  const { data, error } = await client.from("movements").select("id,slug").in("slug", [...slugs]);
  if (error || !data || [...slugs].some((slug) => !data.some((row) => row.slug === slug))) {
    throw new SwimActionError("Could not check swim movements. Try again.", "transient");
  }
  await assertSwimSafety(client, userId, { regions: [...regions], movementIds: data.map((row) => row.id) });
}

function decision(kind: SwimDecisionRecord["kind"], selected: SwimDecisionRecord["decision"], inputSnapshot: Record<string, unknown>, id: string = randomUUID(), reason?: string): SwimDecisionRecord {
  return {
    id, kind, decision: selected, recordedAt: new Date().toISOString(),
    ruleVersion: kind === "assessment" ? SWIM_ASSESSMENT_VERSION : kind === "schedule" ? SWIM_SCHEDULE_VERSION : SWIM_GENERATOR_VERSION,
    generatorVersion: SWIM_GENERATOR_VERSION,
    inputSnapshot, ...(reason ? { reason } : {}),
  };
}

function resultFromForm(fields: ReturnType<typeof parseActualForm>, workout: storage.SwimWorkoutRow, existing?: SwimActualResult | null): SwimActualResult {
  const snapshot = existing?.snapshot ?? workout.definition.issued.snapshot;
  const course = fields.course ?? snapshot.course;
  if (!poolCourseEquals(course, workout.definition.issued.snapshot.course) && !fields.reason.trim()) {
    throw new SwimActionError("Add a reason for the different pool.", "validation");
  }
  const strokes = fields.stroke === "planned" ? snapshot.strokes : [fields.stroke];
  const unchangedConditions = poolCourseEquals(course, snapshot.course) &&
    JSON.stringify(strokes) === JSON.stringify(snapshot.strokes) &&
    JSON.stringify([...snapshot.equipment].sort()) === JSON.stringify([...fields.equipment].sort());
  return {
    version: 1,
    snapshot: {
      ...snapshot, course, strokes, equipment: fields.equipment,
      ...(unchangedConditions ? {} : { calibration: null, protocol: null, versions: { ...snapshot.versions, assessment: null } }),
    },
    lengths: fields.lengths, timeMs: fields.timeMs, rpe: fields.rpe,
    completion: fields.lengths < workout.definition.issued.totalLengths || fields.reason ? "partial" : "completed",
    splits: fields.splits,
    provenance: { source: "manual", recordedAt: existing?.provenance.recordedAt ?? new Date().toISOString(), ...(fields.reason ? { deviationReason: fields.reason } : {}) },
  };
}

function setupConflict(error: SwimError): ActionResult & { options: string[] } {
  const options = z.array(z.string()).safeParse(error.details?.options);
  return { error: error.message, errorCode: "validation", options: options.success ? options.data : [] };
}

export async function createSwimPlan(form: FormData): Promise<ActionResult & { planId?: string; guidance?: string; options?: string[] }> {
  try {
    const { client, user } = await swimContext(true);
    const input = parseSetupForm(form);
    const { today } = await swimToday(client, user.id);
    if (input.startDate < today) throw new SwimActionError("Choose today or a future start date.", "validation");
    if (input.observation && input.observation.observedOn > today) throw new SwimActionError("Choose the date you swam the assessment.", "validation");
    const calibration = input.observation ? estimateCriticalSwimSpeed(input.observation) : null;
    if (calibration && !calibration.ok) throw new SwimActionError(calibration.error.message, "validation");
    const generated = generateSwimPlan({
      setup: input.setup, calibration: calibration?.ok ? calibration.value : null,
      weeks: standaloneWeekRequests(input.startDate, input.weeks, input.weekdays),
    });
    if (!generated.ok) return setupConflict(generated.error);
    const slots = generated.value.weeks.flatMap((week) => week.slots);
    const guidance = slots.find((slot) => slot.kind === "guidance");
    if (guidance?.kind === "guidance") return { guidance: guidance.guidance.steps.join(" ") };
    const conflict = slots.find((slot) => slot.kind === "conflict");
    if (conflict?.kind === "conflict") return setupConflict(conflict.conflict);
    const workouts: storage.SwimWorkoutInput[] = generated.value.weeks.flatMap((week) => week.slots.flatMap((slot) => {
      if (slot.kind !== "workout") return [];
      const definition: StandaloneWorkoutDefinition = {
        version: 1, original: slot.original, issued: slot.issued, modifications: [],
        weekIndex: week.weekIndex, slotId: slot.slotId, intent: slot.intent, provisional: week.provisional,
      };
      return [{ scheduled_date: slot.dateISO, slot: "single" as const, definition }];
    }));
    await checkWorkouts(client, user.id, workouts.map((row) => row.definition.issued));
    const definition: StandalonePlanDefinition = {
      version: 1, setup: input.setup, generatorVersion: SWIM_GENERATOR_VERSION,
      schedule: { startDate: input.startDate, weeks: input.weeks, weekdays: input.weekdays },
      initialDose: generated.value.dose,
    };
    const created = await storage.createSwimPlan(client, {
      startedOn: input.startDate, endsOn: addDaysToYmd(input.startDate, input.weeks * 7 - 1), definition,
      state: {
        version: 1, observations: input.observation ? [input.observation] : [],
        acceptedCalibration: generated.value.calibration,
        decisions: [decision("setup", "accepted", { ...input, versions: generated.value.versions })],
      }, workouts,
    });
    refreshSwims();
    return { ok: true, planId: created.plan.id };
  } catch (error) { return swimActionFailure(error); }
}

export async function startSwimWorkout(workoutId: string, revision: number): Promise<ActionResult> {
  try {
    const { client, user } = await swimContext();
    const workout = await ownedSwimWorkout(client, user.id, workoutId);
    if (!workout.session_id) await checkWorkouts(client, user.id, [workout.definition.issued]);
    await storage.startSwimWorkout(client, workoutId, z.number().int().positive().parse(revision));
    refreshSwims();
    return { ok: true };
  } catch (error) { return swimActionFailure(error); }
}

export async function completeSwimWorkoutResult(form: FormData): Promise<ActionResult> {
  try {
    const fields = parseActualForm(form);
    if (!fields.clientLogId) throw new SwimActionError("A saved completion receipt is required.", "validation");
    const { client, user } = await swimContext();
    const workout = await ownedSwimWorkout(client, user.id, fields.workoutId);
    if (workout.session_id !== fields.sessionId) throw new SwimActionError("This session does not belong to the swim.", "forbidden");
    const completed = await storage.completeSwimWorkout(client, {
      workoutId: workout.id, expectedRevision: fields.expectedRevision,
      result: resultFromForm(fields, workout), notes: fields.notes || null,
      clientLogId: fields.clientLogId, completionEntryId: fields.clientLogId,
      allowChangedCourse: !!fields.course,
    });
    // Rebuilding the existing ledger is replay-safe, including a retry after an
    // acknowledged database commit but a lost response. It never appends load.
    await recomputeAfterCompletedSessionMutation({ supabase: client, userId: user.id, sessionId: completed.session_id });
    refreshSwims(completed.session_id);
    return { ok: true };
  } catch (error) { return swimActionFailure(error); }
}

export async function editSwimResult(form: FormData): Promise<ActionResult> {
  try {
    const fields = parseActualForm(form);
    const { client, user } = await swimContext();
    const workout = await ownedSwimWorkout(client, user.id, fields.workoutId);
    if (workout.session_id !== fields.sessionId) throw new SwimActionError("This session does not belong to the swim.", "forbidden");
    const existing = await storage.getSwimResult(client, fields.sessionId);
    if (!existing) throw new SwimActionError("No saved swim result was found.", "not_found");
    const edited = await storage.editSwimResult(client, {
      workoutId: workout.id, expectedRevision: fields.expectedRevision,
      result: resultFromForm(fields, workout, existing),
      ...(fields.notesSupplied ? { notes: fields.notes || null } : {}),
      allowChangedCourse: !!fields.course || !poolCourseEquals(existing.snapshot.course, workout.definition.issued.snapshot.course),
    });
    await recomputeAfterCompletedSessionMutation({ supabase: client, userId: user.id, sessionId: edited.session_id });
    refreshSwims(edited.session_id);
    return { ok: true };
  } catch (error) { return swimActionFailure(error); }
}

export async function skipSwimWorkout(workoutId: string, revision: number, reason: string): Promise<ActionResult> {
  try {
    const { client, user } = await swimContext();
    await ownedSwimWorkout(client, user.id, workoutId);
    const why = z.string().trim().min(1).max(1000).parse(reason);
    await storage.skipSwimWorkout(client, workoutId, z.number().int().positive().parse(revision), why);
    refreshSwims();
    return { ok: true };
  } catch (error) { return swimActionFailure(error); }
}

export async function changeSwimPlanStatus(planId: string, revision: number, status: "paused" | "finished" | "archived"): Promise<ActionResult> {
  try {
    const { client, user } = await swimContext();
    await ownedSwimPlan(client, user.id, planId, revision);
    await storage.setSwimPlanStatus(client, planId, revision, z.enum(["paused", "finished", "archived"]).parse(status));
    refreshSwims();
    return { ok: true };
  } catch (error) { return swimActionFailure(error); }
}

export async function proposeSwimWeek(planId: string, revision: number): Promise<ActionResult> {
  try {
    const { client, user } = await swimContext();
    const { plan, workouts } = await ownedSwimPlan(client, user.id, planId, revision);
    const { today } = await swimToday(client, user.id);
    if (!deriveSwimWeekCandidate(plan, await loadSwimHistory(client, workouts), today)) {
      throw new SwimActionError("Finish this week's swims before reviewing the next week.", "validation");
    }
    return { ok: true };
  } catch (error) { return swimActionFailure(error); }
}

function futureUpdates(plan: SwimPlan, workouts: storage.SwimWorkoutRow[], today: string, decisionId: string, reason: string, confirmWorkoutIds?: readonly string[]) {
  const issued = new Map(plan.weeks.flatMap((week) => week.slots.flatMap((slot) => slot.kind === "workout" ? [[slot.slotId, slot.issued] as const] : [])));
  return workouts.flatMap((row) => {
    if (row.session_id || row.status !== "scheduled" || row.scheduled_date <= today) return [];
    const current = swimWorkoutDefinition(row);
    const next = issued.get(current.slotId);
    if (!next) return [];
    const changed = JSON.stringify(next) !== JSON.stringify(row.definition.issued);
    const confirmed = confirmWorkoutIds?.includes(row.id) ?? false;
    if (!changed && !(confirmed && current.provisional)) return [];
    const definition: StandaloneWorkoutDefinition = {
      ...current, issued: next, provisional: confirmed ? false : current.provisional,
      modifications: changed ? [...row.definition.modifications, { id: randomUUID(), recordedAt: new Date().toISOString(), decisionId, reason, previous: row.definition.issued }] : row.definition.modifications,
    };
    return [{ id: row.id, expected_revision: row.revision, scheduled_date: row.scheduled_date, slot: row.slot, definition }];
  });
}

export async function decideSwimProposal(planId: string, revision: number, proposalId: string, choice: "accepted" | "rejected" | "overridden", override?: string, reason?: string): Promise<ActionResult & { warning?: string }> {
  try {
    const { client, user } = await swimContext();
    const { plan, workouts } = await ownedSwimPlan(client, user.id, planId, revision);
    const { today } = await swimToday(client, user.id);
    const history = await loadSwimHistory(client, workouts);
    const candidate = deriveSwimWeekCandidate(plan, history, today);
    if (!candidate || candidate.id !== proposalId) throw new SwimActionError("This recommendation changed. Reload and review it again.", "validation");
    const selected = z.enum(["accepted", "rejected", "overridden"]).parse(choice);
    let dose = candidate.proposal.to;
    if (selected === "overridden") {
      const mainRepeats = z.coerce.number().int().min(1).max(2000).parse(override);
      z.string().trim().min(1).max(1000).parse(reason);
      const from = candidate.proposal.from;
      dose = { ...from, mainRepeats };
    }
    const ledger = recordSwimDecision(null, {
      proposal: candidate.proposal, action: selected === "accepted" ? "accept" : selected === "rejected" ? "reject" : "override",
      atISO: new Date().toISOString(), ...(selected === "overridden" ? { override: dose, note: reason } : {}),
    });
    const appliedDose = ledger.currentDose;
    const generated = applySwimProposal(persistedSwimPlan(plan, workouts), appliedDose, {
      asOfISO: today, startedSlotIds: workouts.filter((row) => row.session_id || row.status !== "scheduled" || !candidate.targetWorkoutIds.includes(row.id)).map((row) => swimWorkoutDefinition(row).slotId),
    });
    if (!generated.ok) throw new SwimActionError(generated.error.message, "validation");
    const record = decision("progression", selected, { ...candidate.exactInputs, proposal: candidate.proposal, engineDecision: ledger.entries[0], appliedDose }, candidate.id, reason);
    const updates = selected === "rejected" ? [] : futureUpdates(generated.value, workouts, today, record.id, reason ?? `Week ${candidate.targetWeek + 1}: ${candidate.proposal.decision}`, candidate.targetWorkoutIds);
    if (updates.length) await checkWorkouts(client, user.id, updates.map((row) => row.definition.issued));
    await storage.updateSwimPlan(client, { planId, expectedRevision: revision, definition: plan.definition, state: { ...plan.state, decisions: [...plan.state.decisions, record] }, workouts: updates });
    refreshSwims();
    const warning = ledger.entries[0]?.warning;
    return { ok: true, ...(warning ? { warning } : {}) };
  } catch (error) { return swimActionFailure(error); }
}

export async function proposeSwimBenchmark(planId: string, revision: number, form: FormData): Promise<ActionResult & { preview?: SwimBenchmarkPreview }> {
  try {
    const { client, user } = await swimContext();
    const { plan } = await ownedSwimPlan(client, user.id, planId, revision);
    const observation = parseBenchmarkForm(form, plan.definition.setup.course);
    if (!observation) throw new SwimActionError("Enter both 200 and 400 times.", "validation");
    const { today } = await swimToday(client, user.id);
    if (observation.observedOn > today) throw new SwimActionError("Choose the date you swam the assessment.", "validation");
    const calibration = estimateCriticalSwimSpeed(observation);
    if (!calibration.ok) throw new SwimActionError(calibration.error.message, "validation");
    return { ok: true, preview: {
      id: swimInputId({ observation, revision }), observation, planRevision: revision,
      changes: [{ title: `${formatPoolCourse(observation.course)} · 200 / 400 ${observation.course.unit === "yd" ? "yard" : "field"} estimate`,
        before: plan.state.acceptedCalibration ? `${formatSwimTime(Math.round(plan.state.acceptedCalibration.msPer100))} / 100 ${observation.course.unit}` : "Effort only",
        after: `${formatSwimTime(Math.round(calibration.value.msPer100))} / 100 ${observation.course.unit}` }],
    } };
  } catch (error) { return swimActionFailure(error); }
}

export async function decideSwimBenchmark(planId: string, preview: SwimBenchmarkPreview, choice: "accepted" | "rejected"): Promise<ActionResult> {
  try {
    const { client, user } = await swimContext();
    const { plan, workouts } = await ownedSwimPlan(client, user.id, planId, preview.planRevision);
    const observation = parseSwimObservation(preview.observation);
    const calibration = estimateCriticalSwimSpeed(observation);
    if (!calibration.ok) throw new SwimActionError(calibration.error.message, "validation");
    if (!poolCourseEquals(preview.observation.course, plan.definition.setup.course) ||
      preview.id !== swimInputId({ observation: preview.observation, revision: preview.planRevision })) throw new SwimActionError("Review this assessment again.", "validation");
    const selected = z.enum(["accepted", "rejected"]).parse(choice);
    const { today } = await swimToday(client, user.id);
    if (observation.observedOn > today) throw new SwimActionError("Choose the date you swam the assessment.", "validation");
    const generated = applyAcceptedBenchmark(persistedSwimPlan(plan, workouts), calibration.value, {
      asOfISO: today, startedSlotIds: workouts.filter((row) => row.session_id || row.status !== "scheduled").map((row) => swimWorkoutDefinition(row).slotId),
    });
    const record = decision("assessment", selected, { observation, calibration: calibration.value, revision: preview.planRevision, workouts: workouts.map((row) => ({ id: row.id, revision: row.revision, issued: row.definition.issued })) }, preview.id);
    const updates = selected === "rejected" ? [] : futureUpdates(generated, workouts, today, record.id, "Accepted assessment");
    if (updates.length) await checkWorkouts(client, user.id, updates.map((row) => row.definition.issued));
    await storage.updateSwimPlan(client, {
      planId, expectedRevision: preview.planRevision, definition: plan.definition,
      state: { ...plan.state, observations: [...plan.state.observations, observation],
        acceptedCalibration: selected === "accepted" ? calibration.value : plan.state.acceptedCalibration,
        decisions: [...plan.state.decisions, record] }, workouts: updates,
    });
    refreshSwims();
    return { ok: true };
  } catch (error) { return swimActionFailure(error); }
}

export async function previewSwimResume(planId: string, revision: number, startDate: string): Promise<ActionResult & { preview?: SwimResumePreview }> {
  try {
    const { client, user } = await swimContext();
    const { plan, workouts } = await ownedSwimPlan(client, user.id, planId, revision);
    const { today } = await swimToday(client, user.id);
    if (plan.status !== "paused") throw new SwimActionError("Only a paused plan can be resumed.", "validation");
    parseSwimDate(startDate);
    if (startDate < today) throw new SwimActionError("Choose today or a future resume date.", "validation");
    const pause = plan.state.pauseSnapshot;
    if (!pause) throw new SwimActionError("The paused schedule is unavailable. Reload and try again.", "validation");
    const remaining = workouts.filter((row) => pause.workoutIds.includes(row.id) && !row.session_id && row.status === "scheduled")
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.id.localeCompare(b.id));
    if (!remaining.length) throw new SwimActionError("No swims remain. Finish this plan and set up another.", "validation");
    const weekIndexes = remaining.map((row) => swimWorkoutDefinition(row).weekIndex);
    const firstWeek = Math.min(...weekIndexes);
    const weeks = standaloneWeekRequests(startDate, Math.max(...weekIndexes) - firstWeek + 1, swimPlanDefinition(plan).schedule.weekdays);
    const used = new Map<number, number>();
    // Keep partial weeks and gaps; never pack two issued weeks into one new week.
    const dates = remaining.map((row) => {
      const week = swimWorkoutDefinition(row).weekIndex;
      const index = used.get(week) ?? 0;
      const slot = weeks[week - firstWeek]?.slots[index];
      if (!slot) throw new SwimActionError("The remaining swims need more days. Review the schedule.", "validation");
      used.set(week, index + 1);
      return { id: row.id, revision: row.revision, date: slot.dateISO };
    });
    return { ok: true, preview: { planId, revision, startDate, dates } };
  } catch (error) { return swimActionFailure(error); }
}

export async function resumeSwimPlan(preview: SwimResumePreview): Promise<ActionResult> {
  try {
    const fresh = await previewSwimResume(preview.planId, preview.revision, preview.startDate);
    if (fresh.error) return fresh;
    if (JSON.stringify(fresh.preview) !== JSON.stringify(preview)) throw new SwimActionError("These dates changed. Preview them again.", "validation");
    const { client, user } = await swimContext();
    const { plan, workouts } = await ownedSwimPlan(client, user.id, preview.planId, preview.revision);
    const updates = preview.dates.map((entry) => {
      const row = workouts.find((workout) => workout.id === entry.id)!;
      return { id: row.id, expected_revision: entry.revision, scheduled_date: entry.date, slot: row.slot, definition: row.definition };
    });
    await checkWorkouts(client, user.id, updates.map((row) => row.definition.issued));
    const record = decision("schedule", "accepted", { preview });
    await storage.resumeSwimPlan(client, {
      planId: plan.id, expectedRevision: preview.revision, definition: plan.definition,
      state: { ...plan.state, decisions: [...plan.state.decisions, record] }, workouts: updates,
    });
    refreshSwims();
    return { ok: true };
  } catch (error) { return swimActionFailure(error); }
}
