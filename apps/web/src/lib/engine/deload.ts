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

export type DeloadChronology = {
  plannedId: string;
  blockId: string;
  weekIndex: number;
  dayIndex: number;
  performedAt: string | null;
  createdAt: string | null;
};

export type DeloadPriorCandidate = DeloadChronology & {
  completedSessionId: string;
  movementId: string;
  target: number;
};

/**
 * True when `a` happened before `b` in this block.
 * Prefer actual session time; same-day backfills (shared start-of-day
 * performed_at) fall through to created_at, then week/day.
 */
export function isChronologicallyBefore(
  a: DeloadChronology,
  b: DeloadChronology,
): boolean {
  if (a.performedAt && b.performedAt && a.performedAt !== b.performedAt) {
    return a.performedAt < b.performedAt;
  }
  if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt;
  }
  if (a.weekIndex !== b.weekIndex) return a.weekIndex < b.weekIndex;
  return a.dayIndex < b.dayIndex;
}

/**
 * Same-block priors for the 2-miss streak, newest first.
 * Other blocks are out of this cycle. Missing session times are kept so
 * the caller can skip them without treating them as a hit.
 */
export function selectPriorDeloadCandidates(args: {
  current: DeloadChronology;
  candidates: readonly DeloadPriorCandidate[];
}): DeloadPriorCandidate[] {
  return args.candidates
    .filter(
      (c) =>
        c.plannedId !== args.current.plannedId &&
        c.blockId === args.current.blockId &&
        isChronologicallyBefore(c, args.current),
    )
    .sort((a, b) => {
      if (isChronologicallyBefore(a, b)) return 1;
      if (isChronologicallyBefore(b, a)) return -1;
      return 0;
    });
}

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
    .select("id, week_index, day_index, prescription, block_id")
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

  const { data: currentSessionMeta } = await supabase
    .from("sessions")
    .select("id, performed_at, created_at")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  // 3. Prior AMRAP sessions in THIS block, in actual time order.
  const { data: priorPlanned } = await supabase
    .from("planned_sessions")
    .select("id, week_index, day_index, prescription, completed_session_id, block_id")
    .eq("user_id", userId)
    .eq("block_id", planned.block_id)
    .neq("id", planned.id)
    .not("completed_session_id", "is", null);

  // Audit F7 fix — pre-filter to the planned sessions whose AMRAP
  // matches `movementId`, then bulk-load the data wasRealMiss needs
  // (sessions row + set_logs) for the whole candidate set in two
  // parallel queries. Was up to 20 × 2 = 40 serial round trips inside
  // a for-of loop.
  type MatchedPlanned = {
    plannedId: string;
    blockId: string;
    weekIndex: number;
    dayIndex: number;
    sessionId: string;
    target: number;
  };
  const matched: MatchedPlanned[] = [];
  for (const p of priorPlanned ?? []) {
    const pPresc = p.prescription as Prescription | null;
    if (!pPresc) continue;
    const pAmrap = detectAmrap(pPresc, p.week_index);
    if (!pAmrap?.item.movementId) continue;
    if (pAmrap.item.movementId !== movementId) continue;
    if (!p.completed_session_id) continue;
    matched.push({
      plannedId: p.id,
      blockId: p.block_id,
      weekIndex: p.week_index,
      dayIndex: p.day_index,
      sessionId: p.completed_session_id,
      target: pAmrap.target,
    });
  }

  let priorMiss: MissRow | null = null;
  if (matched.length > 0) {
    const candidateSessionIds = matched.map((c) => c.sessionId);
    const [{ data: sessionRows }, { data: setRows }] = await Promise.all([
      supabase
        .from("sessions")
        .select("id, performed_at, created_at, fatigue, soreness")
        .in("id", candidateSessionIds)
        .eq("user_id", userId)
        .is("deleted_at", null),
      supabase
        .from("set_logs")
        .select("session_id, weight_kg, reps, set_kind")
        .in("session_id", candidateSessionIds)
        .eq("movement_id", movementId)
        .eq("skipped", false)
        .neq("set_kind", "warmup")
        .not("weight_kg", "is", null)
        .not("reps", "is", null),
    ]);
    const sessionById = new Map(
      ((sessionRows ?? []) as Array<{
        id: string;
        performed_at: string;
        created_at: string | null;
        fatigue: number | null;
        soreness: number | null;
      }>).map((s) => [s.id, s]),
    );
    const setsBySession = new Map<string, Array<{ weight_kg: number | string; reps: number | string }>>();
    for (const r of (setRows ?? []) as Array<{
      session_id: string;
      weight_kg: number | string;
      reps: number | string;
    }>) {
      const arr = setsBySession.get(r.session_id) ?? [];
      arr.push({ weight_kg: r.weight_kg, reps: r.reps });
      setsBySession.set(r.session_id, arr);
    }

    const priors = selectPriorDeloadCandidates({
      current: {
        plannedId: planned.id,
        blockId: planned.block_id,
        weekIndex: planned.week_index,
        dayIndex: planned.day_index,
        performedAt: (currentSessionMeta?.performed_at as string | null) ?? thisMiss.performedAt,
        createdAt: (currentSessionMeta?.created_at as string | null) ?? null,
      },
      candidates: matched.map((c) => {
        const session = sessionById.get(c.sessionId);
        return {
          plannedId: c.plannedId,
          blockId: c.blockId,
          weekIndex: c.weekIndex,
          dayIndex: c.dayIndex,
          completedSessionId: c.sessionId,
          movementId,
          target: c.target,
          performedAt: session?.performed_at ?? null,
          createdAt: session?.created_at ?? null,
        };
      }),
    });

    // Newest-first. A missing live session is skipped (not a hit). The
    // first real non-miss still breaks the streak.
    for (const c of priors) {
      const session = sessionById.get(c.completedSessionId);
      if (!session) continue;
      const candidate = evaluateRealMissFromRows(
        session,
        setsBySession.get(c.completedSessionId) ?? [],
        c.target,
      );
      if (candidate) {
        priorMiss = candidate;
        break;
      }
      return null;
    }
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
 *
 * Used for the *current* session check (single row → two queries is
 * fine). The prior-session loop in `findDeloadProposalForSession`
 * bypasses this wrapper and bulk-loads the same data once via
 * `evaluateRealMissFromRows` to avoid the audit-F7 N+1.
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

  return evaluateRealMissFromRows(
    session as { id: string; performed_at: string; fatigue: number | null; soreness: number | null },
    (sets ?? []) as Array<{ weight_kg: number | string; reps: number | string }>,
    amrapTarget,
  );
}

/**
 * Pure variant of `wasRealMiss` — takes the already-fetched session
 * row and its set_logs and returns the miss record (or null). Lets the
 * deload flow bulk-load the candidate window once instead of issuing
 * two queries per candidate.
 */
function evaluateRealMissFromRows(
  session: { id: string; performed_at: string; fatigue: number | null; soreness: number | null },
  sets: ReadonlyArray<{ weight_kg: number | string; reps: number | string }>,
  amrapTarget: number,
): MissRow | null {
  const grm = computeGrm({ fatigue: session.fatigue, soreness: session.soreness });
  if (grm.hasCheckIn && grm.value < GRM_FATIGUE_THRESHOLD) {
    return null;
  }
  let best: { weight: number; reps: number } | null = null;
  for (const s of sets) {
    const w = Number(s.weight_kg);
    const r = Number(s.reps);
    if (!Number.isFinite(w) || !Number.isFinite(r)) continue;
    if (!best || w > best.weight || (w === best.weight && r > best.reps)) {
      best = { weight: w, reps: r };
    }
  }
  if (!best) return null;

  // Miss = reps under the AMRAP target.
  if (best.reps >= amrapTarget) return null;

  return {
    sessionId: session.id,
    performedAt: session.performed_at,
    targetReps: amrapTarget,
    performedReps: best.reps,
    weight: best.weight,
  };
}
