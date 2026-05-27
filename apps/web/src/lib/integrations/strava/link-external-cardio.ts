/**
 * Phase 2 "external cardio" — post-insert hook that classifies a freshly
 * imported Strava cardio_logs row and (when there's a matching
 * `cardio_external` planned session for the same calendar day) links
 * the session, stamps the planned session's `effective_stress_load`,
 * and writes the classification back to `cardio_logs`.
 *
 * The whole hook is best-effort: any failure logs to console and
 * returns. The session row itself is already inserted and the
 * `cardio_external` placeholder stays in its previous state — Phase 1
 * "Mark complete" still works as a manual fallback.
 *
 * Match heuristic:
 *   1. Compute the activity's calendar date in the user's tz.
 *   2. Look up the user's active `cardio_source='external'` training
 *      blocks and join `planned_sessions` for that user.
 *   3. For each `planned_session` whose computed (startedOn + week +
 *      day) date matches, pick the first row whose prescription's
 *      first item is `cardio_external` AND whose `completed_session_id`
 *      is NULL (or already pointing at this session for idempotency).
 *
 * Why we don't gate on confidence ≥ 0.5 inside this function: the
 * spec asks for that gate at the WRITE site, so we still always store
 * the classification on `cardio_logs` (for observability / future
 * reclassification), but only update the planned session when the
 * confidence is high enough.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyCardio, type ClassifiedCardio } from "./classify-cardio";
import { readZoneConfig } from "@/lib/stats/hr-zones";
import { dayDate } from "@/lib/planner/queries";

type CardioLogShape = {
  id: string;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
  duration_sec: number;
};

type PlannedRow = {
  id: string;
  week_index: number;
  day_index: number;
  prescription: { items?: Array<{ kind?: string }> } | null;
  completed_session_id: string | null;
  training_blocks: { started_on: string } | { started_on: string }[] | null;
};

/** YYYY-MM-DD for the given ISO timestamp in the user's IANA tz. */
function ymdInTz(isoTs: string, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date(isoTs));
  } catch {
    return isoTs.slice(0, 10);
  }
}

const MIN_LINK_CONFIDENCE = 0.5;

export async function classifyAndLinkExternalCardio(args: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  cardioLog: CardioLogShape;
  performedAt: string;
  userTimezone: string;
}): Promise<ClassifiedCardio | null> {
  const { supabase, userId, sessionId, cardioLog, performedAt, userTimezone } = args;

  // Step 1: read profile for hrMax.
  const { data: profile } = await supabase
    .from("profiles")
    .select("intake")
    .eq("id", userId)
    .maybeSingle();
  const bands = readZoneConfig(
    (profile?.intake as Record<string, unknown> | null) ?? null,
  );
  // bands.z4Max is 90% of hrMax → reverse the multiplier. If the user
  // saved bespoke zones rather than a single hrMax we can still recover
  // an approximate hrMax (the band ratios are fixed).
  const inferredHrMax = bands ? Math.round(bands.z4Max / 0.9) : null;

  const classification = classifyCardio({
    avgHrBpm: cardioLog.avg_hr_bpm,
    maxHrBpm: cardioLog.max_hr_bpm,
    durationSec: cardioLog.duration_sec,
    hrMax: inferredHrMax,
    userAge: null,
  });
  if (!classification) return null;

  // Step 2: always stamp the classification on cardio_logs so future
  // reclassification / debugging has a paper trail.
  await supabase
    .from("cardio_logs")
    .update({
      inferred_kind: classification.kind,
      inferred_confidence: classification.confidence,
    })
    .eq("id", cardioLog.id);

  if (classification.confidence < MIN_LINK_CONFIDENCE) return classification;

  // Step 3: find a matching cardio_external planned_session for the
  // same calendar day. Restrict to undeleted external blocks + the
  // current user so the join stays cheap.
  const activityYmd = ymdInTz(performedAt, userTimezone);

  const { data: candidates } = await supabase
    .from("planned_sessions")
    .select(
      "id, week_index, day_index, prescription, completed_session_id, training_blocks!inner(started_on, user_id, cardio_source, deleted_at, status)",
    )
    .eq("user_id", userId)
    .eq("training_blocks.user_id", userId)
    .eq("training_blocks.cardio_source", "external")
    .is("training_blocks.deleted_at", null);

  const rows = (candidates ?? []) as unknown as PlannedRow[];
  const match = rows.find((r) => {
    const block = Array.isArray(r.training_blocks)
      ? r.training_blocks[0]
      : r.training_blocks;
    if (!block) return false;
    const firstKind = r.prescription?.items?.[0]?.kind;
    if (firstKind !== "cardio_external") return false;
    const ymd = dayDate(block.started_on, r.week_index, r.day_index);
    if (ymd !== activityYmd) return false;
    return r.completed_session_id == null || r.completed_session_id === sessionId;
  });
  if (!match) return classification;

  // Step 4: stamp ESL + modality + link the session.
  await supabase
    .from("planned_sessions")
    .update({
      session_modality: classification.kind,
      effective_stress_load: classification.effectiveStressLoad,
      completed_session_id: sessionId,
    })
    .eq("id", match.id);

  return classification;
}
