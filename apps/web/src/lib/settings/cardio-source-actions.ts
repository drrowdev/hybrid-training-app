"use server";

/**
 * Phase 1 "external cardio" — profile-level default.
 *
 * Persists the user's standing preference on
 * `profiles.preferred_cardio_source` (+ optional program name). The
 * BlockWizard reads this on step 3 to pre-check the "Follow an external
 * run program" toggle so the user doesn't have to re-pick it every block.
 * Changing this never touches existing `training_blocks` rows — they
 * keep whatever `cardio_source` they were created with.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";

const CARDIO_SOURCE_SCHEMA = z.object({
  preferredCardioSource: z.enum(["internal", "external"]),
  preferredCardioSourceName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

/**
 * FormData payload:
 *   preferredCardioSource = "internal" | "external"
 *   preferredCardioSourceName = optional free-text program name
 */
export async function updatePreferredCardioSource(
  formData: FormData,
): Promise<void> {
  const parsed = CARDIO_SOURCE_SCHEMA.safeParse({
    preferredCardioSource: formData.get("preferredCardioSource"),
    preferredCardioSourceName:
      formData.get("preferredCardioSourceName") ?? undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // When toggled to 'internal' the program name is meaningless — clear
  // it so a later flip back to 'external' starts fresh.
  const programName =
    parsed.data.preferredCardioSource === "external"
      ? parsed.data.preferredCardioSourceName
      : null;

  const { error } = await supabase
    .from("profiles")
    .update({
      preferred_cardio_source: parsed.data.preferredCardioSource,
      preferred_cardio_source_name: programName,
    })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/app/settings/training");
}
