/**
 * PRs-in-window — Phase 2 range-aware PR summary.
 *
 * Phase 1 surfaced "PRs this calendar month" (see `prs-this-month.ts`).
 * Phase 2 adds a 30d / 90d / all-time toggle, so we need a window-aware
 * variant. The logic is identical to `getMonthlyPrs` but the lower
 * bound is `today − windowDays` (or removed entirely for all-time).
 *
 * Returns the same shape as `MonthlyPrsResult` (renamed `PrsRangeResult`
 * here for clarity) so the dashboard card can swap helpers without
 * changing its render code.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd, todayYmd } from "@/lib/dates";
import { detectPrs, type HistoricalSet } from "@/lib/engine/pr";
import { type MonthlyPr, selectTopMonthlyE1RmPrs } from "./prs-this-month";

export type PrsRangeResult = {
  uniqueMovementCount: number;
  topThree: MonthlyPr[];
  windowDays: number | null;
};

export async function getPrsForRange(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  windowDays: number | null,
): Promise<PrsRangeResult> {
  // Resolve the lower bound (inclusive). For all-time we drop the
  // gte() filter entirely so the walk starts at the user's first
  // completed session.
  const today = todayYmd(tz);
  const earliestIso =
    windowDays == null ? null : `${addDaysToYmd(today, -windowDays)}T00:00:00Z`;

  // 1. Completed sessions in the window.
  let sessionQuery = supabase
    .from("sessions")
    .select("id, performed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .order("performed_at", { ascending: true });
  if (earliestIso != null) sessionQuery = sessionQuery.gte("performed_at", earliestIso);
  const { data: sessions } = await sessionQuery;
  if (!sessions || sessions.length === 0) {
    return { uniqueMovementCount: 0, topThree: [], windowDays };
  }

  const windowSessionIds = sessions.map((s) => s.id);

  // 2. Set logs in the window's sessions.
  const { data: windowSets } = await supabase
    .from("set_logs")
    .select(
      "session_id, weight_kg, reps, rpe, set_kind, movement:movements(id, slug, display_name)",
    )
    .in("session_id", windowSessionIds)
    .eq("skipped", false)
    .neq("set_kind", "warmup")
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0);

  if (!windowSets || windowSets.length === 0) {
    return { uniqueMovementCount: 0, topThree: [], windowDays };
  }

  type SessionMeta = { id: string; performedAt: string };
  const sessionMeta = new Map<string, SessionMeta>(
    sessions.map((s) => [s.id, { id: s.id, performedAt: s.performed_at }]),
  );

  // 3. Best (session × movement) set in the window.
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
  for (const row of windowSets as RawSet[]) {
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

  // 4. Prior history per movement (sessions BEFORE the window start).
  const movementIds = Array.from(
    new Set(Array.from(bestPerPair.values()).map((w) => w.movementId)),
  );
  const priorByMovement = new Map<string, HistoricalSet[]>();
  if (movementIds.length > 0 && earliestIso != null) {
    const { data: prior } = await supabase
      .from("set_logs")
      .select(
        "movement_id, weight_kg, reps, rpe, set_kind, sessions!inner(user_id, performed_at, deleted_at)",
      )
      .in("movement_id", movementIds)
      .eq("sessions.user_id", userId)
      .is("sessions.deleted_at", null)
      .lt("sessions.performed_at", earliestIso)
      .eq("skipped", false)
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
  }
  // For all-time, every set IS history vs nothing — we still detect
  // first-ever PRs which fire on the very first credible set.

  // 5. Iterate chronologically so earlier in-window sets feed later
  //    sets' history (otherwise a strong early set blocks a later PR).
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

  const collapsed = selectTopMonthlyE1RmPrs(hits, 3);
  return { ...collapsed, windowDays };
}
