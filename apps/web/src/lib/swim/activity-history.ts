import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRpc } from "@/lib/supabase/rpc-errors";
import { conditioningSwimView, type ConditioningSwimRow } from "./conditioning-view";
import { parseSwimDate } from "./forms";
import type { SwimActivity } from "./activity-presentation";

/** Confirmed imported work only; native swims already appear as ordinary sessions. */
export async function loadSwimActivity(client: SupabaseClient, userId: string, limit: number): Promise<SwimActivity[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid activity limit.");
  const available = await client.rpc("swim_conditioning_activity_ready").abortSignal(AbortSignal.timeout(10_000));
  if (available.error && isMissingRpc(available.error)) return [];
  if (available.error || available.data !== true) throw new Error("Recorded swims could not be loaded.");
  const { data, error } = await client.from("swim_conditioning_sessions").select("*")
    .eq("user_id", userId).is("session_id", null).not("outcome_match_id", "is", null)
    .order("claim_recording_date", { ascending: false }).order("id", { ascending: false })
    .limit(limit).returns<(ConditioningSwimRow & { claim_recording_date: string | null })[]>()
    .abortSignal(AbortSignal.timeout(10_000));
  if (error || !data || data.length > limit || new Set(data.map((row) => row.id)).size !== data.length) {
    throw new Error("Recorded swims could not be loaded.");
  }
  return data.map((row) => {
    if (row.user_id !== userId || row.session_id || !row.outcome_metadata?.outcome || !row.claim_recording_date) {
      throw new Error("The recorded swim could not be loaded.");
    }
    parseSwimDate(row.claim_recording_date);
    const swim = conditioningSwimView(row);
    if (swim.status !== "completed" && swim.status !== "stopped_early" && swim.status !== "needs_review") {
      throw new Error("The recorded swim outcome could not be loaded.");
    }
    return { kind: "swim", id: row.id, title: swim.title, date: row.claim_recording_date, status: swim.status };
  });
}
