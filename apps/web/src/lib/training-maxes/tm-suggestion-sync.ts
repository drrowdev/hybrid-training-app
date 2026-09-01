/**
 * Completed-session TM suggestion sync (plan §6.9).
 *
 * One home for create / update / drop of pending suggestions after completion
 * or a later set edit/delete. Callers pass the already-open Supabase client —
 * `after()` cannot mint a cookie-based one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { roundToPlate } from "@/lib/planner/archetypes";
import {
  evaluateTmSuggestion,
  pickAmrapTopSetsByMovement,
  planTmSuggestionReconcile,
  type AmrapSetCandidateInput,
  type DesiredTmSuggestion,
} from "./suggestions";

type SetLogRow = {
  id: string;
  movement_id: string;
  weight_kg: number | string | null;
  reps: number | null;
  rpe: number | string | null;
  set_kind: string | null;
  notes: string | null;
  skipped: boolean | null;
  prescribed: { isAmrap?: boolean } | null;
};

type SuggestionRow = {
  id: string;
  movement_id: string;
  derived_from_set_log_id: string | null;
  status: string;
  current_tm_kg: number | string | null;
  suggested_tm_kg: number | string;
  derived_formula: string | null;
  source: string;
};

function toCandidate(row: SetLogRow): AmrapSetCandidateInput {
  return {
    id: row.id,
    movementId: row.movement_id,
    setKind: row.set_kind,
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    reps: row.reps == null ? null : Number(row.reps),
    rpe: row.rpe == null ? null : Number(row.rpe),
    notes: row.notes,
    skipped: row.skipped,
    prescribed: row.prescribed ?? null,
  };
}

export async function syncTmSuggestionsForSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<string[]> {
  const { data: session } = await supabase
    .from("sessions")
    .select("id, user_id, completed_at")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!session || session.user_id !== userId || !session.completed_at) {
    return [];
  }

  const [{ data: setLogs }, { data: existingRows }] = await Promise.all([
    supabase
      .from("set_logs")
      .select(
        "id, movement_id, weight_kg, reps, rpe, set_kind, notes, skipped, prescribed",
      )
      .eq("session_id", sessionId),
    supabase
      .from("tm_suggestions")
      .select(
        "id, movement_id, derived_from_set_log_id, status, current_tm_kg, suggested_tm_kg, derived_formula, source",
      )
      .eq("user_id", userId)
      .eq("derived_from_session_id", sessionId),
  ]);

  const topByMovement = pickAmrapTopSetsByMovement(
    ((setLogs ?? []) as SetLogRow[]).map(toCandidate),
  );

  const desired: DesiredTmSuggestion[] = [];
  if (topByMovement.size > 0) {
    const movementIds = Array.from(topByMovement.keys());
    const [{ data: tms }, { data: profile }] = await Promise.all([
      supabase
        .from("training_maxes")
        .select("movement_id, one_rm_kg, tm_percent")
        .eq("user_id", userId)
        .in("movement_id", movementIds),
      supabase
        .from("profiles")
        .select("tm_percent_default")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    const defaultPct = Number(profile?.tm_percent_default ?? 90);
    const tmByMovement = new Map(
      (tms ?? []).map((t) => [
        t.movement_id as string,
        {
          oneRmKg: Number(t.one_rm_kg),
          tmPercent: t.tm_percent == null ? null : Number(t.tm_percent),
        },
      ]),
    );

    for (const [movementId, top] of topByMovement.entries()) {
      const current = tmByMovement.get(movementId);
      if (!current) continue;
      const effectivePct = current.tmPercent ?? defaultPct;
      const currentTmKg = roundToPlate((current.oneRmKg * effectivePct) / 100);
      const result = evaluateTmSuggestion({
        currentTmKg,
        amrapWeightKg: top.weightKg,
        amrapReps: top.reps,
        amrapRpe: top.rpe,
      });
      if (!result.suggest) continue;
      desired.push({
        movementId,
        setLogId: top.id,
        currentTmKg,
        suggestedTmKg: result.suggestedTmKg,
        source: result.formula === "rpe_zourdos" ? "derived_rpe" : "derived_amrap",
        derivedFormula: result.formula,
      });
    }
  }

  const plan = planTmSuggestionReconcile(
    desired,
    ((existingRows ?? []) as SuggestionRow[]).map((row) => ({
      id: row.id,
      movementId: row.movement_id,
      derivedFromSetLogId: row.derived_from_set_log_id,
      status: row.status,
      currentTmKg: row.current_tm_kg,
      suggestedTmKg: row.suggested_tm_kg,
      derivedFormula: row.derived_formula,
      source: row.source,
    })),
  );

  const created: string[] = [];

  if (plan.deletePendingIds.length > 0) {
    await supabase
      .from("tm_suggestions")
      .delete()
      .eq("user_id", userId)
      .eq("status", "pending")
      .in("id", plan.deletePendingIds);
  }

  for (const row of plan.updates) {
    await supabase
      .from("tm_suggestions")
      .update({
        current_tm_kg: row.currentTmKg,
        suggested_tm_kg: row.suggestedTmKg,
        source: row.source,
        derived_from_set_log_id: row.setLogId,
        derived_formula: row.derivedFormula,
      })
      .eq("id", row.id)
      .eq("user_id", userId)
      .eq("status", "pending");
  }

  for (const row of plan.inserts) {
    const { data: inserted, error } = await supabase
      .from("tm_suggestions")
      .insert({
        user_id: userId,
        movement_id: row.movementId,
        current_tm_kg: row.currentTmKg,
        suggested_tm_kg: row.suggestedTmKg,
        source: row.source,
        derived_from_session_id: sessionId,
        derived_from_set_log_id: row.setLogId,
        derived_formula: row.derivedFormula,
        status: "pending",
      })
      .select("id")
      .maybeSingle();
    if (!error && inserted?.id) created.push(inserted.id as string);
  }

  return created;
}
