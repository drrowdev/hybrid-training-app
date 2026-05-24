/**
 * Auto-deload detector — "miss reps in 2 consecutive cycles → drop TM 10%"
 * safety net, GRM-gated so cooked sessions don't count.
 *
 * Design: docs/design/prs-and-tm-progression.md §9
 *
 * Research grounding: Israetel autoregulation (overreach detection),
 * Helms recovery-cycle framework, Sheiko block-management protocols all
 * use a similar "two real misses → drop and rebuild" pattern. The 10%
 * pullback is practitioner-consensus across powerlifting templates.
 *
 * A miss is:
 *   - AMRAP set logged with reps < AMRAP target, OR
 *   - Top set logged with weight < prescribed weight × 0.95
 *
 * GRM gating: a miss on a session with `GRM < 0.93` is DISCOUNTED — the
 * user was cooked; this is a recovery problem, not a TM-too-aggressive
 * problem. Only "real misses" count toward the 2-miss streak.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { computeGrm } from "./grm";
import { detectAmrap } from "./amrap";

export type DeloadProposal = {
  movementId: string;
  movementDisplayName: string;
  currentTm: number;
  proposedTm: number;
  /** The two real misses that triggered this proposal, newest first. */
  missContext: Array<{
    sessionId: string;
    performedAt: string;
    targetReps: number;
    performedReps: number;
    weight: number;
  }>;
  triggerKey: string;
};

const GRM_FATIGUE_THRESHOLD = 0.93;
const DELOAD_FACTOR = 0.9; // -10% TM

/**
 * Find a deload proposal for the given session, when one fires.
 *
 * Algorithm:
 *  1. Identify the AMRAP movement for this session via the planned link.
 *  2. Determine whether the session's AMRAP attempt was a "real miss".
 *  3. Walk backwards to the most-recent prior session with the same
 *     movement's AMRAP. Repeat the miss check. If both miss real, fire.
 */
export async function findDeloadProposalForSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<DeloadProposal | null> {
  // 1. Planned link + AMRAP detection.
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, week_index, prescription, block_id")
    .eq("completed_session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!planned) return null;
  const prescription = planned.prescription as Prescription | null;
  if (!prescription) return null;
  const amrap = detectAmrap(prescription, planned.week_index);
  if (!amrap?.item.movementId) return null;
  const movementId = amrap.item.movementId;

  // 2. Did this session miss the AMRAP target (real miss only)?
  const thisMiss = await wasRealMiss(supabase, userId, sessionId, movementId, amrap.target);
  if (!thisMiss) return null;

  // 3. Find the prior session for the same movement's AMRAP.
  const { data: priorPlanned } = await supabase
    .from("planned_sessions")
    .select("id, week_index, prescription, completed_session_id, block_id")
    .eq("user_id", userId)
    .neq("id", planned.id)
    .not("completed_session_id", "is", null)
    .order("week_index", { ascending: false })
    .limit(20);

  let priorMiss: typeof thisMiss | null = null;
  for (const p of priorPlanned ?? []) {
    const pPresc = p.prescription as Prescription | null;
    if (!pPresc) continue;
    const pAmrap = detectAmrap(pPresc, p.week_index);
    if (!pAmrap?.item.movementId) continue;
    if (pAmrap.item.movementId !== movementId) continue;
    if (!p.completed_session_id) continue;
    const candidate = await wasRealMiss(supabase, userId, p.completed_session_id, movementId, pAmrap.target);
    if (candidate) {
      priorMiss = candidate;
      break;
    }
    // First non-miss = streak broken; no deload.
    return null;
  }
  if (!priorMiss) return null;

  // 4. Look up current TM + movement + idempotency context.
  const { data: movement } = await supabase
    .from("movements")
    .select("id, display_name")
    .eq("id", movementId)
    .maybeSingle();
  if (!movement) return null;

  const { data: tmRow } = await supabase
    .from("training_maxes")
    .select("one_rm_kg, tm_percent")
    .eq("user_id", userId)
    .eq("movement_id", movementId)
    .maybeSingle();
  if (!tmRow) return null;
  const oneRm = Number(tmRow.one_rm_kg);
  const tmPct = tmRow.tm_percent != null ? Number(tmRow.tm_percent) / 100 : 0.9;
  const currentTm = oneRm * tmPct;
  const proposedTm = Math.round(currentTm * DELOAD_FACTOR * 2) / 2; // round to 0.5 kg

  // Idempotency: one deload proposal per session per movement.
  const triggerKey = `${sessionId}:${movementId}:deload`;
  const { count: existing } = await supabase
    .from("tm_history")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("movement_id", movementId)
    .eq("trigger_key", triggerKey);
  if ((existing ?? 0) > 0) return null;

  return {
    movementId,
    movementDisplayName: movement.display_name,
    currentTm,
    proposedTm,
    missContext: [thisMiss, priorMiss],
    triggerKey,
  };
}

type MissRow = {
  sessionId: string;
  performedAt: string;
  targetReps: number;
  performedReps: number;
  weight: number;
};

/**
 * Check whether the session's AMRAP attempt was a "real miss":
 *   - The user logged a set for the AMRAP movement
 *   - That set's reps < the AMRAP target
 *   - OR the weight was < prescribed * 0.95
 *   - AND the session's GRM was >= 0.93 (not cooked)
 *
 * Returns null when no real miss is detected (either it was hit or the
 * session was cooked).
 */
async function wasRealMiss(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  movementId: string,
  amrapTarget: number,
): Promise<MissRow | null> {
  // GRM gate first — cooked sessions don't contribute to the streak.
  const { data: session } = await supabase
    .from("sessions")
    .select("id, performed_at, fatigue, soreness")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!session) return null;
  const grm = computeGrm({ fatigue: session.fatigue, soreness: session.soreness });
  if (grm.hasCheckIn && grm.value < GRM_FATIGUE_THRESHOLD) {
    return null;
  }

  // Find the heaviest AMRAP-eligible set in the session for this movement.
  const { data: sets } = await supabase
    .from("set_logs")
    .select("weight_kg, reps, set_kind")
    .eq("session_id", sessionId)
    .eq("movement_id", movementId)
    .eq("skipped", false)
    .neq("set_kind", "warmup")
    .not("weight_kg", "is", null)
    .not("reps", "is", null);

  let best: { weight: number; reps: number } | null = null;
  for (const s of sets ?? []) {
    const w = Number(s.weight_kg);
    const r = Number(s.reps);
    if (!best || w > best.weight || (w === best.weight && r > best.reps)) {
      best = { weight: w, reps: r };
    }
  }
  if (!best) return null;

  // Miss = reps under the AMRAP target.
  if (best.reps >= amrapTarget) return null;

  return {
    sessionId,
    performedAt: session.performed_at as string,
    targetReps: amrapTarget,
    performedReps: best.reps,
    weight: best.weight,
  };
}
