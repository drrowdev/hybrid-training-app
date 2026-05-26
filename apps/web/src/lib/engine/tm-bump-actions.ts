"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { TmChangeReason } from "@hta/db";
import { createClient, getAuthUser } from "@/lib/supabase/server";

const acceptBumpSchema = z.object({
  movementId: z.string().uuid(),
  newTmKg: z.coerce.number().positive().lte(1000),
  reason: z.enum(["pr_detection", "amrap_bump", "block_complete", "deload", "manual"]),
  triggerKey: z.string().min(1).max(120).optional(),
  sessionId: z.string().uuid().optional(),
});

export type AcceptBumpResult = { ok: true } | { ok: false; error: string };

/**
 * Form-friendly wrapper: <form action> requires Promise<void> in Next 16.
 * Use acceptTmBumpAction (this) from form actions; acceptTmBumpResult
 * from callers that need the boolean outcome.
 */
export async function acceptTmBump(formData: FormData): Promise<void> {
  await acceptTmBumpResult(formData);
}

/**
 * Same logic, returns the result. Used by tests + programmatic callers.
 */
export async function acceptTmBumpResult(formData: FormData): Promise<AcceptBumpResult> {
  const parsed = acceptBumpSchema.safeParse({
    movementId: formData.get("movementId"),
    newTmKg: formData.get("newTmKg"),
    reason: formData.get("reason"),
    triggerKey: formData.get("triggerKey") || undefined,
    sessionId: formData.get("sessionId") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // Look up the user's current TM row for this movement so we can keep
  // tm_percent unchanged + record the prior 1RM as old_tm_kg.
  const { data: existingTm } = await supabase
    .from("training_maxes")
    .select("one_rm_kg, tm_percent")
    .eq("user_id", user.id)
    .eq("movement_id", parsed.data.movementId)
    .maybeSingle();

  // Reverse the conservative TM/1RM convention: if the user's TM is 90% of
  // their stored 1RM and we want their NEW TM to be `newTmKg`, then the
  // implied new stored 1RM is newTmKg / tmPct.
  const tmPct = existingTm?.tm_percent != null ? Number(existingTm.tm_percent) / 100 : 0.9;
  const safePct = tmPct > 0 && tmPct <= 1 ? tmPct : 0.9;
  const newOneRm = parsed.data.newTmKg / safePct;
  const oldOneRm = existingTm?.one_rm_kg != null ? Number(existingTm.one_rm_kg) : null;
  const oldTmKg = oldOneRm != null ? oldOneRm * safePct : null;

  // 1. Upsert the training_maxes row.
  const { error: tmErr } = await supabase
    .from("training_maxes")
    .upsert(
      {
        user_id: user.id,
        movement_id: parsed.data.movementId,
        one_rm_kg: newOneRm,
        tm_percent: existingTm?.tm_percent ?? 90,
      },
      { onConflict: "user_id,movement_id" },
    );
  if (tmErr) return { ok: false, error: `TM write failed: ${tmErr.message}` };

  // 2. Append to tm_history. Unique-violation on trigger_key = no-op.
  const { error: histErr } = await supabase.from("tm_history").insert({
    user_id: user.id,
    movement_id: parsed.data.movementId,
    old_tm_kg: oldTmKg,
    new_tm_kg: parsed.data.newTmKg,
    reason: parsed.data.reason as TmChangeReason,
    session_id: parsed.data.sessionId ?? null,
    trigger_key: parsed.data.triggerKey ?? null,
  });
  if (histErr && histErr.code !== "23505") {
    return { ok: false, error: `History write failed: ${histErr.message}` };
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/sessions");
  revalidatePath("/app/stats");
  return { ok: true };
}

const declineSchema = z.object({
  movementId: z.string().uuid(),
  triggerKey: z.string().min(1).max(120),
  sessionId: z.string().uuid().optional(),
});

/**
 * Decline a proposal. Writes a "noop" marker into tm_history with the
 * same trigger_key so the partial unique index suppresses repeats — the
 * card won't reappear on the same session.
 */
export async function declineTmBump(formData: FormData): Promise<void> {
  await declineTmBumpResult(formData);
}

export async function declineTmBumpResult(formData: FormData): Promise<AcceptBumpResult> {
  const parsed = declineSchema.safeParse({
    movementId: formData.get("movementId"),
    triggerKey: formData.get("triggerKey"),
    sessionId: formData.get("sessionId") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: existingTm } = await supabase
    .from("training_maxes")
    .select("one_rm_kg, tm_percent")
    .eq("user_id", user.id)
    .eq("movement_id", parsed.data.movementId)
    .maybeSingle();
  const tmPct = existingTm?.tm_percent != null ? Number(existingTm.tm_percent) / 100 : 0.9;
  const safePct = tmPct > 0 && tmPct <= 1 ? tmPct : 0.9;
  const currentTm = existingTm?.one_rm_kg != null ? Number(existingTm.one_rm_kg) * safePct : 0;

  // Use the manual reason — explicit user choice — and keep the trigger
  // key so the proposal can't re-fire from the same set.
  const { error: histErr } = await supabase.from("tm_history").insert({
    user_id: user.id,
    movement_id: parsed.data.movementId,
    old_tm_kg: currentTm,
    new_tm_kg: currentTm,
    reason: "manual" as TmChangeReason,
    session_id: parsed.data.sessionId ?? null,
    trigger_key: parsed.data.triggerKey,
  });
  if (histErr && histErr.code !== "23505") {
    return { ok: false, error: `Decline write failed: ${histErr.message}` };
  }

  revalidatePath("/app/sessions");
  return { ok: true };
}
