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
 * Best-effort: any failure logs to console and returns. The caller is
 * already done with its primary write — a recompute failure must
 * never propagate back to the user-facing action.
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
}): Promise<void> {
  const { supabase, sessionId } = args;
  const requireCompleted = args.requireCompleted ?? true;

  try {
    if (requireCompleted) {
      const { data: session } = await supabase
        .from("sessions")
        .select("id, completed_at")
        .eq("id", sessionId)
        .maybeSingle();
      const s = session as SessionRow | null;
      if (!s || !s.completed_at) return;
    }

    // Find the linked planned_session.
    const { data: planned } = await supabase
      .from("planned_sessions")
      .select("id, session_modality")
      .eq("completed_session_id", sessionId)
      .maybeSingle();
    const p = planned as PlannedRow | null;
    if (!p) return;

    const [{ data: setRows }, { data: cardioRows }] = await Promise.all([
      supabase
        .from("set_logs")
        .select("movement_id, set_kind, weight_kg, reps, rpe, skipped")
        .eq("session_id", sessionId),
      supabase
        .from("cardio_logs")
        .select("movement_id, modality, duration_sec, inferred_kind")
        .eq("session_id", sessionId),
    ]);

    const setLogs = (setRows ?? []) as SetLogDbRow[];
    const cardioLogs = (cardioRows ?? []) as CardioLogDbRow[];

    // Backward-compat guard: if the user has logged literally nothing
    // (no sets AND no cardio) leave the prescribed ESL alone. A
    // completed session with no logs is legitimately zero stress, but
    // we don't overwrite the prescribed stamp — that becomes the
    // engine's signal of "this slot was planned but unfulfilled" in
    // future adherence math.
    if (setLogs.length === 0 && cardioLogs.length === 0) return;

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

    await supabase
      .from("planned_sessions")
      .update({
        effective_stress_load: out.effectiveStressLoad,
        session_modality: out.sessionModality,
      })
      .eq("id", p.id);
  } catch (e) {
    console.error("recomputeActualSessionLoad failed:", e);
  }
}
