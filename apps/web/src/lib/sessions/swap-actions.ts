"use server";

/**
 * Mid-session movement swap audit-action.
 *
 * Unlike `swapPrescriptionItem` (which mutates the planned_session's
 * prescription JSONB), this action is fire-and-forget audit only — the
 * client owns the in-session "active movement" state, and sets that
 * have already been logged against the original lift stay attributed
 * to it. Going forward, the logger writes future sets against the new
 * movement's id.
 *
 * Per DC-K4 ("override-and-warn, never silent overrule") the swap
 * lands a row in `engine_override_events` with:
 *   - event_type = "swap"
 *   - original/new movement slugs + ids
 *   - reason (Pain / Equipment / Other) + optional freeform note
 *   - context.sessionId so the audit log can trace which session it
 *     was triggered from
 */
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { recordOverrideEvent } from "@/lib/engine/overrides";

const swapActiveSchema = z.object({
  sessionId: z.string().uuid(),
  originalMovementId: z.string().uuid(),
  newMovementId: z.string().uuid(),
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
      freeformReason: parsed.data.freeformReason ?? null,
    },
  });

  return {
    ok: true,
    newMovement: {
      id: next.id as string,
      slug: next.slug as string,
      displayName: next.display_name as string,
    },
  };
}
