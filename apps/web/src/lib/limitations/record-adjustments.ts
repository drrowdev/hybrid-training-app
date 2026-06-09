"use server";

/**
 * Persist the movement swaps/drops the limitation engine applied (migration
 * 0101), so the user can see "what was changed around this injury" on the Today
 * card + injuries page. Best-effort: a tracking failure must never block the
 * actual prescription update.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import {
  deriveLimitationsContext,
  type LimitationsContext,
} from "@/lib/planner/limitations-context";
import { attributeLimitation, type AppliedAdjustment } from "./response";

type RawLimitationRow = {
  id: string;
  region: string | null;
  kind: string | null;
  resolved_at: string | null;
  affected_muscles: string[] | null;
  affected_movement_ids: string[] | null;
  allowed_movement_ids: string[] | null;
};

export async function recordLimitationAdjustments(args: {
  supabase: SupabaseClient;
  userId: string;
  blockId: string | null;
  applied: ReadonlyArray<AppliedAdjustment>;
  catalog: ReadonlyArray<CatalogMovement>;
}): Promise<void> {
  const { supabase, userId, blockId, applied, catalog } = args;
  if (applied.length === 0) return;

  try {
    // Per-limitation contexts (one per active row) for attribution.
    const { data: rows } = await supabase
      .from("limitations")
      .select(
        "id, region, kind, resolved_at, affected_muscles, affected_movement_ids, allowed_movement_ids",
      )
      .eq("user_id", userId)
      .is("resolved_at", null);
    const limitationContexts: Array<{ id: string; ctx: LimitationsContext }> = (
      (rows ?? []) as RawLimitationRow[]
    ).map((r) => ({ id: r.id, ctx: deriveLimitationsContext([r]) }));

    const byId = new Map(catalog.map((m) => [m.id, m]));

    const records = applied.map((a) => ({
      user_id: userId,
      limitation_id: attributeLimitation(
        byId.get(a.fromMovementId),
        a.fromMovementId,
        limitationContexts,
      ),
      block_id: blockId,
      session_id: a.sessionId,
      kind: a.kind,
      from_movement_id: a.fromMovementId,
      from_name: a.fromName,
      to_movement_id: a.toMovementId,
      to_name: a.toName,
    }));

    const { error } = await supabase
      .from("limitation_adjustments")
      .upsert(records, { onConflict: "session_id,from_movement_id" });
    if (error) {
      console.warn("[limitation-adjustments] upsert failed", error.message);
    }
  } catch (e) {
    console.warn("[limitation-adjustments] record failed", e);
  }
}
