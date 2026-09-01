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
import { isMissingRpc } from "@/lib/supabase/rpc-errors";
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

  const { error } = await supabase.rpc("log_bodyweight_atomically", {
    p_date: input.date,
    p_bodyweight_kg: cols.bodyweight_kg,
    p_notes: null,
    p_replace_notes: false,
  });
  if (error && !isMissingRpc(error)) throw new Error(error.message);
  if (isMissingRpc(error)) {
    const { error: wellnessError } = await supabase
      .from("wellness")
      .upsert(
        { user_id: user.id, date: input.date, bodyweight_kg: cols.bodyweight_kg },
        { onConflict: "user_id,date" },
      );
    if (wellnessError) throw new Error(wellnessError.message);

    if (cols.bodyweight_kg != null) {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ bodyweight_kg: cols.bodyweight_kg })
        .eq("id", user.id);
      if (profileError) throw new Error(profileError.message);
    }
  }
}
