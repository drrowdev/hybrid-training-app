"use server";

/**
 * ADR 0017 — ranked cardio-modality preference.
 *
 * Persists the user's ordered list of preferred cardio modalities on
 * `profiles.preferred_cardio_modalities`. The block planner reads this at
 * creation time to substitute the default (running) cardio movement for a
 * same-intensity movement in the user's top feasible modality. Changing
 * this never touches existing `training_blocks` — blocks keep whatever
 * cardio movements they were baked with.
 *
 * RLS posture: user-scoped Supabase client, explicit ownership filter,
 * strict Zod validation, server-side sanitization (de-dupe + rank-preserve
 * + drop-unknown via the planner's single-source helper).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  PREFERRED_CARDIO_MODALITIES,
  sanitizePreferredModalities,
} from "@/lib/planner/preferred-cardio-modality";

const MODALITY_ENUM = z.enum(
  PREFERRED_CARDIO_MODALITIES as unknown as [string, ...string[]],
);

const SCHEMA = z
  .object({
    modalities: z.array(MODALITY_ENUM).max(8),
  })
  .strict();

/**
 * Parse the ranked modality list from FormData. The control posts a hidden
 * `modalities` field as a JSON array of canonical modality tokens, ordered
 * by preference. Falls back to an empty list (= default running path).
 */
function parseModalities(raw: FormDataEntryValue | null): unknown[] {
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * FormData payload:
 *   modalities = JSON array of canonical modality tokens, ranked
 *     (e.g. ["cycling","rowing"]). Empty / absent → clear the preference
 *     and fall back to the running default.
 */
export async function updatePreferredCardioModalities(
  formData: FormData,
): Promise<void> {
  const parsed = SCHEMA.safeParse({
    modalities: parseModalities(formData.get("modalities")),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  // Defence in depth: de-dupe, preserve rank, drop anything not in the
  // canonical vocabulary. Empty array is stored as NULL so existing rows
  // and the default path stay byte-identical.
  const sanitized = sanitizePreferredModalities(parsed.data.modalities);
  const value = sanitized.length > 0 ? sanitized : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ preferred_cardio_modalities: value })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/app/settings/training");
}
