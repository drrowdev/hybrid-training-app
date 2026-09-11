import type { SwimActualResult, SwimPlanDefinition, SwimWorkoutDefinition } from "@hta/db";
import { swimWeeksFromWeekdays, type SwimDose, type SwimPlan, type SwimProposal, type SwimSlotIntent, type SwimWeekRequest } from "@hta/engine";
import type { SwimObservation, SwimSettledResult } from "@hta/domain";
import type { SwimPlanRow, SwimWorkoutRow } from "./storage";
import { SwimInputError } from "./input-error";
import { z } from "zod";
import { addDaysToYmd } from "@/lib/dates";

export const SWIM_SCHEDULE_VERSION = "swim-standalone-schedule-1";

export type StandalonePlanDefinition = SwimPlanDefinition & {
  schedule: { startDate: string; weeks: number; weekdays: number[] };
  initialDose: SwimDose;
};
export type StandaloneWorkoutDefinition = SwimWorkoutDefinition & {
  weekIndex: number; slotId: string; intent: SwimSlotIntent["intent"]; provisional: boolean;
  skip?: { reason: string | null; recordedAt: string };
};
export type SwimHistoryRow = {
  workout: SwimWorkoutRow;
  result: SwimActualResult | null;
  notes: string | null;
  performedAt: string | null;
  completedAt: string | null;
  deleted: boolean;
  sourceGone: boolean;
};
export type SwimWeekCandidate = {
  id: string; proposal: SwimProposal; sourceWeek: number; targetWeek: number;
  targetWorkoutIds: string[];
  input: { setup: StandalonePlanDefinition["setup"]; dose: SwimDose; history: SwimSettledResult[]; asOfISO: string };
  exactInputs: Record<string, unknown>;
  generated: SwimPlan;
};
export type SwimBenchmarkPreview = {
  id: string; observation: SwimObservation; planRevision: number;
  changes: { title: string; before: string; after: string }[];
};

export function swimPlanDefinition(plan: SwimPlanRow): StandalonePlanDefinition {
  const definition = plan.definition as StandalonePlanDefinition;
  if (!definition.schedule || !definition.initialDose) throw new Error("This swim plan has an unsupported schedule.");
  return definition;
}

export function swimWorkoutDefinition(workout: SwimWorkoutRow): StandaloneWorkoutDefinition {
  const definition = workout.definition as StandaloneWorkoutDefinition;
  if (!Number.isInteger(definition.weekIndex) || !definition.slotId) throw new Error("This swim workout has an unsupported schedule.");
  return definition;
}

export function standaloneWeekRequests(startDate: string, weeks: number, weekdays: readonly number[]): SwimWeekRequest[] {
  const result = swimWeeksFromWeekdays({
    startDateISO: startDate, weeks, weekdays, defaultIntent: "moderate", source: "swim_date",
  });
  if (!result.ok) throw new SwimInputError(result.error.message);
  return [...result.value];
}

export function swimWorkoutDateRange(plan: SwimPlanRow, workouts: SwimWorkoutRow[], workout: SwimWorkoutRow, today: string) {
  const weekIndex = swimWorkoutDefinition(workout).weekIndex;
  let startDate = swimPlanDefinition(plan).schedule.startDate;
  let firstWeek = 0;
  const resume = [...plan.state.decisions].reverse().find((entry) => entry.kind === "schedule" && entry.decision === "accepted");
  if (resume) {
    const preview = z.object({
      startDate: z.string(), dates: z.array(z.object({ id: z.string().uuid() })).min(1),
    }).parse(resume.inputSnapshot.preview);
    const ids = new Set(preview.dates.map((entry) => entry.id));
    if (ids.has(workout.id)) {
      startDate = preview.startDate;
      firstWeek = Math.min(...workouts.filter((row) => ids.has(row.id)).map((row) => swimWorkoutDefinition(row).weekIndex));
    }
  }
  const week = standaloneWeekRequests(startDate, weekIndex - firstWeek + 1, [0, 1, 2, 3, 4, 5, 6]).at(-1)!;
  const endDate = addDaysToYmd(week.startDateISO, 6);
  const tomorrow = addDaysToYmd(today, 1);
  const min = [week.startDateISO, plan.started_on, tomorrow].sort().at(-1)!;
  return {
    min,
    max: endDate < plan.ends_on ? endDate : plan.ends_on,
  };
}
