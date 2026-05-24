/**
 * PR-driven TM recalibrate proposals.
 *
 * Closes the gap left by the AMRAP-only bump path:
 *   - Custom blocks without explicit AMRAP markers
 *   - Freestyle sessions
 *   - Non-AMRAP top sets inside curated blocks
 *
 * For every e1RM PR fired on a session, if the implied TM (estimated 1RM
 * × the user's stored tm_percent) is meaningfully higher than the current
 * stored TM, propose a recalibrate. Same hard-gate machinery as the AMRAP
 * confidence gate: 28-day cooldown, no-duplicate proposal, no active
 * limitation.
 *
 * Mutually exclusive per movement with same-session AMRAP bumps — if both
 * paths fire for the same lift, the AMRAP card wins (it has the explicit
 * "you beat the prescribed target" reasoning).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { bestEstimateOneRm } from "@/lib/engine/one-rm";
import { detectPrs } from "@/lib/engine/pr";

export type PrRecalibrateProposal = {
  movementId: string;
  movementDisplayName: string;
  currentTm: number;
  proposedTm: number;
  estimatedOneRm: number;
  /** The set that triggered the proposal. */
  bestSet: { weight: number; reps: number; rpe: number | null };
  triggerKey: string;
};

/** Minimum TM jump worth surfacing as a recalibrate proposal. */
const MIN_TM_JUMP_KG = 2.0;
const COOLDOWN_DAYS = 28;

/**
 * Find PR-driven recalibrate proposals for the session. `excludeMovementIds`
 * lists movements that already have an AMRAP-driven proposal so we don't
 * double-stack cards.
 */
export async function findPrRecalibrateProposals(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  sessionPerformedAt: string,
  excludeMovementIds: Set<string>,
): Promise<PrRecalibrateProposal[]> {
  // Step 1: pull this session's main-lift sets.
  const { data: sessionSets } = await supabase
    .from("set_logs")
    .select("set_kind, weight_kg, reps, rpe, movement:movements(id, display_name)")
    .eq("session_id", sessionId)
    .eq("skipped", false)
    .in("set_kind", ["main", "back_off"])
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0);
  if (!sessionSets || sessionSets.length === 0) return [];

  // Step 2: pick the strongest set per movement.
  type Working = { id: string; name: string; best: { weight: number; reps: number; rpe: number | null } };
  const best = new Map<string, Working>();
  for (const row of sessionSets as Array<{ weight_kg: number; reps: number; rpe: number | null; movement: { id: string; display_name: string } | { id: string; display_name: string }[] | null }>) {
    const m = Array.isArray(row.movement) ? row.movement[0] : row.movement;
    if (!m) continue;
    if (excludeMovementIds.has(m.id)) continue;
    const candidate = { weight: Number(row.weight_kg), reps: Number(row.reps), rpe: row.rpe };
    const existing = best.get(m.id);
    if (!existing) {
      best.set(m.id, { id: m.id, name: m.display_name, best: candidate });
      continue;
    }
    if (
      candidate.weight > existing.best.weight ||
      (candidate.weight === existing.best.weight && candidate.reps > existing.best.reps)
    ) {
      existing.best = candidate;
    }
  }
  if (best.size === 0) return [];

  const movementIds = Array.from(best.keys());

  // Step 3: pull prior set history per movement so we can run PR detection.
  const { data: priorSessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", userId)
    .lt("performed_at", sessionPerformedAt)
    .is("deleted_at", null);
  const priorIds = (priorSessions ?? []).map((s) => s.id);

  type PriorSet = { movement_id: string; weight_kg: number; reps: number; rpe: number | null; performed_at: string };
  let priorSets: PriorSet[] = [];
  if (priorIds.length > 0) {
    const { data: rows } = await supabase
      .from("set_logs")
      .select("movement_id, weight_kg, reps, rpe, performed_at:sessions!inner(performed_at)")
      .in("session_id", priorIds)
      .in("movement_id", movementIds)
      .eq("skipped", false)
      .neq("set_kind", "warmup")
      .not("weight_kg", "is", null)
      .not("reps", "is", null)
      .gt("reps", 0);
    priorSets = (rows ?? []).map((r) => {
      const perf = Array.isArray(r.performed_at) ? r.performed_at[0] : r.performed_at;
      return {
        movement_id: r.movement_id,
        weight_kg: Number(r.weight_kg),
        reps: Number(r.reps),
        rpe: r.rpe,
        performed_at: (perf?.performed_at as string) ?? sessionPerformedAt,
      };
    });
  }

  const historyByMovement = new Map<string, { weight: number; reps: number; rpe: number | null; performed_at: string }[]>();
  for (const r of priorSets) {
    const arr = historyByMovement.get(r.movement_id) ?? [];
    arr.push({ weight: r.weight_kg, reps: r.reps, rpe: r.rpe, performed_at: r.performed_at });
    historyByMovement.set(r.movement_id, arr);
  }

  // Step 4: per movement, check for an e1RM PR + hard gates + meaningful jump.
  const proposals: PrRecalibrateProposal[] = [];
  for (const [movementId, w] of best) {
    const history = historyByMovement.get(movementId) ?? [];
    const prResult = detectPrs({ weight: w.best.weight, reps: w.best.reps, rpe: w.best.rpe }, history);
    const e1RmHit = prResult.hits.find((h) => h.kind === "e1rm");
    if (!e1RmHit) continue;

    // Hard gate 1: must have a stored TM to recalibrate.
    const { data: tmRow } = await supabase
      .from("training_maxes")
      .select("one_rm_kg, tm_percent")
      .eq("user_id", userId)
      .eq("movement_id", movementId)
      .maybeSingle();
    if (!tmRow) continue;
    const tmPct = tmRow.tm_percent != null ? Number(tmRow.tm_percent) / 100 : 0.9;
    const safePct = tmPct > 0 && tmPct <= 1 ? tmPct : 0.9;
    const currentTm = Number(tmRow.one_rm_kg) * safePct;
    if (!Number.isFinite(currentTm) || currentTm <= 0) continue;

    // Hard gate 2: 28-day cooldown / no-duplicate (any tm_history row in window).
    const twentyEightDaysAgo = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000).toISOString();
    const { count: recentChangeCount } = await supabase
      .from("tm_history")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("movement_id", movementId)
      .gte("changed_at", twentyEightDaysAgo);
    if ((recentChangeCount ?? 0) > 0) continue;

    // Hard gate 3: active limitation on the movement's region.
    const { data: movementRow } = await supabase
      .from("movements")
      .select("primary_region")
      .eq("id", movementId)
      .maybeSingle();
    if (movementRow?.primary_region) {
      const { count: limCount } = await supabase
        .from("limitations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("resolved_at", null)
        .eq("region", movementRow.primary_region);
      if ((limCount ?? 0) > 0) continue;
    }

    // Compute the proposed new TM using the conservative dispatcher.
    const estimatedOneRm = bestEstimateOneRm({
      weight: w.best.weight,
      reps: w.best.reps,
      rpe: w.best.rpe,
    });
    if (estimatedOneRm == null) continue;
    // Proposed TM matches the user's stored tm_percent so we don't silently
    // shift their 90%/85%/95% preference.
    const proposedTm =
      Math.round((estimatedOneRm * safePct) / 2.5) * 2.5;
    if (proposedTm - currentTm < MIN_TM_JUMP_KG) continue;

    proposals.push({
      movementId,
      movementDisplayName: w.name,
      currentTm,
      proposedTm,
      estimatedOneRm,
      bestSet: w.best,
      triggerKey: `${sessionId}:${movementId}:pr_recalibrate`,
    });
  }

  return proposals;
}
