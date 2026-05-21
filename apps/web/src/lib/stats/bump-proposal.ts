/**
 * Server-side wiring for the TM-bump proposal card.
 *
 * Pulls every input the confidence gate needs from Supabase, runs the
 * gate, and returns either a passing proposal or null (no card to show).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { detectAmrap } from "@/lib/engine/amrap";
import { computeGrm } from "@/lib/engine/grm";
import { evaluateBumpGate, type GateResult } from "@/lib/engine/tm-bump";

export type BumpProposal = {
  proposal: Extract<GateResult, { passes: true }>;
  /** The movement the bump applies to. */
  movementId: string;
  movementDisplayName: string;
  /** Current stored TM (kg). */
  currentTm: number;
  /** Idempotency key for the accept / decline actions. */
  triggerKey: string;
};

/**
 * Find a TM-bump proposal for the session, when one fires. Returns null
 * when there's no AMRAP, no qualifying set logged, or the gate suppresses.
 */
export async function findBumpProposalForSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<BumpProposal | null> {
  // 1. Find the planned session linked to this session (if any).
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, week_index, prescription, block_id")
    .eq("completed_session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!planned) return null;

  const prescription = planned.prescription as Prescription | null;
  if (!prescription) return null;

  const weekIndex = planned.week_index;
  const amrap = detectAmrap(prescription, weekIndex);
  if (!amrap) return null;

  // 2. Pick the user's strongest set in this session matching the AMRAP movement.
  const movementId = amrap.item.movementId;
  if (!movementId) return null;
  const { data: sets } = await supabase
    .from("set_logs")
    .select("weight_kg, reps, rpe, set_kind")
    .eq("session_id", sessionId)
    .eq("movement_id", movementId)
    .neq("set_kind", "warmup")
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0);

  // Pick the heaviest set with reps >= amrap target — that's the AMRAP attempt.
  let bestAmrapSet: { weight: number; reps: number; rpe: number | null } | null = null;
  for (const s of sets ?? []) {
    const reps = Number(s.reps);
    if (reps < amrap.target) continue;
    const weight = Number(s.weight_kg);
    if (
      bestAmrapSet == null ||
      weight > bestAmrapSet.weight ||
      (weight === bestAmrapSet.weight && reps > bestAmrapSet.reps)
    ) {
      bestAmrapSet = { weight, reps, rpe: s.rpe };
    }
  }
  if (!bestAmrapSet) return null;

  // 3. Movement + TM + session info to feed the gate.
  const { data: movement } = await supabase
    .from("movements")
    .select("id, display_name, primary_region")
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
  if (!Number.isFinite(currentTm) || currentTm <= 0) return null;

  // 4. Days since last TM change.
  const { data: lastChange } = await supabase
    .from("tm_history")
    .select("changed_at")
    .eq("user_id", userId)
    .eq("movement_id", movementId)
    .order("changed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const daysSinceLastTmChange = lastChange?.changed_at
    ? Math.floor((Date.now() - new Date(lastChange.changed_at).getTime()) / 86_400_000)
    : null;

  // 5. Recent proposal exists? (any tm_history entry in the last 28 days for this movement,
  //    regardless of accept/decline — both write a history row).
  const twentyEightDaysAgo = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const { count: recentChangeCount } = await supabase
    .from("tm_history")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("movement_id", movementId)
    .gte("changed_at", twentyEightDaysAgo);
  const recentProposalExists = (recentChangeCount ?? 0) > 0;

  // 6. Active limitation on this movement's region?
  let hasActiveLimitation = false;
  if (movement.primary_region) {
    const { count: limCount } = await supabase
      .from("limitations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("resolved_at", null)
      .eq("region", movement.primary_region);
    hasActiveLimitation = (limCount ?? 0) > 0;
  }

  // 7. Prior AMRAP smashes in last ~6 weeks. Approximation: count sessions
  //    in the last 42 days where the user beat an AMRAP by 5+ reps. Cheap
  //    enough to compute on the fly via a single set_logs sweep.
  const sixWeeksAgo = new Date(Date.now() - 42 * 86_400_000).toISOString();
  const { data: priorSessions } = await supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", userId)
    .gte("performed_at", sixWeeksAgo)
    .lt("performed_at", new Date().toISOString())
    .order("performed_at", { ascending: false });

  let priorSmashCount = 0;
  if (priorSessions && priorSessions.length > 0) {
    const priorIds = priorSessions.map((s) => s.id).filter((id) => id !== sessionId);
    if (priorIds.length > 0) {
      const { data: priorSets } = await supabase
        .from("set_logs")
        .select("reps, set_kind")
        .in("session_id", priorIds)
        .eq("movement_id", movementId)
        .neq("set_kind", "warmup")
        .gt("reps", amrap.target + 4); // reps >= target + 5
      priorSmashCount = priorSets?.length ?? 0;
    }
  }

  // 8. Today's GRM (from this session's check-in).
  const { data: thisSession } = await supabase
    .from("sessions")
    .select("fatigue, soreness")
    .eq("id", sessionId)
    .maybeSingle();
  const grm = computeGrm({ fatigue: thisSession?.fatigue ?? null, soreness: thisSession?.soreness ?? null });
  const todayGrm = grm.hasCheckIn ? grm.value : null;

  // 9. Run the gate.
  const gate = evaluateBumpGate({
    performedReps: bestAmrapSet.reps,
    target: amrap.target,
    weekIndex,
    performedWeight: bestAmrapSet.weight,
    performedRpe: bestAmrapSet.rpe,
    currentTm,
    daysSinceLastTmChange,
    recentProposalExists,
    hasActiveLimitation,
    priorSmashCount,
    todayGrm,
  });
  if (!gate.passes) return null;

  return {
    proposal: gate,
    movementId,
    movementDisplayName: movement.display_name,
    currentTm,
    triggerKey: `${planned.id}:${movementId}:amrap`,
  };
}
