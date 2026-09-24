/**
 * ADR 0013 — server glue for the within-block volume-autoregulation
 * offer. Read-only and user-scoped. Returns null unless the user's
 * CURRENT-week strength ceiling is over / way-over budget AND there is at
 * least one un-started current-week session with discretionary volume
 * that has not already been trimmed.
 */
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getCeilingUtilization } from "@/lib/stats/ceiling-queries";
import { getActiveBlockRemainingSessions } from "@/lib/planner/remaining-sessions";
import {
  autoregScaleForBand,
  hasDiscretionaryVolume,
  previewAutoregTrim,
  suppressAutoregForBlockTiming,
  type AutoregTrimChange,
} from "@/lib/planner/autoreg-volume";
import { getUserTimezone } from "@/lib/planner/queries";

/** Per-session breakdown of the accessory sets a trim would drop. */
export type AutoregSessionPreview = {
  sessionId: string;
  title: string;
  drops: AutoregTrimChange[];
};

export type VolumeAutoregOffer = {
  blockId: string;
  band: "over" | "way-over";
  bandLabel: string;
  scale: number;
  /** Whole-percent "keep" fraction (e.g. 66) for display. */
  keepPct: number;
  pct: number;
  actual: number;
  prescribed: number;
  /** Number of current-week un-started sessions the trim would apply to. */
  sessionCount: number;
  /** Exactly which accessory sets get trimmed, per remaining session. */
  preview: AutoregSessionPreview[];
};

export async function getVolumeAutoregOffer(blockId?: string): Promise<VolumeAutoregOffer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;

  const timezone = await getUserTimezone(user.id);
  const util = await getCeilingUtilization(supabase, user.id, timezone);
  if (!util) return null;

  const scale = autoregScaleForBand(util.strength.band);
  if (scale === null) return null; // only over / way-over trigger an offer.

  const active = await getActiveBlockRemainingSessions(
    supabase,
    user.id,
    timezone,
    new Date(),
    blockId,
  );
  if (!active) return null;

  // Field bug: a future-dated deploy (or a block with nothing logged yet) made
  // this offer fire by comparing the PRIOR block's last-7-days sets to the new
  // block's week-1 budget. Suppress until the active block owns some logged
  // work. Fetch its start date + count sessions performed on/after it.
  const { data: blk, error: blockError } = await supabase
    .from("training_blocks")
    .select("started_on")
    .eq("user_id", user.id)
    .eq("id", active.blockId)
    .maybeSingle();
  if (blockError) throw new Error("Could not read the selected program. Try again.");
  const startedOnYmd = (blk?.started_on as string | null) ?? null;
  let ownLoggedSessions = 0;
  if (startedOnYmd) {
    const { data: links, error: linksError } = await supabase.from("planned_sessions")
      .select("completed_session_id").eq("user_id", user.id).eq("block_id", active.blockId)
      .not("completed_session_id", "is", null);
    if (linksError) throw new Error("Could not read the program's workout history. Try again.");
    const ids = (links ?? []).map((link) => link.completed_session_id as string);
    const { count, error: sessionsError } = ids.length ? await supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("id", ids)
      .is("deleted_at", null)
      .gte("performed_at", `${startedOnYmd}T00:00:00`) : { count: 0, error: null };
    if (sessionsError) throw new Error("Could not read the program's workout history. Try again.");
    ownLoggedSessions = count ?? 0;
  }
  if (
    suppressAutoregForBlockTiming({
      startedOnYmd,
      nowMs: Date.now(),
      ownLoggedSessions,
    })
  ) {
    return null;
  }

  const targets = active.remaining.filter(
    (s) =>
      s.weekIndex === active.currentWeekIndex &&
      s.prescription.autoregVolumeScale == null &&
      hasDiscretionaryVolume(s.prescription),
  );
  if (targets.length === 0) return null;

  const preview: AutoregSessionPreview[] = targets.map((s) => ({
    sessionId: s.id,
    title: s.title,
    drops: previewAutoregTrim(s.prescription, scale),
  }));

  return {
    blockId: active.blockId,
    band: util.strength.band as "over" | "way-over",
    bandLabel: util.strength.bandLabel,
    scale,
    keepPct: Math.round(scale * 100),
    pct: util.strength.pct,
    actual: util.strength.actual,
    prescribed: util.strength.prescribed,
    sessionCount: targets.length,
    preview,
  };
}
