"use server";

/**
 * Server actions for the engine override audit log (DC-K4
 * "override-and-warn, never silent overrule").
 *
 * The three primary recording paths (skip, swap, manual end) call
 * `recordOverrideEvent` from their own action files — see
 * `lib/planner/actions.ts::skipPlannedSession`,
 * `lib/sessions/actions.ts::swapPrescriptionItem`, and
 * `lib/planner/actions.ts::endBlock`. This file holds the
 * future-proof entry point for any custom override surfaces.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  OVERRIDE_REASON_MAX,
  normaliseReason,
  recordOverrideEvent,
  type RecordOverrideInput,
} from "./overrides";

const customOverrideSchema = z.object({
  reason: z.string().max(OVERRIDE_REASON_MAX).optional(),
  /**
   * Free-form JSON-encoded engine context. The caller is responsible
   * for the shape — see `EngineOverrideContext` in `@hta/db`.
   */
  context: z.string().max(8000).optional(),
});

/**
 * Shell action for future override surfaces. No production callers
 * yet — exists so that any new "user overrode the engine" path has a
 * one-line wire-up to the audit log without re-implementing the
 * insert dance.
 */
export async function recordCustomOverride(formData: FormData): Promise<void> {
  const parsed = customOverrideSchema.safeParse({
    reason: (formData.get("reason") as string | null) ?? undefined,
    context: (formData.get("context") as string | null) ?? undefined,
  });
  if (!parsed.success) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  let context: RecordOverrideInput["context"] = null;
  if (parsed.data.context) {
    try {
      context = JSON.parse(parsed.data.context);
    } catch {
      context = null;
    }
  }

  await recordOverrideEvent(supabase, {
    userId: user.id,
    eventType: "custom",
    reason: normaliseReason(parsed.data.reason ?? null),
    context,
  });

  revalidatePath("/app/stats/engine");
}
