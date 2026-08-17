"use server";

/**
 * Manual "link a logged activity to a planned session" (ADR follow-up to the
 * automatic linker). The retired auto-linker only
 * fires for `cardio_source='external'` blocks and only at sync time, so a HYROX
 * (internal-cardio) plan — or any case where the activity synced before the day
 * was swapped — has no way to attach an already-logged run to its planned cardio
 * slot. This closes that gap.
 *
 * Crucially this is HYROX-aware: it runs the SAME classify-and-attribute path the
 * auto-linker uses, stamping `session_modality` + `effective_stress_load` (from
 * the run's HR), not just `completed_session_id`. A naive link that set only the
 * completion pointer would mark the day done but leave the engine's load
 * attribution at zero.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { classifyCardio } from "@/lib/cardio/classify-cardio";
import { readZoneConfig } from "@/lib/stats/hr-zones";
import { prescriptionItemsHaveStrength } from "@/lib/sessions/strength-prescribed";

export type LinkableActivity = {
  sessionId: string;
  title: string;
  performedAt: string;
  durationMin: number | null;
  distanceKm: number | null;
  avgHrBpm: number | null;
};

/** Days back to surface as link candidates. */
const LOOKBACK_DAYS = 21;

/**
 * Recent completed sessions that carry a cardio log and aren't already linked to
 * any planned slot — the candidates for the "link a logged activity" picker.
 */
export async function getLinkableActivities(): Promise<LinkableActivity[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return [];

  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  // Recent, completed, non-deleted sessions for this user.
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, title, performed_at, duration_min")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .not("completed_at", "is", null)
    .gte("performed_at", sinceIso)
    .order("performed_at", { ascending: false })
    .limit(40);
  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id as string);

  // Cardio logs for those sessions (a session is "linkable" only if it has one).
  const { data: logs } = await supabase
    .from("cardio_logs")
    .select("session_id, duration_sec, distance_km, avg_hr_bpm")
    .in("session_id", sessionIds);
  type CardioLogRow = {
    session_id: string;
    duration_sec: number | null;
    distance_km: string | number | null;
    avg_hr_bpm: number | null;
  };
  const logBySession = new Map<string, CardioLogRow>();
  for (const l of (logs ?? []) as CardioLogRow[]) {
    if (!logBySession.has(l.session_id)) logBySession.set(l.session_id, l);
  }

  // Sessions already claimed by a planned slot in a LIVE (non-deleted) block are
  // excluded. We must join through training_blocks and skip soft-deleted blocks —
  // otherwise an activity that was linked on a now-deleted plan stays permanently
  // hidden from the picker (it's "linked" to a dead slot).
  const { data: linked } = await supabase
    .from("planned_sessions")
    .select("completed_session_id, training_blocks!inner(deleted_at)")
    .eq("user_id", user.id)
    .not("completed_session_id", "is", null)
    .is("training_blocks.deleted_at", null);
  const linkedIds = new Set((linked ?? []).map((r) => r.completed_session_id as string));

  const out: LinkableActivity[] = [];
  for (const s of sessions) {
    const id = s.id as string;
    const log = logBySession.get(id);
    if (!log) continue; // not a cardio session
    if (linkedIds.has(id)) continue; // already attached elsewhere
    out.push({
      sessionId: id,
      title: (s.title as string | null) ?? "Logged activity",
      performedAt: s.performed_at as string,
      durationMin:
        (s.duration_min as number | null) ??
        (log.duration_sec != null ? Math.round((log.duration_sec as number) / 60) : null),
      distanceKm: log.distance_km != null ? Number(log.distance_km) : null,
      avgHrBpm: (log.avg_hr_bpm as number | null) ?? null,
    });
  }
  return out.slice(0, 10);
}

const linkSchema = z.object({
  plannedId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

/**
 * Link an existing logged session to a planned cardio slot, attributing its load
 * the same way the retired auto-linker did (modality + ESL from HR).
 */
export async function linkActivityToPlanned(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const parsed = linkSchema.safeParse({
    plannedId: formData.get("plannedId"),
    sessionId: formData.get("sessionId"),
  });
  if (!parsed.success) return { error: "Invalid request." };
  const { plannedId, sessionId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  // Planned slot — ownership + the prescription (for the strength guard).
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, user_id, prescription")
    .eq("id", plannedId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!planned) return { error: "Planned session not found." };

  // Hybrid-completion guard: a cardio activity must never mark a session that
  // also prescribes strength as complete — the strength still needs logging.
  const items =
    (planned.prescription as { items?: { kind?: string | null }[] } | null)?.items ?? null;
  if (prescriptionItemsHaveStrength(items)) {
    return {
      error: "This session also prescribes strength — log the strength work to complete it.",
    };
  }

  // The logged session + its cardio log (ownership-scoped).
  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!session) return { error: "Activity not found." };

  const { data: log } = await supabase
    .from("cardio_logs")
    .select("avg_hr_bpm, max_hr_bpm, duration_sec")
    .eq("session_id", sessionId)
    .order("block_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Classify for load attribution (modality + ESL), mirroring the auto-linker.
  let modality: string | null = null;
  let esl: number | null = null;
  if (log && (log.duration_sec as number) > 0) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("intake")
      .eq("id", user.id)
      .maybeSingle();
    const bands = readZoneConfig((profile?.intake as Record<string, unknown> | null) ?? null);
    const hrMax = bands ? Math.round(bands.z4Max / 0.9) : null;
    const classification = classifyCardio({
      avgHrBpm: (log.avg_hr_bpm as number | null) ?? null,
      maxHrBpm: (log.max_hr_bpm as number | null) ?? null,
      durationSec: log.duration_sec as number,
      hrMax,
      userAge: null,
    });
    if (classification) {
      modality = classification.kind;
      esl = classification.effectiveStressLoad;
    }
  }

  const { error: updErr } = await supabase
    .from("planned_sessions")
    .update({
      completed_session_id: sessionId,
      ...(modality != null ? { session_modality: modality } : {}),
      ...(esl != null ? { effective_stress_load: esl } : {}),
    })
    .eq("id", plannedId)
    .eq("user_id", user.id);
  if (updErr) return { error: "Couldn't link the activity. Please try again." };

  revalidatePath("/app");
  revalidatePath("/app/plan");
  return { ok: true };
}
