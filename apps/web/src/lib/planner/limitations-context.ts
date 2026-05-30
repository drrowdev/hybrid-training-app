/**
 * Profile-level limitations → planner filter context.
 *
 * The accessory picker, accessory-role floor, and power-emphasis primer
 * picker all accept a filter object describing which movements should
 * be dropped before ranking. The intelligence has been in place since
 * the engine was wired up; this module is the read-side wrapper that
 * turns active `limitations` rows into that filter object.
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
 *   blockedMuscles (PR `feat/limitations-v2-lifecycle`)
 *     Union of every active row's `affected_muscles` array. The picker
 *     uses this for a muscle-level drop: a movement loading any
 *     blocked muscle as primary OR secondary is filtered out (unless
 *     it's in `allowedMovementIds`). This catches "adductor strain"
 *     dropping back squats even though the row only flags muscles
 *     (no region).
 *
 *   allowedMovementIds (PR `feat/limitations-v2-lifecycle`)
 *     Union of every active row's `allowed_movement_ids` array — the
 *     user-asserted "I can still do this one without pain." Movements
 *     in this set bypass the muscle-level filter. Region filtering is
 *     unaffected (a knee-region block still drops the movement even
 *     if the user allow-listed it; the user shouldn't be flagging a
 *     region they can still work).
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
  /** Union of `affected_muscles` across active rows. */
  blockedMuscles: Set<string>;
  /**
   * Union of `affected_movement_ids` across active rows — the specific
   * movements the user flagged. ADR 0014: previously selected nowhere
   * (the column was captured but silently dropped); now wired through
   * so a per-movement flag drops that exact catalog id at both
   * generation and the mid-block limitation-response path. The
   * allow-list still wins (a movement in `allowedMovementIds` is kept).
   */
  blockedMovementIds: Set<string>;
  /** Union of `allowed_movement_ids` across active rows. */
  allowedMovementIds: Set<string>;
  tendinopathyActive: boolean;
};

/** An empty / no-op context — exported for callers that need a default. */
export const EMPTY_LIMITATIONS_CONTEXT: LimitationsContext = {
  blockedRegions: new Set(),
  blockedMuscles: new Set(),
  blockedMovementIds: new Set(),
  allowedMovementIds: new Set(),
  tendinopathyActive: false,
};

/** Exposed so the settings UI / tests can detect the same shape. */
export const TENDINOPATHY_PATTERN = /tendin/i;

type LimitationRow = {
  region: string | null;
  kind: string | null;
  resolved_at: string | null;
  affected_muscles?: string[] | null;
  affected_movement_ids?: string[] | null;
  allowed_movement_ids?: string[] | null;
};

export function deriveLimitationsContext(
  rows: ReadonlyArray<LimitationRow>,
): LimitationsContext {
  const blockedRegions = new Set<string>();
  const blockedMuscles = new Set<string>();
  const blockedMovementIds = new Set<string>();
  const allowedMovementIds = new Set<string>();
  let tendinopathyActive = false;
  for (const r of rows) {
    if (r.resolved_at !== null) continue;
    if (r.region) blockedRegions.add(r.region);
    if (r.kind && TENDINOPATHY_PATTERN.test(r.kind)) tendinopathyActive = true;
    for (const m of r.affected_muscles ?? []) blockedMuscles.add(m);
    for (const id of r.affected_movement_ids ?? []) blockedMovementIds.add(id);
    for (const id of r.allowed_movement_ids ?? []) allowedMovementIds.add(id);
  }
  return {
    blockedRegions,
    blockedMuscles,
    blockedMovementIds,
    allowedMovementIds,
    tendinopathyActive,
  };
}

export async function readLimitationsContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<LimitationsContext> {
  const { data, error } = await supabase
    .from("limitations")
    .select(
      "region, kind, resolved_at, affected_muscles, affected_movement_ids, allowed_movement_ids",
    )
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
    return { ...EMPTY_LIMITATIONS_CONTEXT };
  }

  return deriveLimitationsContext(data as LimitationRow[]);
}
