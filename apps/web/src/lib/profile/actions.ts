"use server";

/**
 * Server actions carried over from the retired /app/profile page.
 *
 * `updateTrainingNotes` now backs the Training notes group on
 * /app/settings/profile; the bodyweight-nudge dismissals are called
 * from the Today and Plan pages. Identity, units and the two-a-day
 * windows all moved to `@/lib/settings/actions::updateProfile`.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function getUserOrRedirect(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

const trainingNotesSchema = z.object({
  trainingNotes: z.string().trim().max(4000).nullable(),
});

export async function updateTrainingNotes(
  formData: FormData,
): Promise<ActionResult> {
  const raw = formData.get("trainingNotes");
  const parsed = trainingNotesSchema.safeParse({
    trainingNotes: raw == null || raw === "" ? null : String(raw),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Notes too long" };
  }

  const { supabase, userId } = await getUserOrRedirect();
  const { error } = await supabase
    .from("profiles")
    .update({
      ai_notes: parsed.data.trainingNotes,
      // bump updated_at so the "Last updated" hint stays accurate.
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/settings/profile");
  return { ok: true };
}

// ─── Cross-device sync (PR Z1) ────────────────────────────────────
// User-meaningful state that previously lived only in localStorage.
// See `hybrid-sync-audit.md` §2a + §3 and migration 0055.

const isoTimestampSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid timestamp" });

/**
 * Snooze the Today-page bodyweight nudge until the given ISO timestamp.
 * Persists across devices via `profiles.bw_nudge_hidden_until`.
 */
export async function dismissBwNudge(
  snoozeUntil: string,
): Promise<ActionResult> {
  const parsed = isoTimestampSchema.safeParse(snoozeUntil);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid timestamp" };
  }

  const { supabase, userId } = await getUserOrRedirect();
  const iso = new Date(parsed.data).toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({ bw_nudge_hidden_until: iso })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/**
 * Permanently dismiss the bodyweight-only early-support banner.
 * Persists across devices via `profiles.bw_banner_dismissed_at`.
 */
export async function dismissBwBanner(): Promise<ActionResult> {
  const { supabase, userId } = await getUserOrRedirect();
  const { error } = await supabase
    .from("profiles")
    .update({ bw_banner_dismissed_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
