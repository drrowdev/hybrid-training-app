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
import {
  removeMovementFromPrescription,
  swapMovementInPrescription,
  addMovementToPrescription,
} from "./prescription-mutations";

export type PlannedEditResult = { ok?: true; error?: string; prescription?: Prescription };

async function loadPlannedForEdit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  plannedSessionId: string,
): Promise<{ prescription: Prescription; completedSessionId: string | null } | { error: string }> {
  const { data, error } = await supabase
    .from("planned_sessions")
    .select("id, user_id, prescription, completed_session_id")
    .eq("id", plannedSessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Planned session not found." };
  return {
    prescription: (data.prescription as Prescription | null) ?? { items: [] },
    completedSessionId: (data.completed_session_id as string | null) ?? null,
  };
}

async function persistPlannedPrescription(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  plannedSessionId: string,
  next: Prescription,
  completedSessionId: string | null,
): Promise<PlannedEditResult> {
  const { error } = await supabase
    .from("planned_sessions")
    .update({ prescription: next })
    .eq("id", plannedSessionId)
    .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath("/app");
  revalidatePath("/app/plan");
  if (completedSessionId) revalidatePath(`/app/sessions/${completedSessionId}`);
  return { ok: true, prescription: next };
}

const removeMovementSchema = z.object({
  plannedSessionId: z.string().uuid(),
  movementId: z.string().min(1),
});

export async function removePlannedMovement(formData: FormData): Promise<PlannedEditResult> {
  const parsed = removeMovementSchema.safeParse({
    plannedSessionId: formData.get("plannedSessionId"),
    movementId: formData.get("movementId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const loaded = await loadPlannedForEdit(supabase, user.id, parsed.data.plannedSessionId);
  if ("error" in loaded) return { error: loaded.error };

  const next = removeMovementFromPrescription(loaded.prescription, parsed.data.movementId);
  if ((next.items?.length ?? 0) === 0) {
    return { error: "A workout needs at least one movement." };
  }
  return persistPlannedPrescription(
    supabase,
    user.id,
    parsed.data.plannedSessionId,
    next,
    loaded.completedSessionId,
  );
}

const swapMovementSchema = z.object({
  plannedSessionId: z.string().uuid(),
  movementId: z.string().min(1),
  newMovementId: z.string().uuid(),
});

export async function swapPlannedMovement(formData: FormData): Promise<PlannedEditResult> {
  const parsed = swapMovementSchema.safeParse({
    plannedSessionId: formData.get("plannedSessionId"),
    movementId: formData.get("movementId"),
    newMovementId: formData.get("newMovementId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  const [loaded, { data: newMov, error: mErr }] = await Promise.all([
    loadPlannedForEdit(supabase, user.id, parsed.data.plannedSessionId),
    supabase
      .from("movements")
      .select("id, slug, display_name")
      .eq("id", parsed.data.newMovementId)
      .maybeSingle(),
  ]);
  if ("error" in loaded) return { error: loaded.error };
  if (mErr) return { error: mErr.message };
  if (!newMov) return { error: "Replacement movement not found." };

  const next = swapMovementInPrescription(loaded.prescription, parsed.data.movementId, {
    id: newMov.id as string,
    slug: newMov.slug as string,
    displayName: newMov.display_name as string,
  });
  return persistPlannedPrescription(
    supabase,
    user.id,
    parsed.data.plannedSessionId,
    next,
    loaded.completedSessionId,
  );
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
