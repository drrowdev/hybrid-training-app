import type { SupabaseClient } from "@supabase/supabase-js";
import type { SwimStrengthContext } from "@hta/domain";
import { loadTrainingSchedule } from "@/lib/schedule/storage";

/** Kept as the swim boundary; occupancy includes all work, not just strength. */
export async function loadSwimStrengthContext(client: SupabaseClient, _userId: string): Promise<SwimStrengthContext> {
  const snapshot = await loadTrainingSchedule(client);
  const entries = snapshot.entries.filter((entry) => entry.source !== "swim");
  return {
    blockId: entries.find((entry) => entry.source === "primary")?.programId ?? null,
    revision: snapshot.revision,
    sessions: entries.map(({ id, date, title, state }) => ({ id, date, title, state })),
  };
}
