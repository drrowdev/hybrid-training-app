import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SWIM_COURSE_VERSION, planSwimConditioningBindings, validateConditioningChoices,
  type SwimConditioningSlot,
} from "@hta/domain";
import type { ProgramInstanceWrite } from "../platform/program-instance";
import { dayDate } from "../planner/queries";
import { PREFERRED_CARDIO_MODALITY_LABEL } from "../planner/preferred-cardio-modality";
import { addDaysToYmd } from "../dates";
import { isMissingRpc } from "../supabase/rpc-errors";
import { requireSwimSetup } from "./capability";
import { privateSwimCourseAvailable } from "./course-capability";
import { ownedSwimPlan, SwimActionError } from "./server-context";
import { checkSwimWorkouts } from "./workout-safety";
import { swimToday, swimInputId } from "./queries";
import { SwimInputError } from "./input-error";
import { planConditioningCourse, type ProgramConditioning } from "./conditioning-input";
import type { CreateSwimPlanInput } from "./storage";
import { conditioningStorageAvailable } from "./conditioning-storage";

const receiptSchema = z.object({
  block_id: z.string().uuid(), program_instance_id: z.string().uuid(), swim_plan_id: z.string().uuid(),
  skipped: z.number().int().nonnegative(),
}).strict();
export type ConditioningReceipt = z.infer<typeof receiptSchema>;
export type ProgramDeploymentArgs = {
  p_block: Record<string, unknown>;
  p_planned_sessions: Record<string, unknown>[];
  p_tm_percents: ProgramInstanceWrite["tmPercents"];
  p_program_instance: Record<string, unknown>;
};

export function conditioningSaveError(error: unknown): string {
  if (error instanceof SwimInputError || error instanceof SwimActionError) return error.message;
  return "The programme and swimming could not be saved. Reload before trying again.";
}

function storageError(error: { code?: string; message?: string }): SwimInputError {
  if (isMissingRpc(error)) return new SwimInputError("Swimming in programme setup is not available.");
  if (error.message === "CONDITIONING_COURSE_DOES_NOT_FIT") {
    return new SwimInputError("This swim plan does not fit the selected conditioning sessions. Review the schedule or choose another plan.");
  }
  if (error.message === "CONDITIONING_SAVED_PLAN_REMOVED") {
    return new SwimInputError("This programme was saved and later removed. Start a new programme instead.");
  }
  if (error.code === "40001" || error.message === "CONDITIONING_REQUEST_REUSED") {
    return new SwimInputError("The programme or swimming plan changed. Reload before saving.");
  }
  return new SwimInputError("The programme and swimming could not be saved. Reload before trying again.");
}

export async function programConditioningAvailable(client: SupabaseClient): Promise<boolean> {
  if (process.env.SWIM_CONDITIONING_ENABLED !== "true") return false;
  return conditioningStorageAvailable(client, true);
}

export async function readConditioningSave(
  client: SupabaseClient, requestId: string, requestInput: Record<string, unknown>,
): Promise<ConditioningReceipt | null> {
  const { data, error } = await client.rpc("swim_conditioning_replay", {
    p_request_id: requestId, p_request_input: requestInput,
  }).abortSignal(AbortSignal.timeout(10_000));
  if (error) throw storageError(error);
  const parsed = z.array(receiptSchema).max(1).safeParse(data);
  if (!parsed.success) throw new Error("The programme save could not be confirmed.");
  return parsed.data[0] ?? null;
}

export function applyConditioningChoices(write: ProgramInstanceWrite, conditioning: ProgramConditioning): ProgramInstanceWrite {
  const eligible = write.sessions.filter((session) =>
    session.role === "cardio" && session.prescription.items.length === 1 &&
    session.prescription.items[0]?.kind === "cardio_external");
  const validation = validateConditioningChoices(
    [...new Set(eligible.map((session) => session.dayIndex))], conditioning.choices,
  );
  if (!validation.ok) throw new SwimInputError(validation.error.message);
  const byDay = new Map(validation.value.map((choice) => [choice.weekday, choice.activity]));
  return {
    ...write,
    sessions: write.sessions.map((session) => {
      const activity = byDay.get(session.dayIndex);
      if (!activity || !eligible.includes(session)) return session;
      const label = PREFERRED_CARDIO_MODALITY_LABEL[activity];
      return { ...session, title: label, prescription: {
        ...session.prescription, items: session.prescription.items.map((item) => ({ ...item, intensityLabel: label })),
      } };
    }),
  };
}

export async function prepareConditioningSwim(
  client: SupabaseClient, userId: string, startedOn: string,
  write: ProgramInstanceWrite, conditioning: ProgramConditioning,
) {
  if (!await programConditioningAvailable(client)) throw new SwimInputError("Swimming in programme setup is not available.");
  await requireSwimSetup(client);
  const { today } = await swimToday(client, userId);
  const swim = conditioning.swim;
  if (!swim) throw new SwimInputError("Choose a swimming plan.");
  const swimDays = conditioning.choices.filter((choice) => choice.activity === "swimming").map((choice) => choice.weekday);
  const slots: SwimConditioningSlot[] = write.sessions
    .filter((session) => swimDays.includes(session.dayIndex))
    .map((session, index) => ({
      id: String(index), date: dayDate(startedOn, session.weekIndex, session.dayIndex), slot: session.slot,
      role: session.role, open: session.prescription.items.length === 1 &&
        session.prescription.items[0]?.kind === "cardio_external",
      status: "planned", sessionId: null, swimWorkoutId: null,
    }));
  if (swim.kind === "existing") {
    const { plan, workouts } = await ownedSwimPlan(client, userId, swim.planId, swim.revision);
    if (plan.status !== "active") throw new SwimInputError("Choose an active swimming plan.");
    const upcoming = workouts.filter((workout) => workout.scheduled_date >= today);
    if (!upcoming.length || upcoming.some((workout) => workout.status !== "scheduled" || workout.session_id !== null)) {
      throw new SwimInputError("Choose a swimming plan with unstarted upcoming workouts.");
    }
    const fit = planSwimConditioningBindings({
      today, slots, workouts: upcoming.map((workout) => ({ id: workout.id, date: workout.scheduled_date, slot: workout.slot })),
    });
    if (!fit.ok) throw new SwimInputError(fit.error.message);
    await checkSwimWorkouts(client, userId, upcoming.map((workout) => workout.definition.issued));
    return { plan_id: plan.id, expected_revision: plan.revision };
  }
  if (!await privateSwimCourseAvailable(client)) throw new SwimInputError("Plan imports are unavailable.");
  const course = planConditioningCourse(swim, startedOn, swimDays);
  if (!swim.reviewed || (course.totals.length > 0 && !swim.acceptSetTotals)) {
    throw new SwimInputError("Review the swims and confirm any distance changes before saving.");
  }
  const fit = planSwimConditioningBindings({
    today, slots, workouts: course.workouts.map((workout) => ({
      id: workout.definition.slotId, date: workout.scheduled_date, slot: workout.slot,
    })),
  });
  if (!fit.ok) throw new SwimInputError(fit.error.message);
  await checkSwimWorkouts(client, userId, course.workouts.map((workout) => workout.definition.issued));
  const state: CreateSwimPlanInput["state"] = {
    version: 1, observations: [], acceptedCalibration: null,
    decisions: [{
      id: swimInputId({ userId, requestId: conditioning.requestId, definition: course.definition, workouts: course.workouts }),
      kind: "setup", decision: "accepted", recordedAt: new Date().toISOString(),
      ruleVersion: SWIM_COURSE_VERSION, generatorVersion: SWIM_COURSE_VERSION,
      inputSnapshot: {
        operation: "course-import", totals: course.totals, acceptSetTotals: course.totals.length > 0,
        strengthDays: [], workouts: course.workouts.map((workout) => ({
          slotId: workout.definition.slotId, course: workout.definition.issued.snapshot.course,
        })),
      },
    }],
  };
  return {
    started_on: startedOn, ends_on: addDaysToYmd(startedOn, course.definition.schedule.weeks * 7 - 1),
    definition: course.definition, state, workouts: course.workouts,
  };
}

export async function deployProgramWithSwimming(
  client: SupabaseClient, requestId: string, requestInput: Record<string, unknown>,
  program: ProgramDeploymentArgs, swim: Awaited<ReturnType<typeof prepareConditioningSwim>>,
): Promise<ConditioningReceipt> {
  const { data, error } = await client.rpc("deploy_program_with_swimming", {
    ...program, p_request_id: requestId, p_request_input: requestInput, p_swim: swim,
  });
  if (error) throw storageError(error);
  const parsed = z.array(receiptSchema).length(1).safeParse(data);
  if (!parsed.success) throw new Error("The programme save could not be confirmed.");
  return parsed.data[0]!;
}
