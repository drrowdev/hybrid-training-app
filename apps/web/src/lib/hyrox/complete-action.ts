"use server";

/**
 * HYROX session-level completion (ADR 0050 step 7b).
 *
 * Completes a STRUCTURED HYROX session (run / erg / interval / circuit /
 * compromised / simulation) from one total time + one session RPE + confirmed
 * loaded-station weights. Strength HYROX sessions use the normal per-movement
 * logger and never reach here.
 *
 * Flow (mirrors logCardioSession's security posture — auth + explicit ownership
 * check + Zod .strict() + the user-scoped Supabase client, never service-role):
 *   1. Validate input; authenticate; assert the session belongs to the user.
 *   2. Resolve the session's program instance + engine ref → HYROX session id.
 *   3. Materialize the prescription into actual rows (pure core) and resolve the
 *      station slugs → catalog movement ids.
 *   4. Idempotently replace this session's materialized cardio/set rows.
 *   5. Stamp the session completed (time + RPE), then recompute load + region
 *      state and advance the program instance — exactly like every other
 *      completion. Freshness moves only now, post-completion.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isMissingRpc } from "@/lib/supabase/rpc-errors";
import { maybeCompleteBlock } from "@/lib/planner/completion";
import { recomputeAfterCompletedSessionMutation } from "@/lib/sessions/post-completion-recompute";
import type { Prescription } from "@hta/db";
import {
  hyroxSessionIdForRef,
  parseHyroxRef,
  stationBlocksForWeek,
  findStationAlternative,
  getHyroxSession,
  type HyroxInstance,
} from "@hta/hyrox";
import { readStationOverrides } from "./completion-view";
import {
  buildHyroxActualsById,
  type HrZones,
  type HyroxCompletionInput,
} from "./materialize-actuals";

const completeHyroxSchema = z
  .object({
    sessionId: z.string().uuid(),
    totalDurationSec: z.coerce.number().int().min(1).max(60 * 60 * 12),
    sessionRpe: z.coerce.number().min(1).max(10),
    /** JSON object of engine station key → kg. */
    confirmedWeights: z.record(z.string(), z.coerce.number().min(0).max(500)).optional(),
    notes: z.string().max(2000).optional(),
    avgHrBpm: z.coerce.number().int().min(20).max(260).optional(),
    /** JSON object of zone → seconds (from a linked cardio activity). */
    hrZones: z.record(z.string(), z.coerce.number().min(0)).optional(),
  })
  .strict();

export type CompleteHyroxInput = z.input<typeof completeHyroxSchema>;

async function replaceHyroxActuals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    sessionId: string;
    cardioLogs: Array<Record<string, unknown>>;
    setLogs: Array<Record<string, unknown>>;
    durationMin: number;
    sessionRpe: number;
    notes: string | null;
    completedAt: string | null;
  },
): Promise<string | null> {
  const { error } = await supabase.rpc("replace_hyrox_session_actuals", {
    p_session_id: args.sessionId,
    p_cardio_logs: args.cardioLogs,
    p_set_logs: args.setLogs,
    p_duration_min: args.durationMin,
    p_session_rpe: args.sessionRpe,
    p_notes: args.notes,
  });
  if (!isMissingRpc(error)) return error?.message ?? null;

  // This exists only for the app-first migration window. Once migration 0143
  // is live, the RPC above is the sole write path and is transactional.
  const { error: setDeleteError } = await supabase
    .from("set_logs")
    .delete()
    .eq("session_id", args.sessionId);
  if (setDeleteError) return setDeleteError.message;

  const { error: cardioDeleteError } = await supabase
    .from("cardio_logs")
    .delete()
    .eq("session_id", args.sessionId);
  if (cardioDeleteError) return cardioDeleteError.message;

  if (args.cardioLogs.length > 0) {
    const { error: cardioInsertError } = await supabase.from("cardio_logs").insert(
      args.cardioLogs.map((row) => ({ session_id: args.sessionId, ...row })),
    );
    if (cardioInsertError) return cardioInsertError.message;
  }
  if (args.setLogs.length > 0) {
    const { error: setInsertError } = await supabase.from("set_logs").insert(
      args.setLogs.map((row) => ({ session_id: args.sessionId, ...row })),
    );
    if (setInsertError) return setInsertError.message;
  }
  const { error: sessionUpdateError } = await supabase
    .from("sessions")
    .update({
      duration_min: args.durationMin,
      session_rpe: args.sessionRpe,
      notes: args.notes,
      completed_at: args.completedAt ?? new Date().toISOString(),
    })
    .eq("id", args.sessionId);
  return sessionUpdateError?.message ?? null;
}

export async function completeHyroxSession(
  raw: CompleteHyroxInput,
): Promise<{ ok?: true; error?: string }> {
  const parsed = completeHyroxSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { sessionId, totalDurationSec, sessionRpe, confirmedWeights, notes, avgHrBpm, hrZones } =
    parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  // Ownership — RLS also blocks, but a clean message beats a generic 401.
  const { data: session, error: sErr } = await supabase
    .from("sessions")
    .select("id, user_id, completed_at, prescription")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (sErr) return { error: sErr.message };
  if (!session) return { error: "Session not found." };
  if (session.user_id !== user.id) return { error: "Not your session." };

  // Resolve the planned session (engine ref + block) linked to this session.
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("block_id, prescription")
    .eq("completed_session_id", sessionId)
    .maybeSingle();
  const blockId = planned?.block_id as string | undefined;
  const programRef = (planned?.prescription as Prescription | null)?.programRef;

  // Quick HYROX (off-plan): no planned session / program instance. Complete it
  // directly — one cardio block (time + RPE) + stamp done. No engine
  // materialization or program progression (there's no program to advance).
  const quickFormat = (session.prescription as Prescription | null)?.meta?.hyroxQuickFormat;
  if ((!blockId || !programRef) && quickFormat) {
    const modality =
      quickFormat === "circuit"
        ? "other_cardio"
        : quickFormat === "erg"
          ? "row"
          : "run";
    const replaceError = await replaceHyroxActuals(supabase, {
      sessionId,
      cardioLogs: [
        {
          movement_id: null,
          block_index: 0,
          modality,
          duration_sec: totalDurationSec,
          rpe: sessionRpe,
          avg_hr_bpm: avgHrBpm ?? null,
          hr_zones: hrZones ?? null,
        },
      ],
      setLogs: [],
      durationMin: Math.round(totalDurationSec / 60),
      sessionRpe,
      notes: notes ?? null,
      completedAt: session.completed_at,
    });
    if (replaceError) return { error: replaceError };
    try {
      await recomputeAfterCompletedSessionMutation({
        supabase,
        sessionId,
        userId: user.id,
      });
    } catch (e) {
      console.error("recompute (quick hyrox) failed:", e);
    }
    revalidatePath("/app");
    revalidatePath(`/app/sessions/${sessionId}`);
    return { ok: true };
  }

  if (!blockId || !programRef) return { error: "This session isn't linked to a HYROX plan." };

  // Resolve the HYROX instance for the block and map the ref → session id.
  const { data: pi } = await supabase
    .from("program_instances")
    .select("program_id, instance")
    .eq("user_id", user.id)
    .eq("block_id", blockId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!pi || pi.program_id !== "hyrox") {
    return { error: "Not an active HYROX block." };
  }
  const hyroxSessionId = hyroxSessionIdForRef(pi.instance as HyroxInstance, programRef);
  if (!hyroxSessionId) {
    return { error: "Couldn't resolve the HYROX session for this day." };
  }

  // Materialize the prescription → actual rows (pure).
  const input: HyroxCompletionInput = {
    totalDurationSec,
    sessionRpe,
    ...(confirmedWeights ? { confirmedWeightsKg: confirmedWeights } : {}),
    ...(avgHrBpm != null ? { avgHrBpm } : {}),
    ...(hrZones ? { hrZones: hrZones as HrZones } : {}),
  };
  // Focused station rotation + paired blocks (ADR 0062 / 0063): materialize set rows
  // for the stations in this week's focused blocks (union of both couplets), not the
  // session's full static list. Per-session swaps (ADR 0064): a station swapped to an
  // unloaded option (erg / bodyweight) produces no set row (load is captured by sRPE).
  const week = parseHyroxRef(programRef)?.week ?? 1;
  const overrides = readStationOverrides(planned?.prescription as Prescription | null);
  const performedMovements = stationBlocksForWeek(
    hyroxSessionId,
    week,
    getHyroxSession(hyroxSessionId)?.movements ?? [],
  )
    .flatMap((b) => [...b.movements])
    .filter((k) => {
      const sub = overrides[k];
      return !sub || (findStationAlternative(k, sub)?.loaded ?? true);
    });
  const actuals = buildHyroxActualsById(hyroxSessionId, input, performedMovements);

  // Resolve station slugs → catalog movement ids (global seed movements).
  const slugs = [...new Set(actuals.setLogs.map((s) => s.slug))];
  const movementIdBySlug = new Map<string, string>();
  if (slugs.length > 0) {
    const { data: movs, error: mErr } = await supabase
      .from("movements")
      .select("id, slug")
      .in("slug", slugs)
      .is("user_id", null);
    if (mErr) return { error: mErr.message };
    for (const m of movs ?? []) movementIdBySlug.set(m.slug as string, m.id as string);
  }

  const cardioRows = actuals.cardioLogs.map((c) => ({
    movement_id: null,
    block_index: c.blockIndex,
    modality: c.modality,
    duration_sec: c.durationSec,
    rpe: c.rpe,
    avg_hr_bpm: c.avgHrBpm ?? null,
    hr_zones: c.hrZones ?? null,
  }));

  const setRows = actuals.setLogs
    .map((s) => {
      const movementId = movementIdBySlug.get(s.slug);
      if (!movementId) return null;
      return {
        movement_id: movementId,
        set_index: s.setIndex,
        set_kind: s.setKind,
        rpe: s.rpe,
        reps: s.reps ?? null,
        weight_kg: s.weightKg ?? null,
        distance_m: s.distanceM ?? null,
        duration_sec: null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const replaceError = await replaceHyroxActuals(supabase, {
    sessionId,
    cardioLogs: cardioRows,
    setLogs: setRows,
    durationMin: Math.round(totalDurationSec / 60),
    sessionRpe,
    notes: notes ?? null,
    completedAt: session.completed_at,
  });
  if (replaceError) return { error: replaceError };

  // Downstream refresh — best-effort, never blocks completion.
  try {
    await recomputeAfterCompletedSessionMutation({
      supabase,
      sessionId,
      userId: user.id,
    });
  } catch (e) {
    console.error("post-completion recompute (hyrox) failed:", e);
  }
  try {
    await maybeCompleteBlock(supabase, blockId);
    const { applyProgramProgression } = await import("@/lib/platform/progression");
    await applyProgramProgression({ supabase, userId: user.id, sessionId, blockId });
  } catch (e) {
    console.error("hyrox progression failed:", e);
  }

  revalidatePath("/app");
  revalidatePath(`/app/sessions/${sessionId}`);
  return { ok: true };
}
