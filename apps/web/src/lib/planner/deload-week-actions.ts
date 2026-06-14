"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getDeloadWeekPreview } from "./deload-week-preview";

export type InsertDeloadResult =
  | { ok: true; deloadWeekIndex: number; sessions: number }
  | { ok: false; error: string };

export type RemoveDeloadResult = { ok: true } | { ok: false; error: string };

const removeSchema = z.object({ weekIndex: z.number().int().min(0) }).strict();

function revalidateAll(): void {
  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/sessions");
  revalidatePath("/app/stats");
}

/**
 * Insert a standalone deload week after the user's current week (ADR 0049).
 *
 * Recomputes the deload week server-side from live state (never trusts a client
 * payload), then calls the atomic `insert_deload_week` RPC which renumbers later
 * weeks + inserts the recovery sessions (role='deload', off-program) + bumps the
 * block length. RLS-scoped via the request client; the RPC re-checks ownership.
 */
export async function insertDeloadWeekAction(): Promise<InsertDeloadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const preview = await getDeloadWeekPreview(supabase, user.id);
  if (!preview) return { ok: false, error: "No active block to deload." };

  const payload = preview.sessions.map((s) => ({
    day_index: s.dayIndex,
    slot: s.slot,
    title: s.title,
    session_modality: s.sessionModality,
    prescription: s.prescription,
  }));

  const { data, error } = await supabase.rpc("insert_deload_week", {
    p_block_id: preview.blockId,
    p_user_id: user.id,
    p_after_week: preview.afterWeek,
    p_sessions: payload,
  });
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return {
    ok: true,
    deloadWeekIndex: typeof data === "number" ? data : preview.deloadWeekIndex,
    sessions: payload.length,
  };
}

/**
 * Remove a previously-inserted deload week (ADR 0049) — reverses the insert
 * while the week is unlogged. Calls the atomic `remove_deload_week` RPC.
 */
export async function removeDeloadWeekAction(
  input: z.infer<typeof removeSchema>,
): Promise<RemoveDeloadResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: block } = await supabase
    .from("training_blocks")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!block) return { ok: false, error: "No active block." };

  const { error } = await supabase.rpc("remove_deload_week", {
    p_block_id: block.id,
    p_user_id: user.id,
    p_week_index: parsed.data.weekIndex,
  });
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return { ok: true };
}
