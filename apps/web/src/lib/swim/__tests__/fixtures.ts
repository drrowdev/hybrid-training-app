import { generateSwimPlan, SWIM_GENERATOR_VERSION } from "@hta/engine";
import type { SwimSetup } from "@hta/domain";
import { standaloneWeekRequests, type StandalonePlanDefinition, type StandaloneWorkoutDefinition, type SwimHistoryRow } from "../model";
import type { SwimPlanRow, SwimWorkoutRow } from "../storage";

export const userId = "00000000-0000-4000-8000-000000000001";
export const planId = "00000000-0000-4000-8000-000000000002";
export const sessionId = "00000000-0000-4000-8000-000000000003";
export const receiptId = "00000000-0000-4000-8000-000000000004";

export function swimFixture() {
  const setup: SwimSetup = {
    goal: "technique_base", experience: "recreational",
    course: { numerator: 25, denominator: 1, unit: "yd" }, knownStrokes: ["freestyle"],
    equipment: [], recentComfortableLengths: 12, sessionBudgetMinutes: 60,
  };
  const generated = generateSwimPlan({ setup, calibration: null, weeks: standaloneWeekRequests("2026-09-07", 3, [1, 4]) });
  if (!generated.ok) throw new Error(generated.error.message);
  const definition: StandalonePlanDefinition = {
    version: 1, setup, generatorVersion: SWIM_GENERATOR_VERSION,
    schedule: { startDate: "2026-09-07", weeks: 3, weekdays: [1, 4] }, initialDose: generated.value.dose,
  };
  const plan: SwimPlanRow = {
    id: planId, user_id: userId, status: "active", started_on: "2026-09-07", ends_on: "2026-09-27", revision: 1,
    definition, state: { version: 1, observations: [], acceptedCalibration: null, decisions: [] },
    created_at: "2026-09-05T12:00:00Z", updated_at: "2026-09-05T12:00:00Z",
  };
  let index = 10;
  const workouts: SwimWorkoutRow[] = generated.value.weeks.flatMap((week) => week.slots.map((slot) => {
    if (slot.kind !== "workout") throw new Error("Expected workout");
    const definition: StandaloneWorkoutDefinition = {
      version: 1, original: slot.original, issued: slot.issued, modifications: [],
      weekIndex: week.weekIndex, slotId: slot.slotId, intent: slot.intent, provisional: week.provisional,
    };
    return {
      id: `00000000-0000-4000-8000-${String(index++).padStart(12, "0")}`, user_id: userId, plan_id: planId,
      scheduled_date: slot.dateISO, slot: "single", revision: 1, status: "scheduled", session_id: null,
      definition, created_at: plan.created_at, updated_at: plan.updated_at,
    };
  }));
  const history: SwimHistoryRow[] = workouts.map((workout, index) => {
    const done = index < 2;
    return {
      workout: done ? { ...workout, status: "completed", session_id: sessionId } : workout,
      result: done ? {
        version: 1, snapshot: workout.definition.issued.snapshot, lengths: workout.definition.issued.totalLengths,
        timeMs: 1200000, rpe: 5, completion: "completed",
        provenance: { source: "manual", recordedAt: `${workout.scheduled_date}T12:00:00Z` },
      } : null,
      notes: null, performedAt: done ? `${workout.scheduled_date}T12:00:00Z` : null,
      completedAt: done ? `${workout.scheduled_date}T12:20:00Z` : null, deleted: false, sourceGone: false,
    };
  });
  return { plan, workouts, history };
}
