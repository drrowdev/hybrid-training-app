import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { canChangeAuthoredStartDate } from "@hta/domain";
import type { ScheduleSnapshot } from "@/lib/schedule/storage";

export async function loadAuthoredStartDateState(
  client: SupabaseClient, userId: string, blockId: string, snapshot: ScheduleSnapshot,
) {
  const [block, begun] = await Promise.all([
    client.from("training_blocks").select("started_on").eq("id", blockId).eq("user_id", userId)
      .eq("program_id", "authored").eq("status", "active").is("deleted_at", null).single(),
    client.from("planned_sessions").select("id").eq("block_id", blockId).eq("user_id", userId)
      .not("completed_session_id", "is", null).limit(1),
  ]);
  if (block.error || begun.error) throw new Error("Couldn't load the program start date. Try again.");
  const { started_on: startedOn } = z.object({ started_on: z.string() }).parse(block.data);
  const hasBegunWorkout = z.array(z.object({ id: z.string() })).parse(begun.data).length > 0;
  return {
    startedOn,
    canChangeStartDate: canChangeAuthoredStartDate({
      available: snapshot.authoredStartDateChanges === true, scope: "program", hasBegunWorkout,
    }),
  };
}
