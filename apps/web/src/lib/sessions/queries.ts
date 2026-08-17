/**
 * Session-log query helpers (Phase 1 Today/Log UX pass).
 *
 * Keeping these out of `actions.ts` because they are pure reads — no
 * `"use server"` boundary needed, and they get imported by both server
 * components (Today / session-detail pages) and the test harness.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCountableSet } from "@/lib/engine/set-load";

export type LastSetForMovement = {
  movementId: string;
  weightKg: number;
  reps: number;
  rpe: number | null;
  /** ISO timestamp of the parent session's performed_at. */
  performedAt: string;
};

/**
 * "Last time you trained this lift" — the top set (heaviest weight,
 * tiebreak by reps) from the most recent non-deleted session in which
 * the user logged this movement. Used to power the inline hint above
 * each prescription item on the session-log surface.
 *
 * Strategy: pull the user's recent non-deleted, non-warmup set_logs for
 * this movement and pick the strongest one in the most recent prior
 * session. We sort by performed_at desc, then for the most recent
 * session that contains the movement we pick the heaviest set.
 *
 * Returns null when the user has no prior history with this movement —
 * the UI hides the hint rather than rendering an awkward empty state.
 */
export async function getLastSetLogForMovement(
  supabase: SupabaseClient,
  userId: string,
  movementId: string,
  options: { excludeSessionId?: string } = {},
): Promise<LastSetForMovement | null> {
  if (!userId || !movementId) return null;

  // Pull the candidate set_logs joined with their parent session so we
  // can filter deleted sessions out and sort by performed_at. We cap at
  // a window of 30 sets which is enough to cover the most recent
  // session even on high-frequency programs.
  const { data, error } = await supabase
    .from("set_logs")
    .select(
      "weight_kg, reps, rpe, sessions!inner(id, user_id, performed_at, deleted_at)",
    )
    .eq("movement_id", movementId)
    .eq("sessions.user_id", userId)
    .is("sessions.deleted_at", null)
    .eq("skipped", false)
    .neq("set_kind", "warmup")
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0)
    .order("performed_at", { ascending: false, referencedTable: "sessions" })
    .limit(30);

  if (error || !data || data.length === 0) return null;

  type Row = {
    weight_kg: number | string | null;
    reps: number | null;
    rpe: number | string | null;
    sessions:
      | { id: string; performed_at: string; deleted_at: string | null }
      | { id: string; performed_at: string; deleted_at: string | null }[]
      | null;
  };

  // Group by parent session id; we want the top set from the most
  // recent session that isn't the current one.
  const groups = new Map<
    string,
    { performedAt: string; sets: Array<{ weight: number; reps: number; rpe: number | null }> }
  >();
  for (const r of data as Row[]) {
    const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
    if (!s) continue;
    if (options.excludeSessionId && s.id === options.excludeSessionId) continue;
    const weight = Number(r.weight_kg);
    const reps = Number(r.reps);
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(reps) || reps <= 0) continue;
    const arr = groups.get(s.id) ?? { performedAt: s.performed_at, sets: [] };
    arr.sets.push({ weight, reps, rpe: r.rpe == null ? null : Number(r.rpe) });
    groups.set(s.id, arr);
  }
  if (groups.size === 0) return null;

  // Sort sessions newest-first and walk forward picking the top set
  // from the first non-empty one.
  const sessionsSorted = Array.from(groups.entries()).sort((a, b) =>
    a[1].performedAt < b[1].performedAt ? 1 : -1,
  );

  for (const [, g] of sessionsSorted) {
    let best: { weight: number; reps: number; rpe: number | null } | null = null;
    for (const s of g.sets) {
      if (!best) {
        best = s;
        continue;
      }
      if (s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps)) {
        best = s;
      }
    }
    if (best) {
      return {
        movementId,
        weightKg: best.weight,
        reps: best.reps,
        rpe: best.rpe,
        performedAt: g.performedAt,
      };
    }
  }
  return null;
}

/**
 * Batched "last time" hints for the live logger. This is the multi-movement
 * equivalent of `getLastSetLogForMovement`, backed by one Postgres RPC instead
 * of one PostgREST request per movement.
 */
export async function getLastSetsForMovements(
  supabase: SupabaseClient,
  userId: string,
  movementIds: string[],
  options: { excludeSessionId?: string } = {},
): Promise<Record<string, LastSetForMovement>> {
  if (!userId || movementIds.length === 0) return {};

  const { data, error } = await supabase.rpc("last_sets_for_movements", {
    p_movement_ids: movementIds,
    p_user_id: userId,
    p_exclude_session_id: options.excludeSessionId ?? null,
  });
  if (error || !data) return {};

  type Row = {
    movement_id: string;
    weight_kg: number | string;
    reps: number;
    rpe: number | string | null;
    performed_at: string;
  };

  const out: Record<string, LastSetForMovement> = {};
  for (const row of data as Row[]) {
    const weightKg = Number(row.weight_kg);
    const reps = Number(row.reps);
    if (!Number.isFinite(weightKg) || weightKg <= 0 || !Number.isFinite(reps) || reps <= 0) {
      continue;
    }
    out[row.movement_id] = {
      movementId: row.movement_id,
      weightKg,
      reps,
      rpe: row.rpe == null ? null : Number(row.rpe),
      performedAt: row.performed_at,
    };
  }
  return out;
}

export type SessionSummary = {
  setCount: number;
  /** Completed non-warmup rows, including unloaded rehab, timed holds, and carries. */
  workingSetCount: number;
  /** Sum of weight × reps across non-warmup strength sets, in kg. */
  totalTonnageKg: number;
  /** Duration in minutes — from sessions.duration_min if set, else derived from completed_at - performed_at. */
  durationMin: number | null;
  /** Number of unique PR hits triggered by the session's best sets. */
  prCount: number;
};

/**
 * Compute the session-summary numbers shown on the post-session card.
 *
 * Pure-ish — only takes already-fetched rows. Completion is independent
 * from tonnage: unloaded rehab/bodyweight reps, timed holds, and carries
 * are completed work even when no external weight was logged. Tonnage
 * still requires positive weight and reps. Warmups and skipped rows count
 * toward neither metric.
 */
export function summariseSessionSets(
  sets: Array<{
    set_kind: string;
    weight_kg: number | string | null;
    reps: number | null;
    duration_sec?: number | null;
    distance_m?: number | string | null;
    skipped?: boolean | null;
  }>,
  session: { performed_at: string; completed_at: string | null; duration_min: number | null },
  prCount: number,
): SessionSummary {
  let tonnage = 0;
  let workingCount = 0;
  for (const s of sets) {
    const w = Number(s.weight_kg ?? 0);
    const r = Number(s.reps ?? 0);
    const duration = Number(s.duration_sec ?? 0);
    const distance = Number(s.distance_m ?? 0);
    const isCountable = isCountableSet({
      setKind: s.set_kind,
      isSkipped: s.skipped,
    });
    const isCompletedWork =
      isCountable &&
      (r > 0 || duration > 0 || distance > 0);
    if (isCompletedWork) {
      workingCount += 1;
    }
    if (isCountable && w > 0 && r > 0) {
      tonnage += w * r;
    }
  }

  let duration: number | null =
    typeof session.duration_min === "number" ? session.duration_min : null;
  if (duration == null && session.completed_at && session.performed_at) {
    const start = new Date(session.performed_at).getTime();
    const end = new Date(session.completed_at).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      // Cap at 3h — matches complete_training_session so the two code paths
      // never disagree by an order of magnitude.
      duration = Math.min(180, Math.round((end - start) / 60_000));
    }
  }

  return {
    setCount: sets.length,
    workingSetCount: workingCount,
    totalTonnageKg: Math.round(tonnage * 10) / 10,
    durationMin: duration,
    prCount,
  };
}

/**
 * Prior-bests snapshot per movement (B3 PR-badge — perf audit F11).
 *
 * Pushes the aggregation server-side via the
 * `prior_bests_for_movements(uuid[], uuid, timestamptz)` RPC (see
 * migration 0054_prior_bests_rpc.sql). The function applies the same
 * filters the old in-page code did — non-warmup sets, non-deleted
 * sessions, weight/reps present, sessions.performed_at strictly before
 * the cutoff — and returns one row per movement with the heaviest
 * weight and the strongest conservative e1RM.
 *
 * The SQL `conservative_e1rm(weight, reps, rpe)` mirrors
 * `lib/engine/one-rm.ts::bestEstimateOneRm` cell-for-cell; the unit
 * test in `__tests__/prior-bests.test.ts` proves the algorithm match
 * on a fixture of 3 movements × ~30 sets.
 *
 * Returns an empty object when no movements are requested or when the
 * user has no qualifying history. Movements with zero prior history
 * are simply absent from the map (same null-handling as the legacy
 * code, which only set keys when at least one row matched).
 */
export type PriorBestSnapshot = {
  heaviestWeight: number | null;
  bestE1rm: number | null;
};

export async function getPriorBestsForMovements(
  supabase: SupabaseClient,
  userId: string,
  movementIds: string[],
  cutoff: string,
): Promise<Record<string, PriorBestSnapshot>> {
  if (!userId || !cutoff || movementIds.length === 0) return {};

  const { data, error } = await supabase.rpc("prior_bests_for_movements", {
    p_movement_ids: movementIds,
    p_user_id: userId,
    p_cutoff: cutoff,
  });
  if (error || !data) return {};

  type Row = {
    movement_id: string;
    max_weight: number | string | null;
    max_e1rm: number | string | null;
  };

  const out: Record<string, PriorBestSnapshot> = {};
  for (const r of data as Row[]) {
    const heaviestWeight =
      r.max_weight == null ? null : Number(r.max_weight);
    const bestE1rm = r.max_e1rm == null ? null : Number(r.max_e1rm);
    out[r.movement_id] = {
      heaviestWeight:
        heaviestWeight != null && Number.isFinite(heaviestWeight)
          ? heaviestWeight
          : null,
      bestE1rm:
        bestE1rm != null && Number.isFinite(bestE1rm) ? bestE1rm : null,
    };
  }
  return out;
}

/**
 * Recent-completed sessions used to power the Today-page "Quick workout"
 * sheet "Repeat" list. Scoped to the past 14 days because anything older
 * is noise — the goal is "do what I did last Tuesday", not archaeology.
 *
 * Quick workouts are strength-only, so this returns only sessions that
 * logged at least one strength set (pure-cardio sessions — e.g. a logged
 * imports — are filtered out; repeating clones strength movements only).
 *
 * Returns up to `limit` rows ordered by `performed_at` desc, with a
 * coarse summary string for each. The summary is intentionally
 * shape-only (set count) — we don't compute tonnage or RPE here because
 * the row is a tap target, not a stats card.
 */
export type QuickRepeatCandidate = {
  id: string;
  title: string | null;
  performedAt: string;
  /** Short human summary like "5 movements · 12 sets". */
  summary: string;
};

export async function getQuickRepeatCandidates(
  supabase: SupabaseClient,
  userId: string,
  options: { limit?: number; sinceIso?: string } = {},
): Promise<QuickRepeatCandidate[]> {
  if (!userId) return [];
  const limit = Math.max(1, Math.min(10, options.limit ?? 3));
  const since =
    options.sinceIso ??
    new Date(Date.now() - 14 * 86_400_000).toISOString();

  // Over-fetch a small buffer so that filtering out pure-cardio sessions
  // still leaves up to `limit` strength candidates to show.
  const fetchLimit = Math.min(20, limit * 4);
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, title, performed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .gte("performed_at", since)
    .order("performed_at", { ascending: false })
    .limit(fetchLimit);
  if (error || !sessions || sessions.length === 0) return [];

  const ids = sessions.map((s) => s.id as string);
  const { data: setRows } = await supabase
    .from("set_logs")
    .select("session_id, movement_id")
    .in("session_id", ids)
    .eq("skipped", false);

  type Agg = {
    setCount: number;
    movementIds: Set<string>;
  };
  const aggBySession = new Map<string, Agg>();
  for (const id of ids) {
    aggBySession.set(id, { setCount: 0, movementIds: new Set() });
  }
  for (const r of setRows ?? []) {
    const a = aggBySession.get(r.session_id as string);
    if (!a) continue;
    a.setCount += 1;
    if (r.movement_id) a.movementIds.add(r.movement_id as string);
  }

  const out: QuickRepeatCandidate[] = [];
  for (const s of sessions) {
    const a = aggBySession.get(s.id as string)!;
    // Strength-only: skip sessions with no logged strength sets.
    if (a.setCount === 0) continue;
    out.push({
      id: s.id as string,
      title: (s.title as string | null) ?? null,
      performedAt: s.performed_at as string,
      summary: summariseShape(a),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function summariseShape(agg: {
  setCount: number;
  movementIds: Set<string>;
}): string {
  if (agg.movementIds.size > 0) {
    const m = agg.movementIds.size;
    const s = agg.setCount;
    return `${m} movement${m === 1 ? "" : "s"} · ${s} set${s === 1 ? "" : "s"}`;
  }
  return "Empty session";
}
