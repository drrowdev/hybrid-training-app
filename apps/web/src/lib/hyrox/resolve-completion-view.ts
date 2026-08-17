/**
 * HYROX completion view resolver (ADR 0050 step 7c, server side).
 *
 * Fetches the active HYROX program instance for a block and builds the completion
 * form view-model. Returns null for non-HYROX blocks or strength HYROX sessions.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HyroxInstance } from "@hta/hyrox";
import { buildHyroxCompletionView, type HyroxCompletionView } from "./completion-view";

export type ResolvedHyroxCompletion = HyroxCompletionView;

export async function resolveHyroxCompletionView(
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
  programRef: string,
  overrides?: import("@hta/hyrox").StationOverrides,
): Promise<ResolvedHyroxCompletion | null> {
  const { data: pi } = await supabase
    .from("program_instances")
    .select("program_id, instance")
    .eq("user_id", userId)
    .eq("block_id", blockId)
    .eq("status", "active")
    .maybeSingle();
  if (!pi || pi.program_id !== "hyrox") return null;

  const view = buildHyroxCompletionView(pi.instance as HyroxInstance, programRef, overrides);
  if (!view) return null;

  return view;
}
