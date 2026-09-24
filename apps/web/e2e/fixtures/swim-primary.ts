import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { z } from "zod";
import { isoWeekdayYmd } from "../../src/lib/dates";
import { nativeProgramDefinition, prepareNativeProgram } from "./modular-programs";

export async function seedSwimPrimaryBaseline(actor: SupabaseClient, userId: string, startedOn: string, prescription: Prescription) {
  const signed = await actor.auth.getUser();
  if (signed.error || signed.data.user?.id !== userId) throw new Error("Authenticated baseline owner required.");
  const movement = await actor.from("movements").select("id")
    .is("user_id", null).eq("slug", "bench-press-flat").single();
  if (movement.error) throw new Error("Primary baseline movement unavailable.", { cause: movement.error });
  const movementId = z.object({ id: z.string().uuid() }).parse(movement.data).id;
  const definition = {
    ...nativeProgramDefinition("strength", "Primary baseline", isoWeekdayYmd(startedOn), movementId, movementId),
    weeks: 2,
  };
  const created = await prepareNativeProgram(actor, definition, startedOn);
  const planned = await actor.from("planned_sessions").select("id")
    .eq("user_id", userId).eq("block_id", created.block_id).order("week_index").order("day_index");
  if (planned.error) throw new Error("Primary baseline workouts unavailable.", { cause: planned.error });
  const plannedIds = z.array(z.object({ id: z.string().uuid() })).length(2).parse(planned.data).map((row) => row.id);
  const updated = await actor.from("planned_sessions").update({ prescription })
    .eq("user_id", userId).eq("block_id", created.block_id).in("id", plannedIds).select("id");
  if (updated.error) throw new Error("Primary baseline prescription setup failed.", { cause: updated.error });
  const updatedIds = z.array(z.object({ id: z.string().uuid() })).length(2).parse(updated.data).map((row) => row.id);
  if (new Set(updatedIds).size !== 2 || plannedIds.some((id) => !updatedIds.includes(id))) {
    throw new Error("Primary baseline prescription targets mismatch.");
  }
  const started = await actor.rpc("start_planned_session_atomically", { p_planned_id: plannedIds[0] });
  if (started.error) throw new Error("Primary baseline start failed.", { cause: started.error });
  const sessionId = z.string().uuid().parse(started.data);
  const completed = await actor.rpc("complete_training_session_with_transition", {
    p_session_id: sessionId, p_notes: null, p_completion_entry_id: randomUUID(),
  });
  if (completed.error) throw new Error("Primary baseline completion failed.", { cause: completed.error });
  const receipt = z.array(z.object({ user_id: z.string().uuid(), transitioned: z.literal(true) }))
    .length(1).parse(completed.data);
  if (receipt[0]!.user_id !== userId) throw new Error("Primary baseline completion owner mismatch.");
  return { blockId: created.block_id, plannedIds };
}
