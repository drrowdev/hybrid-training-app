"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { roundToPlate } from "./queries";
import { activeProgramTmPercent } from "./active-program-basis";
import { syncTmSuggestionsForSession } from "./tm-suggestion-sync";

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
  let tmPercent = existing?.tm_percent ?? null;
  if (tmPercent == null) {
    const { data: activeProgram, error: activeProgramError } = await supabase
      .from("program_instances")
      .select("program_family, instance")
      .eq("user_id", user.id)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();
    if (activeProgramError) {
      return { ok: false, error: activeProgramError.message };
    }
    tmPercent = activeProgramTmPercent(
      activeProgram?.program_family,
      activeProgram?.instance,
    );
  }

  // Manual upsert is always 'entered' — typing a value into the form is an
  // explicit user action. Any prior derived provenance is cleared so the row
  // stops claiming it came from an AMRAP.
  const { error } = await supabase.from("training_maxes").upsert(
    {
      user_id: user.id,
      movement_id: parsed.data.movementId,
      one_rm_kg: parsed.data.oneRmKg,
      tm_percent: tmPercent,
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

const moveSchema = z.object({
  fromMovementId: z.string().uuid(),
  toMovementId: z.string().uuid(),
});

/**
 * Switch which VARIANT a role's 1RM is attached to (e.g. Back Squat → Front
 * Squat) when the user changes the variant dropdown on the 1-rep-maxes page.
 *
 * Moves the stored 1RM (and the program-seeded tm_percent, for continuity) onto
 * the new movement and removes the old row, so a role keeps exactly one 1RM. If
 * the target variant already had a 1RM, it's overwritten — switching the
 * dropdown is an explicit "this is my squat now" action.
 */
export async function moveTrainingMaxVariant(formData: FormData): Promise<UpsertResult> {
  const parsed = moveSchema.safeParse({
    fromMovementId: formData.get("fromMovementId"),
    toMovementId: formData.get("toMovementId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (parsed.data.fromMovementId === parsed.data.toMovementId) return { ok: true };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: source, error: readErr } = await supabase
    .from("training_maxes")
    .select("one_rm_kg, tm_percent")
    .eq("user_id", user.id)
    .eq("movement_id", parsed.data.fromMovementId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!source) return { ok: false, error: "No 1RM to move." };

  const { error: upsertErr } = await supabase.from("training_maxes").upsert(
    {
      user_id: user.id,
      movement_id: parsed.data.toMovementId,
      one_rm_kg: source.one_rm_kg,
      tm_percent: source.tm_percent ?? null,
      source: "entered",
      derived_from_session_id: null,
      derived_from_set_log_id: null,
      derived_formula: null,
      derived_at: null,
    },
    { onConflict: "user_id,movement_id" },
  );
  if (upsertErr) return { ok: false, error: upsertErr.message };

  const { error: delErr } = await supabase
    .from("training_maxes")
    .delete()
    .eq("user_id", user.id)
    .eq("movement_id", parsed.data.fromMovementId);
  if (delErr) return { ok: false, error: delErr.message };

  revalidatePath("/app/settings/training-maxes");
  revalidatePath("/app");
  revalidatePath("/app/plan");
  return { ok: true };
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
 * Scan a completed session for AMRAP top sets that warrant a TM suggestion.
 * Idempotent: re-running never produces a duplicate pending row.
 */
export async function generateTmSuggestionsForSession(
  sessionId: string,
): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return [];
  const created = await syncTmSuggestionsForSession(supabase, user.id, sessionId);
  if (created.length > 0) revalidatePath("/app");
  return created;
}

