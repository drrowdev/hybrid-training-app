"use server";

/**
 * Server actions for the Phase 3 daily check-in surface.
 *
 * - `recordDailyCheckIn` — idempotent upsert of bodyweight / sleep /
 *   motivation / notes for `(user_id, today)`. Powers the Today-page
 *   bodyweight nudge and the pre-session sleep chip.
 *
 * - `dismissBodyweightNudge` — writes an empty (notes-only) row marker
 *   we don't actually need server-side; the dismissal is client-only
 *   today (localStorage). Kept as a thin shim so we can persist it
 *   server-side later without churning callers.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { todayYmd } from "@/lib/dates";
import {
  dailyCheckInSchema,
  dailyCheckInUpsertColumns,
  type DailyCheckInInput,
} from "./check-in";

export async function recordDailyCheckIn(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const submittedDate = (formData.get("date") as string | null) || null;
  // Fall back to the user's local "today" rather than UTC.
  const dateDefault = submittedDate ? null : todayYmd(await getUserTimezone());

  const parsed = dailyCheckInSchema.safeParse({
    date: submittedDate || dateDefault,
    bodyweightKg: formData.get("bodyweightKg") || undefined,
    sleepHours: formData.get("sleepHours") || undefined,
    sleepChip: formData.get("sleepChip") || undefined,
    motivation: formData.get("motivation") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await persistDailyCheckIn(parsed.data);

  revalidatePath("/app");
  revalidatePath("/app/settings");
  return { ok: true };
}

/**
 * Internal helper used by the form action above AND by the
 * pre-session check-in path (which already does its own RPC). Pulled
 * out so callers can compose the same upsert without going through a
 * FormData round-trip.
 */
export async function persistDailyCheckIn(
  input: DailyCheckInInput,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cols = dailyCheckInUpsertColumns(input);

  // Read current row so the upsert preserves columns the caller didn't
  // touch (e.g. logging bodyweight via the nudge must not clobber a
  // previously-recorded sleep_hours from the morning).
  const { data: existing } = await supabase
    .from("wellness")
    .select("bodyweight_kg, sleep_hours, motivation, notes")
    .eq("user_id", user.id)
    .eq("date", input.date)
    .maybeSingle();

  const merged = {
    user_id: user.id,
    date: input.date,
    bodyweight_kg:
      cols.bodyweight_kg !== undefined
        ? cols.bodyweight_kg
        : existing?.bodyweight_kg ?? null,
    sleep_hours:
      cols.sleep_hours !== undefined
        ? cols.sleep_hours
        : existing?.sleep_hours ?? null,
    motivation:
      cols.motivation !== undefined
        ? cols.motivation
        : existing?.motivation ?? null,
    notes: cols.notes !== undefined ? cols.notes : existing?.notes ?? null,
  };

  const { error } = await supabase
    .from("wellness")
    .upsert(merged, { onConflict: "user_id,date" });
  if (error) throw new Error(error.message);

  // Mirror bodyweight onto profiles so the rest of the app keeps
  // working off `profiles.bodyweight_kg` — same convention as the
  // existing settings::logBodyweight path.
  if (merged.bodyweight_kg != null) {
    await supabase
      .from("profiles")
      .update({ bodyweight_kg: merged.bodyweight_kg })
      .eq("id", user.id);
  }
}
