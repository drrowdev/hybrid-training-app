/**
 * HYROX completion view resolver (ADR 0050 step 7c, server side).
 *
 * Fetches the active HYROX program instance for a block, builds the completion
 * form view-model, and attaches a Strava match when one is already linked (so the
 * form's orange banner can offer to fill time + intensity). Returns null for
 * non-HYROX blocks or strength HYROX sessions.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HyroxInstance } from "@hta/hyrox";
import { buildHyroxCompletionView, type HyroxCompletionView } from "./completion-view";
import { findMatchingStravaActivity } from "@/lib/integrations/strava/match";
import type { HyroxStravaMatch } from "@/components/session/HyroxCompletionForm";

export interface ResolvedHyroxCompletion extends HyroxCompletionView {
  stravaMatch: HyroxStravaMatch | null;
}

function fmtDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export async function resolveHyroxCompletionView(
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
  programRef: string,
  performedAt?: string | null,
): Promise<ResolvedHyroxCompletion | null> {
  const { data: pi } = await supabase
    .from("program_instances")
    .select("program_id, instance")
    .eq("user_id", userId)
    .eq("block_id", blockId)
    .eq("status", "active")
    .maybeSingle();
  if (!pi || pi.program_id !== "hyrox") return null;

  const view = buildHyroxCompletionView(pi.instance as HyroxInstance, programRef);
  if (!view) return null;

  let stravaMatch: HyroxStravaMatch | null = null;
  if (performedAt) {
    try {
      const match = await findMatchingStravaActivity(supabase, userId, performedAt, {});
      if (match) {
        stravaMatch = {
          durationSec: match.durationSec,
          avgHrBpm: match.avgHrBpm,
          label: `Strava activity found · ${fmtDuration(match.durationSec)}`,
        };
      }
    } catch {
      // Best-effort enrichment — never block completion.
    }
  }

  return { ...view, stravaMatch };
}
