/**
 * Program progression — advance a platform program's instance after a session is
 * logged, and persist its program-owned recommendations.
 *
 * Called best-effort from `completeSessionResult`. For ARCHETYPE blocks (no
 * `program_instances` row) it is a no-op, so the legacy path is untouched. For a
 * platform block it:
 *   1. reads the engine instance + the completed session's engine `ref`
 *      (stored on `planned_sessions.prescription.programRef`),
 *   2. rebuilds the `LoggedSession` from `set_logs` (mapping each set's movement
 *      back to its engine key),
 *   3. calls `engine.onSessionLogged(instance, log, ctx)`,
 *   4. persists the (possibly advanced) instance back to `program_instances`, and
 *   5. inserts the returned recommendations into `program_recommendations`
 *      (dedup per block+kind) — EXCEPT plain `tm-bump`s, which the existing
 *      generic AMRAP→`tm_suggestions` banner already surfaces.
 *
 * User-scoped Supabase client only (RLS-enforced). Never throws — the caller
 * wraps it but this also self-guards so a progression hiccup never blocks a
 * session completion.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoggedSession, LoggedSet, ProgramRecommendation } from "@hta/program-core";
import type { Prescription } from "@hta/db";
import { getProgramEngine } from "./registry";
import { buildPlatformContext } from "./context";
import { engineKeyForSlug } from "./movement-keys";

type Db = Pick<SupabaseClient, "from">;

// tm-bump duplicates the generic AMRAP→tm_suggestions banner; the rest are the
// program-owned nudges that have no other home.
const SURFACED_KINDS = new Set<ProgramRecommendation["kind"]>([
  "tm-test",
  "tm-reset",
  "next-block",
  "deload",
  "info",
]);

export async function applyProgramProgression(args: {
  supabase: Db;
  userId: string;
  sessionId: string;
  blockId: string;
  performedAt?: string;
}): Promise<void> {
  const { supabase, userId, sessionId, blockId, performedAt } = args;

  // Active program instance for this block? If not, it's an archetype block.
  const { data: pi } = await supabase
    .from("program_instances")
    .select("id, program_id, instance")
    .eq("user_id", userId)
    .eq("block_id", blockId)
    .eq("status", "active")
    .maybeSingle();
  if (!pi) return;

  const engine = getProgramEngine(pi.program_id as string);
  if (!engine) return;

  // The engine ref lives on the completed planned session's prescription.
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("prescription")
    .eq("completed_session_id", sessionId)
    .maybeSingle();
  const programRef = (planned?.prescription as Prescription | null)?.programRef;
  if (!programRef) return;

  // Rebuild the logged sets, mapping movement → engine key.
  const { data: rawSets } = await supabase
    .from("set_logs")
    .select("weight_kg, reps, rpe, set_kind, notes, prescription_item_index, movement:movements(slug)")
    .eq("session_id", sessionId)
    .eq("skipped", false);

  const items = (planned?.prescription as Prescription | null)?.items ?? [];
  const sets: LoggedSet[] = [];
  for (const r of (rawSets ?? []) as unknown as RawSetRow[]) {
    const slug = r.movement?.slug;
    const key = slug ? engineKeyForSlug(slug) : undefined;
    const weightKg = r.weight_kg == null ? 0 : Number(r.weight_kg);
    const reps = r.reps == null ? 0 : Number(r.reps);
    if (reps <= 0) continue;
    const idx = r.prescription_item_index;
    const isAmrap =
      (typeof idx === "number" && items[idx]?.isAmrap === true) ||
      /amrap/i.test(r.notes ?? "");
    sets.push({
      ...(key ? { movement: key } : {}),
      weightKg,
      reps,
      ...(r.rpe == null ? {} : { rpe: Number(r.rpe) }),
      ...(isAmrap ? { isAmrap: true } : {}),
    });
  }
  if (sets.length === 0) return;

  const { ctx } = await buildPlatformContext(supabase, userId);
  const log: LoggedSession = {
    ref: programRef,
    performedAt: performedAt ?? new Date().toISOString(),
    sets,
  };

  const { instance: nextInstance, recommendations } = engine.onSessionLogged(
    pi.instance,
    log,
    ctx,
  );

  // Persist the advanced instance (no-op for stateless engines, but keeps the
  // contract honest for stateful ones).
  await supabase
    .from("program_instances")
    .update({ instance: nextInstance, updated_at: new Date().toISOString() })
    .eq("id", pi.id)
    .eq("user_id", userId);

  const toSurface = recommendations.filter((r) => SURFACED_KINDS.has(r.kind));
  if (toSurface.length === 0) return;

  // Dedup: don't re-insert a still-pending rec of the same kind for this block
  // (e.g. re-completing the block's last session shouldn't stack nudges).
  const { data: existing } = await supabase
    .from("program_recommendations")
    .select("kind")
    .eq("user_id", userId)
    .eq("block_id", blockId)
    .eq("status", "pending");
  const pendingKinds = new Set((existing ?? []).map((e) => e.kind as string));

  const rows = toSurface
    .filter((r) => !pendingKinds.has(r.kind))
    .map((r) => ({
      user_id: userId,
      program_instance_id: pi.id as string,
      block_id: blockId,
      session_id: sessionId,
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      data: r.data ?? null,
      status: "pending",
    }));
  if (rows.length > 0) {
    await supabase.from("program_recommendations").insert(rows);
  }
}

interface RawSetRow {
  weight_kg: string | number | null;
  reps: string | number | null;
  rpe: string | number | null;
  set_kind: string | null;
  notes: string | null;
  prescription_item_index: number | null;
  movement: { slug: string } | null;
}
