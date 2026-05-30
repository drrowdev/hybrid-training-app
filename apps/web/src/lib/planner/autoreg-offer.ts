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
} from "@/lib/planner/autoreg-volume";

export type VolumeAutoregOffer = {
  blockId: string;
  band: "over" | "way-over";
  bandLabel: string;
  scale: number;
  pct: number;
  actual: number;
  prescribed: number;
  /** Number of current-week un-started sessions the trim would apply to. */
  sessionCount: number;
};

export async function getVolumeAutoregOffer(): Promise<VolumeAutoregOffer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;

  const util = await getCeilingUtilization(supabase, user.id);
  if (!util) return null;

  const scale = autoregScaleForBand(util.strength.band);
  if (scale === null) return null; // only over / way-over trigger an offer.

  const active = await getActiveBlockRemainingSessions(supabase, user.id);
  if (!active) return null;

  const targets = active.remaining.filter(
    (s) =>
      s.weekIndex === active.currentWeekIndex &&
      s.prescription.autoregVolumeScale == null &&
      hasDiscretionaryVolume(s.prescription),
  );
  if (targets.length === 0) return null;

  return {
    blockId: active.blockId,
    band: util.strength.band as "over" | "way-over",
    bandLabel: util.strength.bandLabel,
    scale,
    pct: util.strength.pct,
    actual: util.strength.actual,
    prescribed: util.strength.prescribed,
    sessionCount: targets.length,
  };
}
