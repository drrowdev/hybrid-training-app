"use server";

/**
 * Server actions for the daily check-in surface.
 *
 * - `recordDailyCheckIn` — idempotent upsert of bodyweight / motivation
 *   / notes for `(user_id, today)`. Powers the Today-page bodyweight
 *   nudge.
 *
 * Sleep is intentionally NOT collected by any manual path — `sleep_hours`
 * is reserved for the future health-app integration (Apple Health /
 * Google Fit). The column remains on `wellness` so the integration can
 * back-fill it; we just never write it from the UI.
 *
 * - `dismissBodyweightNudge` — writes an empty (notes-only) row marker
 *   we don't actually need server-side; the dismissal is client-only
 *   today (localStorage). Kept as a thin shim so we can persist it
 *   server-side later without churning callers.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
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

  // sleep* form fields are intentionally NOT read here — sleep is
  // deferred to the health-integration backlog. Any inbound sleep
  // field is silently ignored.
  const parsed = dailyCheckInSchema.safeParse({
    date: submittedDate || dateDefault,
    bodyweightKg: formData.get("bodyweightKg") || undefined,
    motivation: formData.get("motivation") || undefined,
    fatigue: formData.get("fatigue") || undefined,
    soreness: formData.get("soreness") || undefined,
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
 * Internal helper used by the form action above. Pulled out so callers
 * can compose the same upsert without going through a FormData
 * round-trip.
 */
export async function persistDailyCheckIn(
  input: DailyCheckInInput,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const cols = dailyCheckInUpsertColumns(input);

  // Read current row so the upsert preserves columns the caller didn't
  // touch (e.g. logging bodyweight via the nudge must not clobber an
  // existing motivation entry, or any sleep_hours back-filled later by
  // the health-integration).
  const { data: existing } = await supabase
    .from("wellness")
    .select("bodyweight_kg, motivation, fatigue, soreness, notes")
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
    motivation:
      cols.motivation !== undefined
        ? cols.motivation
        : existing?.motivation ?? null,
    fatigue:
      cols.fatigue !== undefined
        ? cols.fatigue
        : existing?.fatigue ?? null,
    soreness:
      cols.soreness !== undefined
        ? cols.soreness
        : existing?.soreness ?? null,
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
