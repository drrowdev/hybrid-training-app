"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getEarlyDeloadRecommendation } from "@/lib/planner/early-deload-offer";
import type { Prescription } from "@hta/db";
import { isUnstartedLinkedSession } from "@/lib/sessions/linked-session-state";

export type AcceptEarlyDeloadResult =
  | { ok: true; sessions: number }
  | { ok: false; error: string };

/**
 * ADR 0032 (Phase 3) — accept the early deload.
 *
 * Re-derives the recommendation server-side, then converts the CURRENT week's
 * un-started sessions into a deload by copying the block's already-materialised
 * deload-week prescription (matched by day_index, slot) onto them, with an
 * `earlyDeload: true` marker. The inverse of the Phase 2 skip (which copies the
 * wave opener onto the deload week). The SCHEDULED deload remains as the fixed
 * fallback; if the user recovers by then, the Phase 2 offer lets them skip it,
 * so the two features compose to "move the deload earlier" without ever
 * removing a safety deload. No generator re-run, no migration.
 */
export async function acceptEarlyDeload(): Promise<AcceptEarlyDeloadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const reco = await getEarlyDeloadRecommendation();
  if (!reco) return { ok: false, error: "Early deload is no longer recommended" };

  // The scheduled deload week's sessions are the deload template.
  const { data: deloadRows } = await supabase
    .from("planned_sessions")
    .select("day_index, slot, prescription, session_modality, effective_stress_load")
    .eq("user_id", user.id)
    .eq("block_id", reco.blockId)
    .eq("week_index", reco.deloadWeekIndex);
  type TemplateRow = {
    day_index: number;
    slot: string | null;
    prescription: Prescription;
    session_modality: string | null;
    effective_stress_load: number | string | null;
  };
  const templateByKey = new Map<string, TemplateRow>();
  for (const r of (deloadRows ?? []) as TemplateRow[]) {
    templateByKey.set(`${r.day_index}:${r.slot ?? "single"}`, r);
  }
  if (templateByKey.size === 0) {
    return { ok: false, error: "Could not load a deload template" };
  }

  const { data: curRows } = await supabase
    .from("planned_sessions")
    .select(
      "id, day_index, slot, prescription, completed_session_id, sessions(deleted_at, completed_at)",
    )
    .eq("user_id", user.id)
    .eq("block_id", reco.blockId)
    .eq("week_index", reco.currentWeekIndex)
    .is("skipped_at", null);
  type CurRow = {
    id: string;
    day_index: number;
    slot: string | null;
    prescription: Prescription;
    completed_session_id: string | null;
    sessions:
      | { deleted_at: string | null; completed_at: string | null }
      | Array<{ deleted_at: string | null; completed_at: string | null }>
      | null;
  };

  let updated = 0;
  for (const r of ((curRows ?? []) as CurRow[]).filter((row) =>
    isUnstartedLinkedSession(row.completed_session_id, row.sessions),
  )) {
    if (r.prescription?.earlyDeload === true) continue;
    const tpl = templateByKey.get(`${r.day_index}:${r.slot ?? "single"}`);
    if (!tpl) continue;
    const prescription: Prescription = { ...tpl.prescription, earlyDeload: true };
    const updateBase = supabase
      .from("planned_sessions")
      .update(
        {
          prescription,
          session_modality: tpl.session_modality,
          effective_stress_load: tpl.effective_stress_load,
        },
        { count: "exact" },
      )
      .eq("id", r.id)
      .eq("user_id", user.id)
      .eq("block_id", reco.blockId);
    const guarded =
      r.completed_session_id != null
        ? updateBase.eq(
            "completed_session_id",
            r.completed_session_id,
          )
        : updateBase.is("completed_session_id", null);
    const { error, count } = await guarded
      .is("skipped_at", null);
    if (error) return { ok: false, error: error.message };
    updated += count ?? 0;
  }

  revalidatePath("/app");
  revalidatePath("/app/plan");
  revalidatePath("/app/sessions");
  revalidatePath("/app/stats");

  return { ok: true, sessions: updated };
}
