/**
 * Session-log query helpers (Phase 1 Today/Log UX pass).
 *
 * Keeping these out of `actions.ts` because they are pure reads — no
 * `"use server"` boundary needed, and they get imported by both server
 * components (Today / session-detail pages) and the test harness.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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

export type SessionSummary = {
  setCount: number;
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
 * Pure-ish — only takes already-fetched rows. Tonnage excludes warmups
 * (consistent with how PR detection treats them) and excludes sets
 * without both weight and reps.
 */
export function summariseSessionSets(
  sets: Array<{
    set_kind: string;
    weight_kg: number | string | null;
    reps: number | null;
  }>,
  session: { performed_at: string; completed_at: string | null; duration_min: number | null },
  prCount: number,
): SessionSummary {
  let tonnage = 0;
  let workingCount = 0;
  for (const s of sets) {
    const w = Number(s.weight_kg ?? 0);
    const r = Number(s.reps ?? 0);
    if (s.set_kind !== "warmup" && w > 0 && r > 0) {
      tonnage += w * r;
      workingCount += 1;
    }
  }

  let duration: number | null =
    typeof session.duration_min === "number" ? session.duration_min : null;
  if (duration == null && session.completed_at && session.performed_at) {
    const start = new Date(session.performed_at).getTime();
    const end = new Date(session.completed_at).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      // Cap at 3h — matches deriveDurationMin in actions.ts so the two
      // code paths never disagree by an order of magnitude.
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
