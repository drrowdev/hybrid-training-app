"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getDeloadWeekPreview, type DeloadWeekPreview } from "./deload-week-preview";
import {
  RECOVERY_PERCENT_MAX,
  RECOVERY_PERCENT_MIN,
} from "./recovery-week-bounds";
import { getUserTimezone } from "@/lib/planner/queries";

export type InsertDeloadResult =
  | { ok: true; deloadWeekIndex: number; sessions: number }
  | { ok: false; error: string };

export type RemoveDeloadResult = { ok: true } | { ok: false; error: string };

const removeSchema = z.object({ weekIndex: z.number().int().min(0) }).strict();

/**
 * The user's chosen working percentage. Bounded here as well as clamped in the
 * preview: the action is the trust boundary, and the value decides load.
 */
const percentSchema = z.number().int().min(RECOVERY_PERCENT_MIN).max(RECOVERY_PERCENT_MAX);

/** An engine-declared boundary key, e.g. "peak-b2". */
const boundaryKeySchema = z.string().min(1).max(64);

/** The recommendation that raised the advice. */
const recIdSchema = z.string().uuid();

function revalidateAll(): void {
  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/sessions");
  revalidatePath("/app/stats");
}

/**
 * Rebuild the preview at a different working percentage (ADR 0049).
 *
 * Read-only. The card calls this when the lifter moves the percentage so the
 * week they are shown is the week they will get.
 */
export async function previewDeloadWeekAction(
  percent?: number,
  boundaryKey?: string,
  recommendationId?: string,
): Promise<DeloadWeekPreview | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = percentSchema.safeParse(percent);
  const key = boundaryKeySchema.safeParse(boundaryKey);
  const recId = recIdSchema.safeParse(recommendationId);
  const timezone = await getUserTimezone(user.id);
  return getDeloadWeekPreview(supabase, user.id, {
    timezone,
    ...(parsed.success ? { percent: parsed.data } : {}),
    ...(key.success ? { boundaryKey: key.data } : {}),
    ...(recId.success ? { recommendationId: recId.data } : {}),
  });
}

/**
 * Insert a standalone deload week after the user's current week (ADR 0049).
 *
 * Recomputes the deload week server-side from live state (never trusts a client
 * payload), then calls the atomic `insert_deload_week` RPC which renumbers later
 * weeks + inserts the recovery sessions (role='deload', off-program) + bumps the
 * block length. RLS-scoped via the request client; the RPC re-checks ownership.
 *
 * `boundaryKey` places the week where the program advised instead of after
 * today's week. It is a key, not a week number: the client never says where to
 * insert, so a stale page cannot drop a light week into a hard one. It is only
 * honoured alongside the recommendation that raised it (ADR 0077).
 */
export async function insertDeloadWeekAction(
  percent?: number,
  boundaryKey?: string,
  recommendationId?: string,
): Promise<InsertDeloadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const parsedPercent = percentSchema.safeParse(percent);
  const parsedKey = boundaryKeySchema.safeParse(boundaryKey);
  const parsedRecId = recIdSchema.safeParse(recommendationId);
  const timezone = await getUserTimezone(user.id);
  const preview = await getDeloadWeekPreview(supabase, user.id, {
    timezone,
    ...(parsedPercent.success ? { percent: parsedPercent.data } : {}),
    ...(parsedKey.success ? { boundaryKey: parsedKey.data } : {}),
    ...(parsedRecId.success ? { recommendationId: parsedRecId.data } : {}),
  });
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
