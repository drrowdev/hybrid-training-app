/**
 * Shared "does this session prescribe strength?" predicate, used by:
 *   - logCardioSession (operates on STARTED sessions
 *     with rows in `session_items`) — see PR #208 / #209
 *   - linkActivityToSession (operates on PLANNED sessions where
 *     the prescription lives as JSON on the planned_sessions row) — PR #211
 *
 * Both surfaces previously had their own implementation. PR #211 review
 * (review-211 #2) caught the drift: import-history's kind set included
 * `power_potentiation` and `accessory`/`warmup`/etc., while actions.ts
 * filtered strictly on `kind = "main"`. In practice every prescribed
 * strength session has a main lift, so the canonical narrow definition
 * (main only) is the right convergence — it matches prod behavior of
 * `logCardioSession` and is the strongest signal that strength work was
 * actually intended.
 *
 * If we ever generate sessions that prescribe accessories/power-only
 * without a main, both helpers need to expand together — keep them in
 * sync by editing only this file.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The single kind value that signals "this session has prescribed
 * strength work that the user is expected to log." Other kinds
 * (warmup, accessory, tendon, back_off, power_potentiation) are
 * ALWAYS accompanied by a `main` item in real sessions; gating on
 * `main` alone keeps the check tight without missing real cases.
 */
export const STRENGTH_MAIN_KIND = "main" as const;

/**
 * JSON-side check, used when the session hasn't started yet (planned
 * row only) so `session_items` is empty.
 */
export function prescriptionItemsHaveStrength(
  items: ReadonlyArray<{ kind?: string | null }> | null | undefined,
): boolean {
  if (!items) return false;
  return items.some((it) => it?.kind === STRENGTH_MAIN_KIND);
}

/**
 * DB-side check, used when the session has been started and
 * `session_items` is populated. RLS-scoped via the passed client.
 */
export async function sessionPrescribesStrength(
  supabase: Pick<SupabaseClient, "from">,
  sessionId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from("session_items")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("kind", STRENGTH_MAIN_KIND);
  return (count ?? 0) > 0;
}
