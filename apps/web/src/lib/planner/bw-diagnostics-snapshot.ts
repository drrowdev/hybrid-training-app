/**
 * Persist a diagnostics snapshot row.
 *
 * Wraps the diagnostics loader + a paired INSERT/DELETE so that the
 * 100-snapshot-per-user retention cap is enforced in the same write
 * path. Designed to be called from two server-action edges:
 *
 *   1. `completeSession` (after `applyBwSessionCompletionSideEffects`)
 *   2. `createBlock` / `createCustomBlock` (after the block + planned
 *      sessions are inserted)
 *
 * Failures here MUST NOT block the caller — the snapshot table is
 * decorative (the live engine still recomputes on read). The caller
 * wraps in try/catch and console.errors any failure, mirroring the
 * Phase 4 / Phase 5 side-effect convention.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAndRunBwDiagnostics } from "./bw-diagnostics-loader";

type GenericSupabase = Pick<SupabaseClient, "from"> & SupabaseClient;

/** Hard cap on retained snapshots per user. See migration 0047. */
const RETENTION_CAP = 100;

export async function captureBwDiagnosticsSnapshot(args: {
  supabase: GenericSupabase;
  userId: string;
  now?: Date;
}): Promise<void> {
  const results = await loadAndRunBwDiagnostics({
    supabase: args.supabase,
    userId: args.userId,
    now: args.now,
  });

  const { error: insertErr } = await args.supabase
    .from("bw_diagnostics_snapshots")
    .insert({
      user_id: args.userId,
      snapshot: results,
    });
  if (insertErr) {
    // Surface to the server log; the caller's try/catch will see this
    // as a non-throwing call.
    console.error("captureBwDiagnosticsSnapshot insert failed:", insertErr);
    return;
  }

  // Retention: keep the latest RETENTION_CAP rows, drop everything
  // older. The composite descending index on (user_id, taken_at)
  // makes the "ids to keep" query cheap.
  const { data: keepers } = await args.supabase
    .from("bw_diagnostics_snapshots")
    .select("id")
    .eq("user_id", args.userId)
    .order("taken_at", { ascending: false })
    .limit(RETENTION_CAP);
  const keepIds = ((keepers ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (keepIds.length < RETENTION_CAP) return;

  await args.supabase
    .from("bw_diagnostics_snapshots")
    .delete()
    .eq("user_id", args.userId)
    .not("id", "in", `(${keepIds.map((id) => `"${id}"`).join(",")})`);
}
