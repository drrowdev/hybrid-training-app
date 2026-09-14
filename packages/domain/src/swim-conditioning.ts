import { swimErr, swimOk, type SwimResult } from "./swimming";

export const CONDITIONING_ACTIVITIES = ["running", "cycling", "swimming"] as const;
export type ConditioningActivity = (typeof CONDITIONING_ACTIVITIES)[number];
export type ConditioningChoice = {
  /** The primary programme uses Monday=0 through Sunday=6. */
  readonly weekday: number;
  readonly activity: ConditioningActivity;
};

export function validateConditioningChoices(
  weekdays: readonly number[], choices: readonly ConditioningChoice[],
): SwimResult<readonly ConditioningChoice[]> {
  if (weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(weekdays).size !== weekdays.length) {
    return swimErr("setup_invalid", "Review the conditioning days in your schedule.");
  }
  if (choices.some((choice) => !weekdays.includes(choice.weekday) ||
      !CONDITIONING_ACTIVITIES.includes(choice.activity)) ||
      new Set(choices.map((choice) => choice.weekday)).size !== choices.length) {
    return swimErr("setup_invalid", "Review the activity assigned to each conditioning day.");
  }
  return swimOk([...choices].sort((a, b) => a.weekday - b.weekday));
}

export type ConditioningSessionSlot = "single" | "am" | "pm";
export interface SwimConditioningSlot {
  readonly id: string;
  readonly date: string;
  readonly slot: ConditioningSessionSlot;
  readonly role: string;
  readonly open: boolean;
  readonly status: string;
  readonly sessionId: string | null;
  readonly swimWorkoutId: string | null;
}
export interface SwimConditioningWorkout {
  readonly id: string;
  readonly date: string;
  readonly slot: ConditioningSessionSlot;
}
export interface SwimConditioningBinding {
  readonly plannedSessionId: string;
  readonly swimWorkoutId: string;
  readonly date: string;
  readonly slot: ConditioningSessionSlot;
}

function validDate(date: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

/** Match explicit dates and slots, never compress or repeat a course to make it fit. */
export function planSwimConditioningBindings(input: {
  readonly today: string;
  readonly slots: readonly SwimConditioningSlot[];
  readonly workouts: readonly SwimConditioningWorkout[];
}): SwimResult<readonly SwimConditioningBinding[]> {
  const { today, slots, workouts } = input;
  const validSlot = (slot: ConditioningSessionSlot) => ["single", "am", "pm"].includes(slot);
  if (!validDate(today) || slots.some((slot) => !slot.id || !validDate(slot.date) || !validSlot(slot.slot)) ||
      workouts.some((workout) => !workout.id || !validDate(workout.date) || !validSlot(workout.slot))) {
    return swimErr("setup_invalid", "Review the workout dates in your schedule.");
  }
  const key = (row: { date: string; slot: ConditioningSessionSlot }) => `${row.date}:${row.slot}`;
  if (new Set(slots.map((slot) => slot.id)).size !== slots.length ||
      new Set(slots.map(key)).size !== slots.length ||
      new Set(workouts.map((workout) => workout.id)).size !== workouts.length ||
      new Set(workouts.map(key)).size !== workouts.length) {
    return swimErr("setup_invalid", "Each swim needs a different conditioning session.");
  }
  const byDate = new Map(slots.map((slot) => [key(slot), slot]));
  const bindings: SwimConditioningBinding[] = [];
  for (const workout of workouts) {
    const slot = byDate.get(key(workout));
    if (!slot) {
      return swimErr("setup_invalid", "This swim plan does not fit the selected conditioning sessions. Review the schedule or choose another plan.");
    }
    if (slot.role !== "cardio" || !slot.open || slot.status !== "planned" ||
        slot.sessionId !== null || slot.date < today ||
        (slot.swimWorkoutId !== null && slot.swimWorkoutId !== workout.id)) {
      return swimErr("setup_invalid", "Choose an unstarted conditioning session for this swim.");
    }
    bindings.push({ plannedSessionId: slot.id, swimWorkoutId: workout.id, date: slot.date, slot: slot.slot });
  }
  return swimOk(bindings);
}
