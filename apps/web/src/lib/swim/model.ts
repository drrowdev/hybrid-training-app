import type { SwimActualResult, SwimPlanDefinition, SwimWorkoutDefinition } from "@hta/db";
import { swimWeeksFromWeekdays, type SwimDose, type SwimPlan, type SwimProposal, type SwimSlotIntent, type SwimWeekRequest } from "@hta/engine";
import type { SwimObservation, SwimSettledResult } from "@hta/domain";
import type { SwimPlanRow, SwimWorkoutRow } from "./storage";
import { SwimInputError } from "./input-error";

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
