"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getDeloadSkipOffer } from "@/lib/planner/deload-skip-offer";
import type { Prescription } from "@hta/db";

export type AcceptDeloadSkipResult =
  | { ok: true; sessions: number }
  | { ok: false; error: string };

/**
 * ADR 0031 (Phase 2) — accept the deload skip.
 *
 * Re-derives eligibility server-side (never trusts the client), then converts
 * the deload week's UN-STARTED sessions into a normal loading week by copying
 * the block's wave-opener (the first loading week, weekIndex 0) prescription —
 * the engine's own already-materialised loading-week output for this exact
 * block / user / context — onto the matching (day_index, slot) sessions, with a
 * `deloadSkipped: true` idempotency marker. Started / skipped sessions are
 * immutable. No generator re-run, no migration.
 */
export async function acceptDeloadSkip(): Promise<AcceptDeloadSkipResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // Re-derive the offer from live state.
  const offer = await getDeloadSkipOffer();
  if (!offer) return { ok: false, error: "Deload skip is no longer available" };

  // The wave opener (first loading week) is the template loading week. Its
  // sessions share the deload week's (day_index, slot) shape because day
  // templates + movement resolution are per-block, not per-week.
  const { data: openerRows } = await supabase
    .from("planned_sessions")
    .select("day_index, slot, prescription, session_modality, effective_stress_load")
    .eq("user_id", user.id)
    .eq("block_id", offer.blockId)
    .eq("week_index", 0);
  type OpenerRow = {
    day_index: number;
    slot: string | null;
    prescription: Prescription;
    session_modality: string | null;
    effective_stress_load: number | string | null;
  };
  const openerByKey = new Map<string, OpenerRow>();
  for (const r of (openerRows ?? []) as OpenerRow[]) {
    openerByKey.set(`${r.day_index}:${r.slot ?? "single"}`, r);
  }
  if (openerByKey.size === 0) {
    return { ok: false, error: "Could not load a loading-week template" };
  }

  // The deload week's un-started, not-already-skipped sessions.
  const { data: deloadRows } = await supabase
    .from("planned_sessions")
    .select("id, day_index, slot, prescription")
    .eq("user_id", user.id)
    .eq("block_id", offer.blockId)
    .eq("week_index", offer.deloadWeekIndex)
    .is("completed_session_id", null)
    .is("skipped_at", null);

  type DeloadRow = {
    id: string;
    day_index: number;
    slot: string | null;
    prescription: Prescription;
  };

  let updated = 0;
  for (const r of (deloadRows ?? []) as DeloadRow[]) {
    if (r.prescription?.deloadSkipped === true) continue;
    const opener = openerByKey.get(`${r.day_index}:${r.slot ?? "single"}`);
    if (!opener) continue;
    const prescription: Prescription = { ...opener.prescription, deloadSkipped: true };
    const { error, count } = await supabase
      .from("planned_sessions")
      .update(
        {
          prescription,
          session_modality: opener.session_modality,
          effective_stress_load: opener.effective_stress_load,
        },
        { count: "exact" },
      )
      .eq("id", r.id)
      .eq("user_id", user.id)
      .eq("block_id", offer.blockId)
      .is("completed_session_id", null)
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
