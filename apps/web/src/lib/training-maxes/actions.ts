"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { roundToPlate } from "./queries";
import { evaluateTmSuggestion } from "./suggestions";

const upsertSchema = z.object({
  movementId: z.string().uuid(),
  oneRmKg: z.coerce.number().positive().lte(1000),
});

export type UpsertResult = { ok: true } | { ok: false; error: string };

export async function upsertTrainingMax(formData: FormData): Promise<UpsertResult> {
  const parsed = upsertSchema.safeParse({
    movementId: formData.get("movementId"),
    oneRmKg: formData.get("oneRmKg"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // The loading basis (tm_percent) is owned by the active PROGRAM — it's seeded
  // on deploy (5/3/1 / TB / Hybrid), not edited here. So preserve whatever the
  // program already set rather than clobbering it when the user edits a 1RM.
  const { data: existing } = await supabase
    .from("training_maxes")
    .select("tm_percent")
    .eq("user_id", user.id)
    .eq("movement_id", parsed.data.movementId)
    .maybeSingle();

  // Manual upsert is always 'entered' — typing a value into the form is an
  // explicit user action. Any prior derived provenance is cleared so the row
  // stops claiming it came from an AMRAP.
  const { error } = await supabase.from("training_maxes").upsert(
    {
      user_id: user.id,
      movement_id: parsed.data.movementId,
      one_rm_kg: parsed.data.oneRmKg,
      tm_percent: existing?.tm_percent ?? null,
      source: "entered",
      derived_from_session_id: null,
      derived_from_set_log_id: null,
      derived_formula: null,
      derived_at: null,
    },
    { onConflict: "user_id,movement_id" },
  );
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/app/settings/training-maxes");
  revalidatePath("/app");
  revalidatePath("/app/plan");
  return { ok: true };
}

export async function deleteTrainingMax(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("training_maxes").delete().eq("id", id);
  revalidatePath("/app/settings/training-maxes");
}

/**
 * Lock a derived TM as an entered 1RM. Clears the provenance columns so the
 * row reads as the user's deliberate value going forward. Does not change
 * the numeric one_rm_kg — the user owns that number once they lock.
 */
export async function lockTrainingMaxAsEntered(formData: FormData): Promise<UpsertResult> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing id" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");
  const { error } = await supabase
    .from("training_maxes")
    .update({
      source: "entered",
      derived_from_session_id: null,
      derived_from_set_log_id: null,
      derived_formula: null,
      derived_at: null,
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/settings/training-maxes");
  revalidatePath("/app");
  return { ok: true };
}

// ── TM suggestions ────────────────────────────────────────────────────────

const suggestionDecisionSchema = z.object({
  suggestionId: z.string().uuid(),
});

export async function acceptTmSuggestion(formData: FormData): Promise<UpsertResult> {
  const parsed = suggestionDecisionSchema.safeParse({
    suggestionId: formData.get("suggestionId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: suggestion, error: readErr } = await supabase
    .from("tm_suggestions")
    .select("*")
    .eq("id", parsed.data.suggestionId)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!suggestion) return { ok: false, error: "Suggestion not found" };

  // Derive a 1RM from the suggested TM: the user's effective TM% governs the
  // mapping. Read the override first; fall back to profile default.
  const [{ data: existingTm }, { data: profile }] = await Promise.all([
    supabase
      .from("training_maxes")
      .select("id, tm_percent")
      .eq("user_id", user.id)
      .eq("movement_id", suggestion.movement_id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("tm_percent_default")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const overridePct =
    existingTm?.tm_percent == null ? null : Number(existingTm.tm_percent);
  const defaultPct = Number(profile?.tm_percent_default ?? 90);
  const effectivePct = overridePct ?? defaultPct;
  const newOneRmKg = roundToPlate(
    (Number(suggestion.suggested_tm_kg) * 100) / effectivePct,
  );

  const { error: upsertErr } = await supabase.from("training_maxes").upsert(
    {
      user_id: user.id,
      movement_id: suggestion.movement_id,
      one_rm_kg: newOneRmKg,
      tm_percent: overridePct,
      source: suggestion.source,
      derived_from_session_id: suggestion.derived_from_session_id,
      derived_from_set_log_id: suggestion.derived_from_set_log_id,
      derived_formula: suggestion.derived_formula,
      derived_at: new Date().toISOString(),
    },
    { onConflict: "user_id,movement_id" },
  );
  if (upsertErr) return { ok: false, error: upsertErr.message };

  await supabase
    .from("tm_suggestions")
    .update({ status: "accepted", resolved_at: new Date().toISOString() })
    .eq("id", suggestion.id);

  // Audit the bump in tm_history.
  await supabase.from("tm_history").insert({
    user_id: user.id,
    movement_id: suggestion.movement_id,
    old_tm_kg: suggestion.current_tm_kg,
    new_tm_kg: suggestion.suggested_tm_kg,
    reason: "amrap_bump",
    session_id: suggestion.derived_from_session_id,
    trigger_key: `suggestion:${suggestion.id}`,
  });

  revalidatePath("/app");
  revalidatePath("/app/settings/training-maxes");
  revalidatePath("/app/plan");
  return { ok: true };
}

export async function dismissTmSuggestion(formData: FormData): Promise<UpsertResult> {
  const parsed = suggestionDecisionSchema.safeParse({
    suggestionId: formData.get("suggestionId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("tm_suggestions")
    .update({ status: "dismissed", resolved_at: new Date().toISOString() })
    .eq("id", parsed.data.suggestionId)
    .eq("user_id", user.id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  return { ok: true };
}

/**
 * Scan a freshly-completed session for AMRAP top sets that warrant a TM
 * suggestion. Idempotent: re-running for the same session never produces a
 * duplicate pending row (partial unique index on derived_from_set_log_id).
 *
 * Returns the suggestion ids created so the caller can surface telemetry.
 */
export async function generateTmSuggestionsForSession(
  sessionId: string,
): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return [];

  const { data: session } = await supabase
    .from("sessions")
    .select("id, user_id, completed_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== user.id || !session.completed_at) return [];

  // AMRAP top sets in this codebase = main-kind set with reps logged at or
  // above 5 and an explicit "top set"-ish marker. We use a heuristic: look
  // at the heaviest main set per movement in the session that carries an RPE
  // or notes hint of AMRAP. This stays methodology-pure (no program names).
  const { data: setLogs } = await supabase
    .from("set_logs")
    .select("id, movement_id, weight_kg, reps, rpe, set_kind, notes")
    .eq("session_id", sessionId);
  if (!setLogs || setLogs.length === 0) return [];

  // Pick the heaviest "main" set per movement that has reps ≥ 1 and a weight.
  const topByMovement = new Map<
    string,
    { id: string; weightKg: number; reps: number; rpe: number | null }
  >();
  for (const s of setLogs) {
    if (s.set_kind !== "main" && s.set_kind !== "back_off") continue;
    const w = s.weight_kg == null ? null : Number(s.weight_kg);
    const r = s.reps == null ? null : Number(s.reps);
    if (w == null || r == null || w <= 0 || r < 1) continue;
    const isAmrap = (s.notes ?? "").toLowerCase().includes("amrap") || r >= 5;
    if (!isAmrap) continue;
    const prev = topByMovement.get(s.movement_id);
    if (!prev || w > prev.weightKg) {
      topByMovement.set(s.movement_id, {
        id: s.id,
        weightKg: w,
        reps: r,
        rpe: s.rpe == null ? null : Number(s.rpe),
      });
    }
  }
  if (topByMovement.size === 0) return [];

  const movementIds = Array.from(topByMovement.keys());
  const { data: tms } = await supabase
    .from("training_maxes")
    .select("movement_id, one_rm_kg, tm_percent")
    .eq("user_id", user.id)
    .in("movement_id", movementIds);
  const tmByMovement = new Map(
    (tms ?? []).map((t) => [
      t.movement_id,
      {
        oneRmKg: Number(t.one_rm_kg),
        tmPercent: t.tm_percent == null ? null : Number(t.tm_percent),
      },
    ]),
  );

  const { data: profile } = await supabase
    .from("profiles")
    .select("tm_percent_default")
    .eq("id", user.id)
    .maybeSingle();
  const defaultPct = Number(profile?.tm_percent_default ?? 90);

  const created: string[] = [];
  for (const [movementId, top] of topByMovement.entries()) {
    const current = tmByMovement.get(movementId);
    if (!current) continue; // no TM yet → don't auto-suggest, user should enter one
    const effectivePct = current.tmPercent ?? defaultPct;
    const currentTmKg = roundToPlate((current.oneRmKg * effectivePct) / 100);
    // The gate suppresses high-rep sets (> AMRAP_CONFIDENCE_REP_CAP) as
    // low-confidence, so a noisy 8-rep AMRAP no longer produces a TM banner —
    // TM changes should be infrequent + high-confidence. See suggestions.ts.
    const result = evaluateTmSuggestion({
      currentTmKg,
      amrapWeightKg: top.weightKg,
      amrapReps: top.reps,
      amrapRpe: top.rpe,
    });
    if (!result.suggest) continue;
    const source = result.formula === "rpe_zourdos" ? "derived_rpe" : "derived_amrap";

    // ON CONFLICT DO NOTHING via the partial unique index on
    // (user_id, movement_id, derived_from_set_log_id) WHERE status='pending'.
    // PostgREST doesn't expose that directly, so we look it up first.
    const { data: existing } = await supabase
      .from("tm_suggestions")
      .select("id")
      .eq("user_id", user.id)
      .eq("movement_id", movementId)
      .eq("derived_from_set_log_id", top.id)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) continue;

    const { data: inserted, error } = await supabase
      .from("tm_suggestions")
      .insert({
        user_id: user.id,
        movement_id: movementId,
        current_tm_kg: currentTmKg,
        suggested_tm_kg: result.suggestedTmKg,
        source,
        derived_from_session_id: sessionId,
        derived_from_set_log_id: top.id,
        derived_formula: result.formula,
        status: "pending",
      })
      .select("id")
      .maybeSingle();
    if (!error && inserted?.id) created.push(inserted.id);
  }

  if (created.length > 0) {
    revalidatePath("/app");
  }
  return created;
}


