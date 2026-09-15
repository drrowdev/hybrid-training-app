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

export function remapConditioningChoices(
  choices: readonly ConditioningChoice[], weekdays: readonly number[],
): SwimResult<readonly ConditioningChoice[]> {
  const prior = validateConditioningChoices(choices.map((choice) => choice.weekday), choices);
  if (!prior.ok) return prior;
  if (choices.length !== weekdays.length) {
    return swimErr("setup_invalid", "Keep the same number of conditioning days when editing this swimming programme.");
  }
  const days = [...weekdays].sort((a, b) => a - b);
  return validateConditioningChoices(days, prior.value.map((choice, index) => ({ ...choice, weekday: days[index]! })));
}

/** Keep recorded work in place and move each remaining swim to its week's corresponding slot. */
export function planSwimConditioningEdit(input: {
  today: string;
  workouts: readonly (SwimConditioningWorkout & { plannedSessionId: string; weekIndex: number; movable: boolean })[];
  slots: readonly (SwimConditioningWorkout & { weekIndex: number })[];
}): SwimResult<{
  moves: { id: string; plannedSessionId: string; date: string }[];
  claimedSlotIds: string[];
}> {
  const { today, workouts, slots } = input;
  const all = [...workouts, ...slots];
  if (!validDate(today) || all.some((row) => !validDate(row.date) ||
    !Number.isSafeInteger(row.weekIndex) || row.weekIndex < 0) ||
    new Set(workouts.map((row) => row.id)).size !== workouts.length ||
    new Set(workouts.map((row) => row.plannedSessionId)).size !== workouts.length ||
    new Set(slots.map((row) => row.id)).size !== slots.length ||
    new Set(slots.map((row) => `${row.date}:${row.slot}`)).size !== slots.length) {
    return swimErr("setup_invalid", "The swimming schedule changed. Reload before saving.");
  }
  const order = (a: SwimConditioningWorkout, b: SwimConditioningWorkout) =>
    a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot) || a.id.localeCompare(b.id);
  const moves: { id: string; plannedSessionId: string; date: string }[] = [];
  const claimedSlotIds: string[] = [];
  for (const week of new Set(workouts.map((row) => row.weekIndex))) {
    const existing = workouts.filter((row) => row.weekIndex === week).sort(order);
    const targets = slots.filter((row) => row.weekIndex === week).sort(order);
    if (existing.every((row) => row.date < today) && targets.every((row) => row.date < today)) continue;
    if (targets.length !== existing.length) {
      return swimErr("setup_invalid", "The remaining swims do not fit this schedule. Keep their weekly frequency and programme length.");
    }
    for (const [index, workout] of existing.entries()) {
      const target = targets[index]!;
      claimedSlotIds.push(target.id);
      if (!workout.movable || workout.date <= today) continue;
      if (target.date <= today || target.slot !== workout.slot) {
        return swimErr("setup_invalid", "Choose future conditioning days without changing morning or evening sessions.");
      }
      if (workout.date === target.date) continue;
      moves.push({ id: workout.id, plannedSessionId: workout.plannedSessionId, date: target.date });
    }
  }
  const dates = new Map(moves.map((move) => [move.id, move.date]));
  const occupied = workouts.map((workout) => `${dates.get(workout.id) ?? workout.date}:${workout.slot}`);
  if (new Set(occupied).size !== occupied.length) {
    return swimErr("setup_invalid", "This schedule overlaps a swim that must keep its date. Choose different conditioning days.");
  }
  return swimOk({ moves, claimedSlotIds });
}
