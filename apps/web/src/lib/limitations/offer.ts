/**
 * ADR 0014 — server glue for the mid-block limitation response.
 *
 * Loads the live inputs (active block's un-started sessions, the
 * limitations context, the movement catalog) and runs the pure
 * `buildLimitationResponse` core. Read-only and user-scoped; returns null
 * when there is nothing to offer (no active block, no limitations, or no
 * offending items remain).
 */
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { loadPickerCatalog } from "@/lib/planner/picker-catalog";
import { readLimitationsContext } from "@/lib/planner/limitations-context";
import { getActiveBlockRemainingSessions } from "@/lib/planner/remaining-sessions";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import {
  buildLimitationResponse,
  type LimitationResponsePlan,
} from "./response";

export type LimitationResponseOffer = LimitationResponsePlan & {
  blockId: string;
};

/**
 * The banner is a "review & adjust" call to action, so it only surfaces when
 * there is something ACTIONABLE — a swap or a drop. Warns alone (a main lift
 * that also loads the flagged area) are advisory and would otherwise keep the
 * banner up forever, since a main lift always loads the area and is never
 * auto-changed. Once the user has accepted/declined every swap & drop, the
 * offer goes away even though the warns persist.
 */
function hasOffending(plan: LimitationResponsePlan): boolean {
  return plan.swaps.length > 0 || plan.drops.length > 0;
}

export async function getLimitationResponseOffer(): Promise<LimitationResponseOffer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;

  const active = await getActiveBlockRemainingSessions(supabase, user.id);
  if (!active || active.remaining.length === 0) return null;

  const ctx = await readLimitationsContext(supabase, user.id);
  const hasLimits =
    ctx.blockedRegions.size > 0 ||
    ctx.blockedMuscles.size > 0 ||
    ctx.blockedMovementIds.size > 0;
  if (!hasLimits) return null;

  const catalog = await loadPickerCatalog(supabase);
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  const equipment = resolveEquipment(profile ?? null);
  const plan = buildLimitationResponse(active.remaining, catalog, ctx, equipment);
  if (!hasOffending(plan)) return null;

  return { ...plan, blockId: active.blockId };
}
