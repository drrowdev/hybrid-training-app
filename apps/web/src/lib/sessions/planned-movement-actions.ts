"use server";

/**
 * Movement-level edits to a PLANNED session's prescription, used by the plan
 * drawer's "Edit" mode. Unlike `swapPrescriptionItem` (single item by index),
 * these operate on a whole movement by id so multi-item movements (warm-ups +
 * working sets) move together. Per-instance: the edit applies to THIS planned
 * session only, never future weeks.
 *
 * Kept in a dedicated, lightweight server-action module (mirroring
 * `session-movement-actions.ts`) so the plan drawer client component can import
 * them directly without pulling the heavy `actions.ts` graph into the bundle.
 *
 * Shared guardrails: explicit auth + `user_id` ownership match (RLS, never the
 * service role). Each returns the new prescription so the client can repaint.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prescription } from "@hta/db";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isRehabItem } from "@hta/domain";
import { resolveWarmupPreference } from "@/lib/planner/warmups";
import {
  programIdFromJoinedBlock,
  warmupSchemeForProgram,
} from "@/lib/planner/program-warmup-scheme";
import {
  SWAP_NO_TRAINING_MAX_WARNING,
  SWAP_NO_WARMUP_ANCHOR_WARNING,
  getSwapWarmupAnchor,
  removeMovementFromPrescription,
  swapMovementInPrescription,
  addMovementToPrescription,
} from "./prescription-mutations";

export type PlannedEditResult = {
  ok?: true;
  error?: string;
  prescription?: Prescription;
  warning?: string;
};

async function loadPlannedForEdit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  plannedSessionId: string,
): Promise<
  | {
      prescription: Prescription;
      completedSessionId: string | null;
      programId: string | null;
    }
  | { error: string }
> {
  const { data, error } = await supabase
    .from("planned_sessions")
    .select(
      "id, user_id, prescription, completed_session_id, training_blocks!inner(program_id)",
    )
    .eq("id", plannedSessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Planned session not found." };
  return {
    prescription: (data.prescription as Prescription | null) ?? { items: [] },
    completedSessionId: (data.completed_session_id as string | null) ?? null,
    programId: programIdFromJoinedBlock(data),
  };
}

async function persistPlannedPrescription(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  plannedSessionId: string,
  next: Prescription,
  completedSessionId: string | null,
  requireUnstarted = false,
): Promise<PlannedEditResult> {
  const update = supabase
    .from("planned_sessions")
    .update({ prescription: next })
    .eq("id", plannedSessionId)
    .eq("user_id", userId);
  const guarded = requireUnstarted
    ? update.is("completed_session_id", null)
    : update;
  const { data, error } = await guarded.select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!data) {
    return {
      error: requireUnstarted
        ? "Movements can't be removed after a workout has started."
        : "Planned session not found.",
    };
  }
  revalidatePath("/app");
  revalidatePath("/app/plan");
  if (completedSessionId) revalidatePath(`/app/sessions/${completedSessionId}`);
  return { ok: true, prescription: next };
}

const removeMovementSchema = z.object({
  plannedSessionId: z.string().uuid(),
  movementId: z.string().min(1),
  rehab: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value == null ? undefined : value === "true")),
});

export async function removePlannedMovement(formData: FormData): Promise<PlannedEditResult> {
  const parsed = removeMovementSchema.safeParse({
    plannedSessionId: formData.get("plannedSessionId"),
    movementId: formData.get("movementId"),
    rehab: formData.get("rehab") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const loaded = await loadPlannedForEdit(supabase, user.id, parsed.data.plannedSessionId);
  if ("error" in loaded) return { error: loaded.error };
  if (loaded.completedSessionId) {
    return { error: "Movements can't be removed after a workout has started." };
  }

  const next = removeMovementFromPrescription(
    loaded.prescription,
    parsed.data.movementId,
    { rehab: parsed.data.rehab },
  );
  if ((next.items?.length ?? 0) === 0) {
    return { error: "A workout needs at least one movement." };
  }
  if (
    parsed.data.rehab === false &&
    next.items.every(
      (item) =>
        isRehabItem(item) || (item.kind ?? "").startsWith("cardio_"),
    )
  ) {
    return { error: "A strength workout needs at least one strength movement." };
  }
  return persistPlannedPrescription(
    supabase,
    user.id,
    parsed.data.plannedSessionId,
    next,
    loaded.completedSessionId,
    true,
  );
}

const swapMovementSchema = z.object({
  plannedSessionId: z.string().uuid(),
  movementId: z.string().min(1),
  newMovementId: z.string().uuid(),
  rehab: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value == null ? undefined : value === "true")),
});

export async function swapPlannedMovement(formData: FormData): Promise<PlannedEditResult> {
  const parsed = swapMovementSchema.safeParse({
    plannedSessionId: formData.get("plannedSessionId"),
    movementId: formData.get("movementId"),
    newMovementId: formData.get("newMovementId"),
    rehab: formData.get("rehab") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const [
    loaded,
    { data: newMov, error: mErr },
    { data: replacementTm, error: tmErr },
    { data: profile, error: profileErr },
  ] = await Promise.all([
    loadPlannedForEdit(supabase, user.id, parsed.data.plannedSessionId),
    supabase
      .from("movements")
      .select("id, slug, display_name")
      .eq("id", parsed.data.newMovementId)
      .maybeSingle(),
    supabase
      .from("training_maxes")
      .select("one_rm_kg, bw_node_id")
      .eq("user_id", user.id)
      .eq("movement_id", parsed.data.newMovementId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("warmup_scheme")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  if ("error" in loaded) return { error: loaded.error };
  if (mErr) return { error: mErr.message };
  if (tmErr) return { error: tmErr.message };
  if (profileErr) return { error: profileErr.message };
  if (!newMov) return { error: "Replacement movement not found." };

  const oneRm = Number(
    (replacementTm as { one_rm_kg?: number | string | null } | null)?.one_rm_kg,
  );
  const replacementHasTrainingMax = Number.isFinite(oneRm) && oneRm > 0;
  const isRehabSwap = parsed.data.rehab === true;
  const warmupAnchor = getSwapWarmupAnchor(
    loaded.prescription,
    parsed.data.movementId,
    { rehab: parsed.data.rehab },
  );
  const warning =
    isRehabSwap || !warmupAnchor.hasMain
      ? undefined
      : !replacementHasTrainingMax
        ? SWAP_NO_TRAINING_MAX_WARNING
        : warmupAnchor.topWorkingPercent == null
          ? SWAP_NO_WARMUP_ANCHOR_WARNING
          : undefined;
  // Rehab prescriptions are not TM-anchored; they still use the shared
  // movement rebuild, but don't need the strength-lift no-anchor warning.
  const rebuildContext = {
    // A block owned by a program that publishes its own warm-up ramp falls back
    // to THAT ramp — but only when the lifter has never configured a ladder.
    // An explicit choice wins, including "skip warm-ups".
    warmupScheme: warmupSchemeForProgram(
      loaded.programId,
      resolveWarmupPreference(
        (profile as { warmup_scheme?: unknown } | null)?.warmup_scheme,
      ),
    ),
    replacementHasTrainingMax: isRehabSwap || replacementHasTrainingMax,
    // A planned session that already has a completed_session_id is a workout
    // in progress: its `set_logs.prescription_item_index` values address items
    // by position, so the rebuild must not change `items.length`. Future
    // sessions have no logs and keep the canonical re-splice.
    preserveItemIndices: loaded.completedSessionId != null,
  };
  const next = swapMovementInPrescription(
    loaded.prescription,
    parsed.data.movementId,
    {
      id: newMov.id as string,
      slug: newMov.slug as string,
      displayName: newMov.display_name as string,
    },
    undefined,
    { rehab: parsed.data.rehab },
    rebuildContext,
  );
  const persisted = await persistPlannedPrescription(
    supabase,
    user.id,
    parsed.data.plannedSessionId,
    next,
    loaded.completedSessionId,
  );
  return warning ? { ...persisted, warning } : persisted;
}

const addMovementSchema = z.object({
  plannedSessionId: z.string().uuid(),
  movementId: z.string().uuid(),
});

export async function addPlannedMovement(formData: FormData): Promise<PlannedEditResult> {
  const parsed = addMovementSchema.safeParse({
    plannedSessionId: formData.get("plannedSessionId"),
    movementId: formData.get("movementId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const [loaded, { data: mov, error: mErr }] = await Promise.all([
    loadPlannedForEdit(supabase, user.id, parsed.data.plannedSessionId),
    supabase
      .from("movements")
      .select("id, slug, display_name")
      .eq("id", parsed.data.movementId)
      .maybeSingle(),
  ]);
  if ("error" in loaded) return { error: loaded.error };
  if (mErr) return { error: mErr.message };
  if (!mov) return { error: "Movement not found." };

  const next = addMovementToPrescription(loaded.prescription, {
    id: mov.id as string,
    slug: mov.slug as string,
    displayName: mov.display_name as string,
  });
  return persistPlannedPrescription(
    supabase,
    user.id,
    parsed.data.plannedSessionId,
    next,
    loaded.completedSessionId,
  );
}
