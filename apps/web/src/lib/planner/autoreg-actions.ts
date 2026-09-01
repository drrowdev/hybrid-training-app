"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getCeilingUtilization } from "@/lib/stats/ceiling-queries";
import {
  applyPrescriptionUpdates,
  getActiveBlockRemainingSessions,
} from "@/lib/planner/remaining-sessions";
import {
  autoregScaleForBand,
  hasDiscretionaryVolume,
} from "@/lib/planner/autoreg-volume";
import { getUserTimezone } from "@/lib/planner/queries";

export type AcceptAutoregResult =
  | { ok: true; sessions: number; scale: number }
  | { ok: false; error: string };

/**
 * Stamp the offered `autoregVolumeScale` onto the user's CURRENT-week
 * un-started sessions. Re-derives the band + scale server-side from live
 * state — never trusts a client value. The scalar is reversible: clearing
 * the field restores the full prescription, and the trim is computed at
 * read time by `applyAutoregVolumeScale`.
 */
export async function acceptVolumeAutoregResult(): Promise<AcceptAutoregResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const timezone = await getUserTimezone(user.id);
  const util = await getCeilingUtilization(supabase, user.id, timezone);
  if (!util) return { ok: false, error: "No active block" };

  const scale = autoregScaleForBand(util.strength.band);
  if (scale === null) {
    return { ok: false, error: "Strength volume is not over budget" };
  }

  const active = await getActiveBlockRemainingSessions(
    supabase,
    user.id,
    timezone,
  );
  if (!active) return { ok: false, error: "No active block" };

  const updates = active.remaining
    .filter(
      (s) =>
        s.weekIndex === active.currentWeekIndex &&
        s.prescription.autoregVolumeScale == null &&
        hasDiscretionaryVolume(s.prescription),
    )
    .map((s) => ({
      id: s.id,
      prescription: { ...s.prescription, autoregVolumeScale: scale },
      expectedCompletedSessionId: s.expectedCompletedSessionId,
    }));

  if (updates.length === 0) return { ok: true, sessions: 0, scale };

  const { updated, error } = await applyPrescriptionUpdates(
    supabase,
    user.id,
    active.blockId,
    updates,
  );
  if (error) return { ok: false, error };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/sessions");
  revalidatePath("/app/stats");

  return { ok: true, sessions: updated, scale };
}
