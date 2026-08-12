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
import { swapMovementInPrescription } from "./prescription-mutations";

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
};

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
    .maybeSingle();
  if (sErr) return { error: sErr.message };
  if (!sessionRow) return { error: "Session not found." };

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
    },
  });

  // PERSIST the swap so it survives a reload AND the logger re-derives the new
  // movement's bodyweight capability (e.g. swapping a weighted sit-up for a GHD
  // sit-up makes the weight field optional). Forward-only: already-logged
  // set_logs keep the ORIGINAL movement_id — only the prescription's movement
  // identity changes, so future sets log against the new movement. The
  // prescription lives on the linked planned_session for a plan workout, or
  // directly on the session row for a quick/freestyle one.
  const newMovement = {
    id: next.id as string,
    slug: next.slug as string,
    displayName: next.display_name as string,
  };
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, prescription")
    .eq("completed_session_id", parsed.data.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (planned?.prescription) {
    const updated = swapMovementInPrescription(
      planned.prescription as Prescription,
      parsed.data.originalMovementId,
      newMovement,
      undefined,
      { rehab: parsed.data.rehab },
    );
    await supabase
      .from("planned_sessions")
      .update({ prescription: updated })
      .eq("id", planned.id as string)
      .eq("user_id", user.id);
  } else {
    const { data: sessionRx } = await supabase
      .from("sessions")
      .select("prescription")
      .eq("id", parsed.data.sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    const rx = (sessionRx as { prescription?: Prescription | null } | null)?.prescription;
    if (rx) {
      const updated = swapMovementInPrescription(
        rx,
        parsed.data.originalMovementId,
        newMovement,
        undefined,
        { rehab: parsed.data.rehab },
      );
      await supabase
        .from("sessions")
        .update({ prescription: updated })
        .eq("id", parsed.data.sessionId)
        .eq("user_id", user.id);
    }
  }

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  revalidatePath("/app");

  return {
    ok: true,
    newMovement,
  };
}
