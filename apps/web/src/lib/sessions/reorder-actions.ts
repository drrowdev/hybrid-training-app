"use server";

/**
 * Per-session accessory reorder.
 *
 * Persists the user's drag/tap reorder of accessory cards in the active workout
 * as `sessions.custom_accessory_order` — an array of accessory movement ids in
 * the chosen sequence. The session UI applies it over the smart
 * equipment-station default (lib/sessions/accessory-order.ts). Display-only:
 * set logging still matches by prescription item index, so reordering can never
 * corrupt logged work.
 *
 * RLS-safe: user-scoped client + explicit `user_id` ownership filter, Zod
 * `.strict()` input. Best-effort revalidation of the session page so a reload
 * keeps the order.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient, getAuthUser } from "@/lib/supabase/server";

const reorderSchema = z
  .object({
    sessionId: z.string().uuid(),
    /** Accessory movement ids in the user's chosen order (≤ 60 — a session never has that many). */
    movementIds: z.array(z.string().uuid()).max(60),
  })
  .strict();

export type ReorderAccessoriesInput = {
  sessionId: string;
  movementIds: string[];
};

export async function reorderSessionAccessories(
  input: ReorderAccessoriesInput,
): Promise<{ ok?: true; error?: string }> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { error: "Not signed in." };

  // De-dupe defensively (a malformed client payload shouldn't persist repeats).
  const seen = new Set<string>();
  const order = parsed.data.movementIds.filter((id) =>
    seen.has(id) ? false : (seen.add(id), true),
  );

  const { error } = await supabase
    .from("sessions")
    .update({ custom_accessory_order: order })
    .eq("id", parsed.data.sessionId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  revalidatePath(`/app/sessions/${parsed.data.sessionId}`);
  return { ok: true };
}
