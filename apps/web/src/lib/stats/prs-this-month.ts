/**
 * PRs this calendar month — top-3 e1RM PRs across all movements.
 *
 * Phase 1 brief: count UNIQUE movements where the user hit a new e1RM
 * PR this calendar month, and show the top 3. Reuses the canonical
 * `detectPrs` logic (`@/lib/engine/pr`) so the surface stays in sync
 * with the in-session PR pop and the recent-PRs feed on the existing
 * `/app/stats/prs` page.
 *
 * Strategy:
 *   1. Walk every non-deleted, completed session this calendar month.
 *   2. For each, pull the session's sets + every prior set (any time)
 *      for the touched movements.
 *   3. Run `detectPrs` per (movement × session), keep only e1RM hits.
 *   4. Dedup to one row per movement, keeping the strongest hit, then
 *      sort by hit value desc.
 *
 * Cost is bounded — at most one calendar month of sessions, each with
 * a small number of touched movements, and the prior-sets lookup runs
 * one query per movement-id batched per session. Acceptable for a
 * dashboard read.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bestEstimateOneRm,
  type OneRmInput,
} from "@/lib/engine/one-rm";
import { detectPrs, type HistoricalSet, type PrHit } from "@/lib/engine/pr";

export type MonthlyPr = {
  movementId: string;
  movementSlug: string;
  movementDisplayName: string;
  /** The set that hit the PR (kg × reps). */
  weight: number;
  reps: number;
  /** ISO date string YYYY-MM-DD. */
  date: string;
  hit: PrHit;
};

export type MonthlyPrsResult = {
  /** Unique movements with at least one e1RM PR this month. */
  uniqueMovementCount: number;
  /** Top 3 PRs by e1RM hit value, desc. */
  topThree: MonthlyPr[];
};

/**
 * Pure dedup + sort: collapse per-(movement × session) hits down to the
 * single strongest PR per movement, then return the top 3 by hit value.
 *
 * Exported for unit tests.
 */
export function selectTopMonthlyE1RmPrs(
  hits: MonthlyPr[],
  limit = 3,
): MonthlyPrsResult {
  const byMovement = new Map<string, MonthlyPr>();
  for (const h of hits) {
    if (h.hit.kind !== "e1rm") continue;
    const existing = byMovement.get(h.movementId);
    if (!existing || h.hit.value > existing.hit.value) {
      byMovement.set(h.movementId, h);
    }
  }
  const sorted = Array.from(byMovement.values()).sort(
    (a, b) => b.hit.value - a.hit.value,
  );
  return {
    uniqueMovementCount: byMovement.size,
    topThree: sorted.slice(0, limit),
  };
}

/**
 * Read-side wrapper. Walks this calendar month's completed sessions and
 * runs PR detection against the user's full prior history per touched
 * movement.
 */
export async function getMonthlyPrs(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<MonthlyPrsResult> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthStartIso = monthStart.toISOString();

  // 1. This-month completed sessions.
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .gte("performed_at", monthStartIso)
    .order("performed_at", { ascending: true });

  if (!sessions || sessions.length === 0) {
    return { uniqueMovementCount: 0, topThree: [] };
  }

  const monthSessionIds = sessions.map((s) => s.id);

  // 2. All sets logged in those sessions, joined to movement.
  const { data: monthSets } = await supabase
    .from("set_logs")
    .select(
      "session_id, weight_kg, reps, rpe, set_kind, movement:movements(id, slug, display_name)",
    )
    .in("session_id", monthSessionIds)
    .neq("set_kind", "warmup")
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0);

  if (!monthSets || monthSets.length === 0) {
    return { uniqueMovementCount: 0, topThree: [] };
  }

  type SessionMeta = { id: string; performedAt: string };
  const sessionMeta = new Map<string, SessionMeta>(
    sessions.map((s) => [s.id, { id: s.id, performedAt: s.performed_at }]),
  );

  // 3. Bucket sets per (session, movement) and pick the strongest per pair.
  type Working = {
    sessionId: string;
    movementId: string;
    movementSlug: string;
    movementDisplayName: string;
    weight: number;
    reps: number;
    rpe: number | null;
  };
  const bestPerPair = new Map<string, Working>();
  type RawSet = {
    session_id: string;
    weight_kg: number | string;
    reps: number;
    rpe: number | string | null;
    movement:
      | { id: string; slug: string; display_name: string }
      | Array<{ id: string; slug: string; display_name: string }>
      | null;
  };
  for (const row of (monthSets as RawSet[])) {
    const mv = Array.isArray(row.movement) ? row.movement[0] : row.movement;
    if (!mv?.id) continue;
    const key = `${row.session_id}::${mv.id}`;
    const candidate: Working = {
      sessionId: row.session_id,
      movementId: mv.id,
      movementSlug: mv.slug,
      movementDisplayName: mv.display_name,
      weight: Number(row.weight_kg),
      reps: Number(row.reps),
      rpe: row.rpe == null ? null : Number(row.rpe),
    };
    const existing = bestPerPair.get(key);
    if (
      !existing ||
      candidate.weight > existing.weight ||
      (candidate.weight === existing.weight && candidate.reps > existing.reps)
    ) {
      bestPerPair.set(key, candidate);
    }
  }

  // 4. Per movement, fetch the full prior history (sessions before
  //    monthStart) so PR detection has a true baseline.
  const movementIds = Array.from(new Set(Array.from(bestPerPair.values()).map((w) => w.movementId)));
  type PriorSet = HistoricalSet & { movementId: string };
  const priorByMovement = new Map<string, HistoricalSet[]>();
  if (movementIds.length > 0) {
    const { data: prior } = await supabase
      .from("set_logs")
      .select(
        "movement_id, weight_kg, reps, rpe, set_kind, sessions!inner(user_id, performed_at, deleted_at)",
      )
      .in("movement_id", movementIds)
      .eq("sessions.user_id", userId)
      .is("sessions.deleted_at", null)
      .lt("sessions.performed_at", monthStartIso)
      .neq("set_kind", "warmup")
      .not("weight_kg", "is", null)
      .not("reps", "is", null)
      .gt("reps", 0);
    type RawPrior = {
      movement_id: string;
      weight_kg: number | string;
      reps: number;
      rpe: number | string | null;
      sessions:
        | { performed_at: string }
        | Array<{ performed_at: string }>
        | null;
    };
    for (const r of (prior ?? []) as RawPrior[]) {
      const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
      if (!s?.performed_at) continue;
      const arr = priorByMovement.get(r.movement_id) ?? [];
      arr.push({
        weight: Number(r.weight_kg),
        reps: Number(r.reps),
        rpe: r.rpe == null ? null : Number(r.rpe),
        performed_at: s.performed_at,
      });
      priorByMovement.set(r.movement_id, arr);
    } 
    // The PriorSet alias is exported via the type tuple above; the
    // imports stay tight even if TS sees it unused.
    void ({} as PriorSet);
  }

  // 5. Iterate sessions in chronological order so earlier sets in this
  //    month feed later sets' history — otherwise a strong session-1
  //    set would block a session-2 PR on the same movement.
  const sortedPairs = Array.from(bestPerPair.values()).sort((a, b) => {
    const ta = new Date(sessionMeta.get(a.sessionId)?.performedAt ?? 0).getTime();
    const tb = new Date(sessionMeta.get(b.sessionId)?.performedAt ?? 0).getTime();
    return ta - tb;
  });

  const hits: MonthlyPr[] = [];
  for (const w of sortedPairs) {
    const history = priorByMovement.get(w.movementId) ?? [];
    const result = detectPrs(
      { weight: w.weight, reps: w.reps, rpe: w.rpe },
      history,
    );
    // Feed this set into the prior history for subsequent same-movement
    // sessions in the same month — keeps in-month PR counting honest.
    const perfAt = sessionMeta.get(w.sessionId)?.performedAt ?? new Date().toISOString();
    history.push({ weight: w.weight, reps: w.reps, rpe: w.rpe, performed_at: perfAt });
    priorByMovement.set(w.movementId, history);
    for (const hit of result.hits) {
      if (hit.kind !== "e1rm") continue;
      hits.push({
        movementId: w.movementId,
        movementSlug: w.movementSlug,
        movementDisplayName: w.movementDisplayName,
        weight: w.weight,
        reps: w.reps,
        date: perfAt.slice(0, 10),
        hit,
      });
    }
  }

  return selectTopMonthlyE1RmPrs(hits, 3);
}

/** Convenience for tests / callers that already have inputs. */
export function estimateOneRm(input: OneRmInput): number | null {
  return bestEstimateOneRm(input);
}
