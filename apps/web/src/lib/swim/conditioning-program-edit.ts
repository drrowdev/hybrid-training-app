import type { SupabaseClient } from "@supabase/supabase-js";
import { planSwimConditioningEdit, remapConditioningChoices } from "@hta/domain";
import type { ProgramInstanceWrite } from "../platform/program-instance";
import { dayDate } from "../planner/queries";
import { conditioningStorageAvailable } from "./conditioning-storage";
import type { ConditioningSwimRow } from "./conditioning-view";
import { applyConditioningChoices } from "./program-conditioning";
import { SwimInputError } from "./input-error";
import { isMissingRpc } from "../supabase/rpc-errors";
import { savedConditioningSchema } from "./conditioning-input";

type PrimaryRow = {
  id: string; week_index: number; day_index: number; slot: string;
  planned_at: string | null; notes: string | null; prescription: unknown;
};

export async function readConditioningEditRows(client: SupabaseClient, userId: string, blockId: string) {
  if (!await conditioningStorageAvailable(client)) return [];
  const { data, error } = await client.from("swim_conditioning_sessions").select("*")
    .eq("user_id", userId).eq("block_id", blockId).order("id").limit(367)
    .returns<ConditioningSwimRow[]>().abortSignal(AbortSignal.timeout(10_000));
  if (error || !data || data.length > 366 || data.some((row) => row.user_id !== userId ||
    row.block_id !== blockId || !row.planned_session_id) || new Set(data.map((row) => row.id)).size !== data.length) {
    throw new SwimInputError("The swimming schedule could not be loaded. Reload before editing.");
  }
  if (data.length) {
    const ready = await client.rpc("swim_conditioning_program_edit_ready").abortSignal(AbortSignal.timeout(10_000));
    if (ready.error && isMissingRpc(ready.error)) throw new SwimInputError("Editing this swimming programme is not available yet.");
    if (ready.error || ready.data !== true) throw new SwimInputError("Programme editing could not be checked. Try again.");
  }
  return data;
}

export function prepareConditioningProgramEdit(input: {
  rows: readonly ConditioningSwimRow[]; primary: readonly PrimaryRow[];
  write: ProgramInstanceWrite; conditioning: unknown; startedOn: string; today: string;
}) {
  const saved = savedConditioningSchema.safeParse(input.conditioning);
  if (!saved.success) throw new SwimInputError("The saved conditioning choices could not be loaded.");
  if (saved.data.choices.some((choice) => choice.activity === "swimming") && !input.rows.length) {
    throw new SwimInputError("The linked swimming schedule could not be loaded. Reload before saving.");
  }
  const days = [...new Set(input.write.sessions.filter((session) => session.role === "cardio" &&
    session.prescription.items.length === 1 && session.prescription.items[0]?.kind === "cardio_external")
    .map((session) => session.dayIndex))];
  const remapped = remapConditioningChoices(saved.data.choices, days);
  if (!remapped.ok) throw new SwimInputError(remapped.error.message);
  const write = applyConditioningChoices(input.write, { choices: [...remapped.value] });
  const swimDays = new Set(remapped.value.filter((choice) => choice.activity === "swimming").map((choice) => choice.weekday));
  const primary = new Map(input.primary.map((row) => [row.id, row]));
  const workouts = input.rows.map((row) => {
    const planned = primary.get(row.planned_session_id ?? "");
    if (!planned || !Number.isSafeInteger(row.plan_revision) || (row.plan_revision ?? 0) < 1 ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || planned.slot !== row.slot ||
      dayDate(input.startedOn, planned.week_index, planned.day_index) !== row.scheduled_date) {
      throw new SwimInputError("The swimming schedule changed. Reload before saving.");
    }
    return {
      id: row.id, plannedSessionId: planned.id, date: row.scheduled_date, slot: row.slot,
      weekIndex: planned.week_index,
      movable: (row.plan_status === "active" || row.plan_status === "paused") &&
        row.status === "scheduled" && row.session_id === null && !row.outcome_metadata?.outcome,
    };
  });
  const result = planSwimConditioningEdit({
    today: input.today, workouts,
    slots: write.sessions.flatMap((session, index) => session.role === "cardio" &&
      swimDays.has(session.dayIndex) && session.prescription.items.length === 1 &&
      session.prescription.items[0]?.kind === "cardio_external" ? [{
        id: String(index), date: dayDate(input.startedOn, session.weekIndex, session.dayIndex),
        slot: session.slot, weekIndex: session.weekIndex,
      }] : []),
  });
  if (!result.ok) throw new SwimInputError(result.error.message);
  const claimedIndices = new Set(result.value.claimedSlotIds.map(Number));
  const newDates = new Map(result.value.moves.map((move) => [move.id, move.date]));
  const otherSlots = new Set(write.sessions.flatMap((session, index) => claimedIndices.has(index) ? [] : [
    `${dayDate(input.startedOn, session.weekIndex, session.dayIndex)}:${session.slot}`,
  ]));
  if (workouts.some((workout) => {
    const date = newDates.get(workout.id) ?? workout.date;
    return date >= input.today && otherSlots.has(`${date}:${workout.slot}`);
  })) {
    throw new SwimInputError("This schedule overlaps a swim that must keep its date. Choose different training days.");
  }
  return {
    write, conditioning: { ...saved.data, choices: remapped.value },
    retainedIds: new Set(workouts.map((row) => row.plannedSessionId)),
    claimedIndices,
    moves: result.value.moves,
    expected: input.rows.map((row) => {
      const planned = primary.get(row.planned_session_id!)!;
      return {
        id: row.id, planId: row.plan_id, planRevision: row.plan_revision,
        workoutRevision: row.revision, status: row.status, planStatus: row.plan_status,
        date: row.scheduled_date, sessionId: row.session_id, outcome: row.outcome_metadata,
        primary: {
          id: planned.id, week_index: planned.week_index, day_index: planned.day_index,
          slot: planned.slot, planned_at: planned.planned_at, notes: planned.notes, prescription: planned.prescription,
        },
      };
    }).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
