"use server";

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { SWIM_COURSE_VERSION, swimScheduleAdvice, formatPoolCourse, formatSwimDistance, swimCourseWorkoutTitle } from "@hta/domain";
import { compileSwimCourseWorkout } from "@hta/engine";
import { addDaysToYmd } from "@/lib/dates";
import type { ActionResult } from "@/lib/offline/outbox-core";
import { parseSwimCourseFile, swimCourseWorkoutSchema } from "./course-file";
import { planPrivateSwimCourse } from "./course-planning";
import { privateSwimCourseAvailable } from "./course-capability";
import { parseSetupForm } from "./forms";
import { swimContext, swimActionFailure, SwimActionError, ownedSwimPlan, ownedSwimWorkout } from "./server-context";
import { checkSwimWorkouts } from "./workout-safety";
import { loadSwimStrengthContext } from "./strength-schedule";
import { swimInputId, swimToday } from "./queries";
import { createSwimPlan, listSwimPlans, updateSwimPlan } from "./storage";
import type { SwimCourseImportPreview, SwimCourseEditInput, SwimCourseEditPreview } from "./course-view";
import { SWIM_REFRESH_WARNING } from "./action-feedback";
import { isPrivateSwimPlan, swimWorkoutDefinition } from "./model";
import { workoutPresentation } from "./presentation";

const choicesSchema = z.array(z.object({
  weekIndex: z.number().int().min(0).max(15),
  workoutIndex: z.number().int().min(0).max(6),
  course: z.object({
    numerator: z.number().int().min(1).max(1000000),
    denominator: z.number().int().min(1).max(1000000), unit: z.literal("m"),
  }).strict(),
}).strict()).max(112);

async function prepare(form: FormData) {
  const { client, user } = await swimContext(true);
  if (!await privateSwimCourseAvailable(client)) throw new SwimActionError("Plan imports are unavailable.", "validation");
  const source = parseSwimCourseFile(z.string().parse(form.get("courseFile")));
  const fields = new FormData();
  form.forEach((value, key) => fields.append(key, value));
  fields.set("weeks", String(source.weeks.length));
  const input = parseSetupForm(fields, "course");
  if (input.observation) throw new SwimActionError("Import the course without an assessment.", "validation");
  const { today } = await swimToday(client, user.id);
  if (input.startDate < today) throw new SwimActionError("Choose today or a future start date.", "validation");
  const poolChoices = choicesSchema.parse(JSON.parse(z.string().parse(form.get("poolChoices") ?? "[]")));
  const planned = planPrivateSwimCourse({ source, ...input, poolChoices });
  const strengthContext = await loadSwimStrengthContext(client, user.id);
  const advice = swimScheduleAdvice(strengthContext, input.startDate, source.weeks.length, input.weekdays);
  const conflicts = advice.conflicts.map((day) => day.label);
  await checkSwimWorkouts(client, user.id, planned.workouts.map((row) => row.definition.issued));
  const id = swimInputId({
    userId: user.id, definition: planned.definition, workouts: planned.workouts,
    totals: planned.totals, today, strengthContext, confirmationKey: advice.confirmationKey,
  });
  const preview: SwimCourseImportPreview = {
    id, title: source.title, plan: planned.preview, totals: planned.totals, strengthDays: conflicts,
  };
  return { client, user, planned, preview, input };
}

const editSchema = z.object({
  planId: z.string().uuid(), revision: z.number().int().positive(),
  workoutId: z.string().uuid(), workoutRevision: z.number().int().positive(),
  workout: swimCourseWorkoutSchema, reason: z.string().trim().min(1).max(1000),
}).strict();

async function prepareEdit(value: SwimCourseEditInput) {
  const input = editSchema.parse(value);
  const { client, user } = await swimContext();
  if (!await privateSwimCourseAvailable(client)) throw new SwimActionError("Workout editing is unavailable.", "validation");
  const { plan } = await ownedSwimPlan(client, user.id, input.planId, input.revision);
  const row = await ownedSwimWorkout(client, user.id, input.workoutId);
  const { today } = await swimToday(client, user.id);
  const source = row.definition.courseSource;
  if (!isPrivateSwimPlan(plan) || !source || row.plan_id !== plan.id || row.revision !== input.workoutRevision ||
      !["active", "paused"].includes(plan.status) || row.status !== "scheduled" || row.session_id ||
      row.scheduled_date <= today) {
    throw new SwimActionError("Only future, unstarted workouts in this plan can be edited. Refresh and try again.", "validation");
  }
  const compiled = compileSwimCourseWorkout(input.workout, row.definition.issued.snapshot.course, plan.definition.setup);
  if (!compiled.ok) throw new SwimActionError(compiled.error.message, "validation");
  const issued = {
    ...compiled.value.workout,
    budget: { ...compiled.value.workout.budget, minutes: row.definition.issued.budget.minutes },
  };
  if (JSON.stringify(issued) === JSON.stringify(row.definition.issued)) {
    throw new SwimActionError("Change a workout field before saving.", "validation");
  }
  await checkSwimWorkouts(client, user.id, [issued]);
  const id = swimInputId({ input, plan, row, issued, today });
  const preview: SwimCourseEditPreview = {
    id, before: formatSwimDistance(row.definition.issued.totalLengths, row.definition.issued.snapshot.course),
    after: formatSwimDistance(issued.totalLengths, issued.snapshot.course),
    plan: {
      course: formatPoolCourse(issued.snapshot.course), workoutCount: 1,
      weeks: [{
        week: swimWorkoutDefinition(row).weekIndex + 1, startDate: row.scheduled_date, provisional: false,
        total: formatSwimDistance(issued.totalLengths, issued.snapshot.course),
        workouts: [{
          ...workoutPresentation(issued), title: swimCourseWorkoutTitle(source.title, swimWorkoutDefinition(row).slotId),
          date: row.scheduled_date, slotId: swimWorkoutDefinition(row).slotId,
        }],
      }],
    },
  };
  return { client, plan, row, input, issued, preview };
}

export async function previewPrivateSwimEdit(input: SwimCourseEditInput): Promise<ActionResult & { preview?: SwimCourseEditPreview }> {
  try { return { ok: true, preview: (await prepareEdit(input)).preview }; }
  catch (error) { return swimActionFailure(error); }
}

export async function savePrivateSwimEdit(input: SwimCourseEditInput, expectedPreview: string): Promise<ActionResult & { warning?: string }> {
  try {
    const { client, plan, row, input: parsed, issued, preview } = await prepareEdit(input);
    if (preview.id !== expectedPreview) throw new SwimActionError("The workout changed. Review it again.", "validation");
    const recordedAt = new Date().toISOString();
    await updateSwimPlan(client, {
      planId: plan.id, expectedRevision: plan.revision, definition: plan.definition,
      state: { ...plan.state, decisions: [...plan.state.decisions, {
        id: preview.id, kind: "progression", decision: "overridden", recordedAt, reason: parsed.reason,
        ruleVersion: SWIM_COURSE_VERSION, generatorVersion: SWIM_COURSE_VERSION,
        inputSnapshot: { operation: "course-edit", slotId: swimWorkoutDefinition(row).slotId, issued },
      }] },
      workouts: [{
        id: row.id, expected_revision: row.revision, scheduled_date: row.scheduled_date, slot: row.slot,
        definition: { ...row.definition, issued, modifications: [...row.definition.modifications, {
          id: randomUUID(), recordedAt, reason: parsed.reason, decisionId: preview.id, previous: row.definition.issued,
        }] },
      }],
    });
    try {
      revalidatePath("/app/swim");
      revalidatePath("/app/swim/[workoutId]", "page");
      revalidatePath("/app/plan");
      revalidatePath("/app");
      return { ok: true };
    } catch { return { ok: true, warning: SWIM_REFRESH_WARNING }; }
  } catch (error) { return swimActionFailure(error); }
}

export async function previewPrivateSwimCourse(form: FormData): Promise<ActionResult & { preview?: SwimCourseImportPreview }> {
  try { return { ok: true, preview: (await prepare(form)).preview }; }
  catch (error) { return swimActionFailure(error); }
}

export async function importPrivateSwimCourse(
  form: FormData, expectedPreview: string,
): Promise<ActionResult & { planId?: string; warning?: string }> {
  try {
    const prepared = await prepare(form);
    const { client, planned, preview, input } = prepared;
    if (preview.id !== expectedPreview) throw new SwimActionError("The plan changed. Review it again.", "validation");
    if (form.get("reviewed") !== "on" ||
        (preview.totals.length > 0 && form.get("acceptSetTotals") !== "on") ||
        (preview.strengthDays.length > 0 && form.get("acceptOverlap") !== "on")) {
      throw new SwimActionError("Confirm the plan and the highlighted changes before importing.", "validation");
    }
    const plans = (await listSwimPlans(client)).filter((plan) => plan.user_id === prepared.user.id);
    const previous = plans.find((plan) =>
      plan.definition.generatorVersion === SWIM_COURSE_VERSION &&
      plan.state.decisions.some((entry) => entry.id === preview.id && entry.inputSnapshot.operation === "course-import"));
    if (previous) return { ok: true, planId: previous.id };
    if (plans.some((plan) => plan.status === "active")) {
      throw new SwimActionError("Finish or archive your current swimming plan before importing another.", "validation");
    }
    const result = await createSwimPlan(client, {
      startedOn: input.startDate,
      endsOn: addDaysToYmd(input.startDate, planned.definition.schedule.weeks * 7 - 1),
      definition: planned.definition, workouts: planned.workouts,
      state: {
        version: 1, observations: [], acceptedCalibration: null,
        decisions: [{
          id: preview.id, kind: "setup", decision: "accepted", recordedAt: new Date().toISOString(),
          ruleVersion: SWIM_COURSE_VERSION, generatorVersion: SWIM_COURSE_VERSION,
          inputSnapshot: {
            operation: "course-import", totals: preview.totals, acceptSetTotals: preview.totals.length > 0,
            strengthDays: preview.strengthDays,
            workouts: planned.workouts.map((row) => ({
              slotId: row.definition.slotId, course: row.definition.issued.snapshot.course,
            })),
          },
        }],
      },
    });
    try {
      revalidatePath("/app/swim");
      revalidatePath("/app/plan");
      revalidatePath("/app");
      return { ok: true, planId: result.plan.id };
    } catch { return { ok: true, planId: result.plan.id, warning: SWIM_REFRESH_WARNING }; }
  } catch (error) { return swimActionFailure(error); }
}
