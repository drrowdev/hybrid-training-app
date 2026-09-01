/**
 * Side-effect wrapper around `computeActualSessionLoad` — reads
 * set_logs + cardio_logs for a session, recomputes the actual ESL,
 * and UPDATEs the linked planned_sessions row.
 *
 * Hooked from:
 *   - sessions/actions.ts → completeSession (fires once after
 *     completed_at is stamped)
 *   - sessions/actions.ts → editSet / deleteSet / editCardio /
 *     deleteCardio (re-fires only when the session is already
 *     completed, so we don't churn the ESL stamp while the user is
 *     still mid-session)
 *
 * This function fails when any read or write fails. Its callers decide
 * whether the failed refresh should be logged as best-effort after their
 * primary write, but this function must never write a partial result.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeActualSessionLoad } from "./actual-session-load";

type SessionRow = {
  id: string;
  completed_at: string | null;
};

type PlannedRow = {
  id: string;
  session_modality: string | null;
};

type SetLogDbRow = {
  movement_id: string;
  set_kind: string;
  weight_kg: number | string | null;
  reps: number | null;
  rpe: number | string | null;
  skipped: boolean | null;
};

type CardioLogDbRow = {
  movement_id: string | null;
  modality: string | null;
  duration_sec: number;
  inferred_kind: string | null;
};

export type EmptyLogBehavior = "preserve-prescribed" | "zero-actual";

export async function recomputeActualSessionLoad(args: {
  supabase: SupabaseClient;
  sessionId: string;
  /**
   * When true (the default), only fire when the session has a
   * `completed_at` stamp. Call sites for edit/delete after completion
   * pass true; the completeSession hook passes false because it runs
   * right after stamping completed_at and the read-back is racy.
   */
  requireCompleted?: boolean;
  /**
   * A just-completed session with no logs remains an unfulfilled planned slot
   * by default. Deleting the final persisted log explicitly sets actual ESL to
   * zero while retaining the existing modality label for adherence context.
   */
  emptyLogBehavior?: EmptyLogBehavior;
}): Promise<void> {
  const { supabase, sessionId } = args;
  const requireCompleted = args.requireCompleted ?? true;
  const emptyLogBehavior = args.emptyLogBehavior ?? "preserve-prescribed";
  let sessionUserId: string | null = null;

  if (requireCompleted) {
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, user_id, completed_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) throw new Error(sessionError.message);
    const s = session as (SessionRow & { user_id: string }) | null;
    if (!s || !s.completed_at) return;
    sessionUserId = s.user_id;
  } else {
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("user_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) throw new Error(sessionError.message);
    sessionUserId = (session as { user_id?: string } | null)?.user_id ?? null;
    if (!sessionUserId) return;
  }

  const { data: planned, error: plannedError } = await supabase
    .from("planned_sessions")
    .select("id, session_modality")
    .eq("completed_session_id", sessionId)
    .maybeSingle();
  if (plannedError) throw new Error(plannedError.message);
  const p = planned as PlannedRow | null;
  if (!p) return;

  const [setResult, cardioResult] = await Promise.all([
    supabase
      .from("set_logs")
      .select("movement_id, set_kind, weight_kg, reps, rpe, skipped")
      .eq("session_id", sessionId),
    supabase
      .from("cardio_logs")
      .select("movement_id, modality, duration_sec, inferred_kind")
      .eq("session_id", sessionId),
  ]);
  if (setResult.error) throw new Error(setResult.error.message);
  if (cardioResult.error) throw new Error(cardioResult.error.message);

  const setLogs = (setResult.data ?? []) as SetLogDbRow[];
  const cardioLogs = (cardioResult.data ?? []) as CardioLogDbRow[];

  if (setLogs.length === 0 && cardioLogs.length === 0) {
    if (emptyLogBehavior === "preserve-prescribed") return;

    const { error: zeroError } = await supabase
      .from("planned_sessions")
      .update({ effective_stress_load: 0 })
      .eq("id", p.id)
      .eq("user_id", sessionUserId);
    if (zeroError) throw new Error(zeroError.message);
    return;
  }

  const out = computeActualSessionLoad({
    prescribedModality: p.session_modality,
    setLogs: setLogs.map((r) => ({
      movementId: r.movement_id,
      setKind: r.set_kind,
      weightKg: r.weight_kg == null ? null : Number(r.weight_kg),
      reps: r.reps,
      rpe: r.rpe == null ? null : Number(r.rpe),
      isSkipped: r.skipped === true,
    })),
    cardioLogs: cardioLogs.map((r) => ({
      movementId: r.movement_id,
      modality: r.modality ?? "",
      durationSec: r.duration_sec,
      inferredKind: r.inferred_kind,
    })),
  });

  const { error: updateError } = await supabase
    .from("planned_sessions")
    .update({
      effective_stress_load: out.effectiveStressLoad,
      session_modality: out.sessionModality,
    })
    .eq("id", p.id)
    .eq("user_id", sessionUserId);
  if (updateError) throw new Error(updateError.message);
}
