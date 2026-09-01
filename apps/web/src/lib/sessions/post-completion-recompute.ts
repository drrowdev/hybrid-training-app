/**
 * Derived-state re-stamp for mutations on an ALREADY-COMPLETED session
 * (plan §6.9 — one canonical home; call sites import, nobody re-derives).
 *
 * ## Why this exists
 *
 * A completed session is no longer immutable: the Today/Plan drawer's ✎ Edit
 * opens the full session view, where a finished session can gain a set that the
 * prescription never had a slot for, or have a logged set corrected. Both write
 * `set_logs` AFTER `sessions.completed_at` was stamped, so two pieces of derived
 * state that were computed at completion time go stale:
 *
 *   1. `planned_sessions.effective_stress_load` / `session_modality` — the
 *      actual-ESL stamp (`recomputeActualSessionLoad`).
 *   2. `region_state` — the per-region load ledger + freshness (DC-C14), which
 *      is rebuilt from every COMPLETED session's `set_logs`
 *      (`recomputeRegionState`). An extra post-hoc working set really is extra
 *      regional load; leaving it out would let DC-V2's load-recency warning
 *      under-report.
 *   3. Pending TM suggestions for this session — edit or delete of the
 *      source set must drop or rewrite the banner. Accepted/declined
 *      history stays put.
 *
 * ## Why it is gated on completion
 *
 * `recomputeRegionState` rebuilds the whole user ledger, so it must never run
 * per-set during a live workout. The completion read is the gate: mid-session
 * this helper costs exactly one indexed `sessions` lookup and returns.
 * `recomputeActualSessionLoad` has the same posture built in (its
 * `requireCompleted` default), so we pass `requireCompleted: false` here only
 * because we have *already* proven completion and don't want it re-reading.
 *
 * ## Failure posture
 *
 * Best-effort, exactly like every other recompute hook: the caller's primary
 * write already landed, so a recompute failure logs and returns rather than
 * surfacing as a failed log/edit.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { recomputeActualSessionLoad } from "@/lib/engine/recompute-actual-session-load";
import { recomputeRegionState } from "@/lib/engine/region-ledger";
import { getUserTimezone } from "@/lib/planner/queries";

export async function recomputeAfterCompletedSessionMutation(args: {
  supabase: SupabaseClient;
  sessionId: string;
  /** Authenticated user id — the read stays user-scoped on top of RLS. */
  userId: string;
  /** Final-log deletion means an actual zero, unlike an unfulfilled plan. */
  emptyLogBehavior?: "preserve-prescribed" | "zero-actual";
}): Promise<{ recomputed: boolean }> {
  const { supabase, sessionId, userId } = args;

  let completed = false;
  try {
    const { data, error } = await supabase
      .from("sessions")
      .select("completed_at")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    completed = !!(data as { completed_at?: string | null } | null)?.completed_at;
  } catch (e) {
    console.error("post-completion recompute: session read failed:", e);
    return { recomputed: false };
  }
  if (!completed) return { recomputed: false };

  try {
    await recomputeActualSessionLoad({
      supabase,
      sessionId,
      requireCompleted: false,
      emptyLogBehavior: args.emptyLogBehavior,
    });
  } catch (e) {
    console.error(
      "recomputeActualSessionLoad (post-completion mutation) failed:",
      e,
    );
  }

  try {
    await recomputeRegionState(supabase, userId, await getUserTimezone(userId));
  } catch (e) {
    console.error(
      "recomputeRegionState (post-completion mutation) failed:",
      e,
    );
  }

  try {
    const { syncTmSuggestionsForSession } = await import(
      "@/lib/training-maxes/tm-suggestion-sync"
    );
    await syncTmSuggestionsForSession(supabase, userId, sessionId);
  } catch (e) {
    console.error(
      "syncTmSuggestionsForSession (post-completion mutation) failed:",
      e,
    );
  }

  return { recomputed: true };
}
