"use server";

/**
 * Mid-session movement swap.
 *
 * Records a DC-K4 override audit AND persists the swap onto the workout's
 * prescription (the linked planned_session for a plan workout, or the session
 * row for a quick/freestyle one) so it survives a reload and the logger
 * re-derives the new movement's bodyweight capability. Forward-only: sets
 * already logged against the original lift keep its movement_id; future sets log
 * against the new movement.
 *
 * Per DC-K4 ("override-and-warn, never silent overrule") the swap also lands a
 * row in `engine_override_events` with:
 *   - event_type = "swap"
 *   - original/new movement slugs + ids
 *   - reason (Pain / Equipment / Other) + optional freeform note
 *   - context.sessionId so the audit log can trace which session it
 *     was triggered from
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prescription } from "@hta/db";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { recordOverrideEvent } from "@/lib/engine/overrides";
import { resolveWarmupScheme } from "@/lib/planner/warmups";
import {
  programIdFromJoinedBlock,
  warmupSchemeForProgram,
} from "@/lib/planner/program-warmup-scheme";
import {
  SWAP_NO_TRAINING_MAX_WARNING,
  SWAP_NO_WARMUP_ANCHOR_WARNING,
  SWAP_REHAB_LOAD_CARRIED_WARNING,
  SWAP_WARMUPS_NOT_REBUILT_WARNING,
  getSwapWarmupAnchor,
  swapCarriesAbsoluteLoad,
  swapMovementInPrescription,
} from "./prescription-mutations";

const swapActiveSchema = z.object({
  sessionId: z.string().uuid(),
  originalMovementId: z.string().uuid(),
  newMovementId: z.string().uuid(),
  rehab: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value == null ? undefined : value === "true")),
  reason: z.enum(["pain", "equipment", "other"]),
  freeformReason: z.string().max(280).optional(),
});

export type SwapActiveResult = {
  ok?: true;
  error?: string;
  /** Returned so the client can repaint the active movement instantly. */
  newMovement?: { id: string; slug: string; displayName: string };
  /**
   * Non-blocking warning for a replacement with no load anchor. The swap is
   * still persisted, but stale absolute loads are removed and the user must
   * confirm a load before logging.
   */
  warning?: string;
};

async function loadSwapPrescriptionContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  movementId: string,
): Promise<
  | {
      warmupScheme: ReturnType<typeof resolveWarmupScheme>;
      replacementHasTrainingMax: boolean;
    }
  | { error: string }
> {
  const [{ data: tm, error: tmError }, { data: profile, error: profileError }] =
    await Promise.all([
      supabase
        .from("training_maxes")
        .select("one_rm_kg, bw_node_id")
        .eq("user_id", userId)
        .eq("movement_id", movementId)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("warmup_scheme")
        .eq("id", userId)
        .maybeSingle(),
    ]);
  if (tmError) return { error: tmError.message };
  if (profileError) return { error: profileError.message };
  const oneRm = Number((tm as { one_rm_kg?: number | string | null } | null)?.one_rm_kg);
  return {
    warmupScheme: resolveWarmupScheme(
      (profile as { warmup_scheme?: unknown } | null)?.warmup_scheme,
    ),
    // Bodyweight-node rows do not provide a kg anchor for a loaded warm-up
    // ladder, so they intentionally take the explicit no-anchor fallback.
    replacementHasTrainingMax: Number.isFinite(oneRm) && oneRm > 0,
  };
}

export async function swapActiveMovement(
  formData: FormData,
): Promise<SwapActiveResult> {
  const parsed = swapActiveSchema.safeParse({
    sessionId: formData.get("sessionId"),
    originalMovementId: formData.get("originalMovementId"),
    newMovementId: formData.get("newMovementId"),
    rehab: formData.get("rehab") ?? undefined,
    reason: formData.get("reason"),
    freeformReason:
      (formData.get("freeformReason") as string | null) ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  // Resolve both movements (slugs feed the audit row's
  // original_movement_slug / new_movement_slug columns).
  const [{ data: orig, error: oErr }, { data: next, error: nErr }] =
    await Promise.all([
      supabase
        .from("movements")
        .select("id, slug, display_name")
        .eq("id", parsed.data.originalMovementId)
        .maybeSingle(),
      supabase
        .from("movements")
        .select("id, slug, display_name")
        .eq("id", parsed.data.newMovementId)
        .maybeSingle(),
    ]);
  if (oErr) return { error: oErr.message };
  if (nErr) return { error: nErr.message };
  if (!orig) return { error: "Original movement not found." };
  if (!next) return { error: "Replacement movement not found." };

  // Confirm the session belongs to the user before writing audit.
  const { data: sessionRow, error: sErr } = await supabase
    .from("sessions")
    .select("id, user_id")
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (sErr) return { error: sErr.message };
  if (!sessionRow) return { error: "Session not found." };

  const swapContext = await loadSwapPrescriptionContext(
    supabase,
    user.id,
    parsed.data.newMovementId,
  );
  if ("error" in swapContext) return { error: swapContext.error };
  const isRehabSwap = parsed.data.rehab === true;

  const newMovement = {
    id: next.id as string,
    slug: next.slug as string,
    displayName: next.display_name as string,
  };
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, prescription, training_blocks!inner(program_id)")
    .eq("completed_session_id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  // A session materialised from a program that publishes its own warm-up ramp
  // (e.g. the fixed %-of-Training-Max ladder) must be rebuilt with THAT ramp,
  // not the user's global top-set ladder — otherwise a swap silently
  // re-anchors the program's warm-ups. Quick/freestyle workouts have no block
  // and keep the user's scheme.
  const warmupScheme = warmupSchemeForProgram(
    programIdFromJoinedBlock(planned),
    swapContext.warmupScheme,
  );
  // Rehab prescriptions are not TM-anchored. Keep the shared rebuild path,
  // but don't apply the strength-lift no-anchor fallback to them.
  //
  // `preserveItemIndices`: this action writes to a workout that is already
  // running, so `set_logs.prescription_item_index` (and the `client_log_id`
  // derived from it) may already address these items by position. The rebuild
  // must therefore rewrite warm-up slots in place and never change
  // `items.length`.
  const rebuildContext = {
    ...swapContext,
    warmupScheme,
    replacementHasTrainingMax: isRehabSwap
      ? true
      : swapContext.replacementHasTrainingMax,
    preserveItemIndices: true,
  };

  let sessionRx: Prescription | null = null;
  if (!planned?.prescription) {
    const { data: sessionPrescription } = await supabase
      .from("sessions")
      .select("prescription")
      .eq("id", parsed.data.sessionId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    sessionRx =
      (sessionPrescription as { prescription?: Prescription | null } | null)
        ?.prescription ?? null;
  }
  // A missing prescription is the quick/freestyle case: the workout has no
  // prescribed items at all (`createSession` / `startQuickStrengthSession`
  // insert a session row with a NULL prescription and the logger drives the
  // movement list from `session_movements`). There is no ladder to rebuild and
  // no %TM to re-anchor, so a load warning there would be a false alarm — the
  // swap is persisted against `session_movements` instead (below).
  const sourcePrescription = planned?.prescription
    ? (planned.prescription as Prescription)
    : sessionRx;
  const warmupAnchor = sourcePrescription
    ? getSwapWarmupAnchor(
        sourcePrescription,
        parsed.data.originalMovementId,
        { rehab: parsed.data.rehab },
      )
    : null;
  const warnings: string[] = [];
  if (sourcePrescription && warmupAnchor) {
    if (isRehabSwap) {
      // Rehab loads are hand-entered, not %TM-derived, so the swap carries
      // them across instead of clearing them. Say so (DC-K4).
      if (
        swapCarriesAbsoluteLoad(
          sourcePrescription,
          parsed.data.originalMovementId,
          { rehab: parsed.data.rehab },
        )
      ) {
        warnings.push(SWAP_REHAB_LOAD_CARRIED_WARNING);
      }
    } else if (warmupAnchor.hasMain || warmupAnchor.warmupSlotCount > 0) {
      if (!swapContext.replacementHasTrainingMax) {
        warnings.push(SWAP_NO_TRAINING_MAX_WARNING);
      } else if (warmupAnchor.topWorkingPercent == null) {
        warnings.push(SWAP_NO_WARMUP_ANCHOR_WARNING);
      }
      // Mid-workout the rebuild only rewrites warm-up slots that already
      // exist — adding slots would shift `set_logs.prescription_item_index`
      // for every later item.
      if (
        warmupAnchor.warmupSlotCount === 0 &&
        rebuildContext.warmupScheme.setCount > 0
      ) {
        warnings.push(SWAP_WARMUPS_NOT_REBUILT_WARNING);
      }
    }
  }
  const loadWarning = warnings.length > 0 ? warnings.join(" ") : undefined;

  await recordOverrideEvent(supabase, {
    userId: user.id,
    eventType: "swap",
    originalMovementSlug: (orig.slug as string) ?? null,
    newMovementSlug: (next.slug as string) ?? null,
    reason: parsed.data.freeformReason ?? null,
    context: {
      kind: "movement_swap",
      sessionId: parsed.data.sessionId,
      originalMovementId: parsed.data.originalMovementId,
      newMovementId: parsed.data.newMovementId,
      reasonCategory: parsed.data.reason,
      rehab: parsed.data.rehab ?? null,
      freeformReason: parsed.data.freeformReason ?? null,
      loadWarning: loadWarning ?? null,
      // Honest audit: a prescription-less quick/freestyle workout has no
      // prescription to rewrite — the swap is persisted against the
      // `session_movements` list instead.
      prescriptionUpdated: sourcePrescription != null,
    },
  });

  // PERSIST the swap so it survives a reload AND the logger re-derives the new
  // movement's bodyweight capability (e.g. swapping a weighted sit-up for a GHD
  // sit-up makes the weight field optional). Forward-only: already-logged
  // set_logs keep the ORIGINAL movement_id — only the prescription's movement
  // identity changes, so future sets log against the new movement. The
  // prescription lives on the linked planned_session for a plan workout, or
  // directly on the session row for a quick/freestyle one.
  if (planned?.prescription) {
    const updated = swapMovementInPrescription(
      planned.prescription as Prescription,
      parsed.data.originalMovementId,
      newMovement,
      undefined,
      { rehab: parsed.data.rehab },
      rebuildContext,
    );
    await supabase
      .from("planned_sessions")
      .update({ prescription: updated })
      .eq("id", planned.id as string)
      .eq("user_id", user.id);
  } else if (sessionRx) {
    const updated = swapMovementInPrescription(
      sessionRx,
      parsed.data.originalMovementId,
      newMovement,
      undefined,
      { rehab: parsed.data.rehab },
      rebuildContext,
    );
    await supabase
      .from("sessions")
      .update({ prescription: updated })
      .eq("id", parsed.data.sessionId)
      .eq("user_id", user.id)
      .is("deleted_at", null);
  } else {
    // Quick/freestyle workout: `session_movements` IS the persistence layer
    // for "which movements are in this session" (the page unions it with the
    // distinct set_logs movements). Persist the swap there, or the action
    // would report a swap that survives only until the next page load.
    //
    // Both RPCs are the same atomic ones the freestyle add/remove actions use:
    // the add computes MAX(sort_order)+10 and is idempotent, and the remove is
    // a `DELETE … WHERE NOT EXISTS (set_logs …)`, so a movement the user has
    // already logged against is kept (its logged work stays visible) instead of
    // being deleted from under them.
    const { error: addError } = await supabase.rpc("add_session_movement", {
      p_session_id: parsed.data.sessionId,
      p_movement_id: newMovement.id,
      p_user_id: user.id,
    });
    if (addError) return { error: addError.message };
    await supabase.rpc("remove_session_movement", {
      p_session_id: parsed.data.sessionId,
      p_movement_id: parsed.data.originalMovementId,
    });
  }

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  revalidatePath("/app");

  return {
    ok: true,
    newMovement,
    warning: loadWarning,
  };
}
