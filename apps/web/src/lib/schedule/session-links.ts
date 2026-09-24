import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrainingCommitment } from "@hta/domain";

export async function loadScheduleSessionLinks(client: SupabaseClient, entries: readonly TrainingCommitment[]): Promise<Record<string, string>> {
  const ids = entries.filter((entry) => entry.source === "primary" &&
    (entry.state === "completed" || entry.state === "started")).map((entry) => entry.id);
  if (!ids.length) return {};
  const { data, error } = await client.from("planned_sessions")
    .select("id, completed_session_id").in("id", ids);
  if (error) throw new Error("Couldn't load your workouts. Try again.", { cause: error });
  const links = Object.fromEntries((data ?? []).flatMap((row) =>
    row.completed_session_id ? [[row.id, row.completed_session_id]] : []));
  if (ids.some((id) => !links[id])) throw new Error("Couldn't load your workouts. Try again.");
  return links;
}
