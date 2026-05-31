"use server";

/**
 * Server actions for the daily bodyweight log.
 *
 * - `recordDailyCheckIn` — idempotent upsert of bodyweight for
 *   `(user_id, today)`. Powers the Today-page bodyweight nudge.
 *
 * The daily wellness check-in (motivation / fatigue / soreness / notes)
 * was retired — those columns remain on `wellness` for historical rows
 * and the data export, but no UI writes them. Sleep is likewise reserved
 * for the future health-app integration (Apple Health / Google Fit).
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

  const parsed = dailyCheckInSchema.safeParse({
    date: submittedDate || dateDefault,
    bodyweightKg: formData.get("bodyweightKg") || undefined,
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
  const cols = dailyCheckInUpsertColumns(input);
  // Nothing to persist if the caller supplied no bodyweight value.
  if (cols.bodyweight_kg === undefined) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // Merge-on-conflict upsert writes only `bodyweight_kg`, leaving the
  // retained legacy wellness columns (and any sleep_hours back-filled
  // later by the health integration) untouched.
  const { error } = await supabase
    .from("wellness")
    .upsert(
      { user_id: user.id, date: input.date, bodyweight_kg: cols.bodyweight_kg },
      { onConflict: "user_id,date" },
    );
  if (error) throw new Error(error.message);

  // Mirror bodyweight onto profiles so the rest of the app keeps
  // working off `profiles.bodyweight_kg` — same convention as the
  // existing settings::logBodyweight path.
  if (cols.bodyweight_kg != null) {
    await supabase
      .from("profiles")
      .update({ bodyweight_kg: cols.bodyweight_kg })
      .eq("id", user.id);
  }
}
