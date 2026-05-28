/**
 * Profile-level limitations → planner filter context.
 *
 * The accessory picker, accessory-role floor, and power-emphasis primer
 * picker all accept `blockedRegions: Set<string>` + `tendinopathyActive:
 * boolean` filters. The intelligence has been in place since the engine
 * was wired up, but the production call sites in `actions.ts` were
 * passing `new Set()` / `false` ("wired in a follow-up pass"). This is
 * that follow-up pass.
 *
 * Read once per block-generation request. RLS scopes the query to the
 * caller — pass an authenticated client.
 *
 * ─── Mapping rules ─────────────────────────────────────────────────
 *
 *   blockedRegions
 *     Any row with `resolved_at IS NULL` AND `region IS NOT NULL` →
 *     `region` joins the set. Severity is NOT a gate: the user added
 *     the row deliberately; if they want less restriction they should
 *     resolve it. Matches the "set-and-forget" UX in
 *     /app/settings/limitations.
 *
 *   tendinopathyActive
 *     Any unresolved row whose `kind` matches /tendin/i. Catches
 *     "tendinopathy", "tendinitis", "tendinosis" (the standard suffix
 *     family). The settings UI's tendinopathy toggle writes a sentinel
 *     row with `kind = 'tendinopathy'`; free-form `kind` values like
 *     "Achilles tendinopathy" entered via the recovery/injuries page
 *     are also detected.
 *
 * No new CP-2 constants are introduced here — this module only
 * activates existing accessory-picker / power-emphasis logic.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type LimitationsContext = {
  blockedRegions: Set<string>;
  tendinopathyActive: boolean;
};

/** Exposed so the settings UI / tests can detect the same shape. */
export const TENDINOPATHY_PATTERN = /tendin/i;

type LimitationRow = {
  region: string | null;
  kind: string | null;
  resolved_at: string | null;
};

export function deriveLimitationsContext(
  rows: ReadonlyArray<LimitationRow>,
): LimitationsContext {
  const blockedRegions = new Set<string>();
  let tendinopathyActive = false;
  for (const r of rows) {
    if (r.resolved_at !== null) continue;
    if (r.region) blockedRegions.add(r.region);
    if (r.kind && TENDINOPATHY_PATTERN.test(r.kind)) tendinopathyActive = true;
  }
  return { blockedRegions, tendinopathyActive };
}

export async function readLimitationsContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<LimitationsContext> {
  const { data, error } = await supabase
    .from("limitations")
    .select("region, kind, resolved_at")
    .eq("user_id", userId)
    .is("resolved_at", null);

  // Fail open: an empty context is the safe-equivalent of "no
  // limitations declared", which matches today's hard-coded
  // behaviour. We log but do not throw — planner generation should
  // not abort on a transient read failure.
  if (error || !data) {
    if (error) {
      console.warn("[limitations-context] read failed", error.message);
    }
    return { blockedRegions: new Set(), tendinopathyActive: false };
  }

  return deriveLimitationsContext(data as LimitationRow[]);
}
