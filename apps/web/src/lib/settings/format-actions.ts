"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const dateTimeFormatSchema = z.object({
  timeFormat: z.enum(["12h", "24h"]).nullable(),
  dateFormat: z
    .enum(["iso", "dmy_long", "mdy_long", "dmy_short", "mdy_short"])
    .nullable(),
});

/**
 * Server action for the "Time & date format" card on /app/settings.
 *
 * Accepts either an explicit format string per column or NULL, which
 * resets the column to "use the locale-inferred default" (see
 * `apps/web/src/lib/format/datetime.ts`). The CHECK constraints on
 * the underlying columns (migration 0041) are a second line of
 * defence against an unexpected value.
 */
export async function updateDateTimeFormat(formData: FormData): Promise<void> {
  const rawTime = formData.get("timeFormat");
  const rawDate = formData.get("dateFormat");

  const parsed = dateTimeFormatSchema.safeParse({
    timeFormat: rawTime === "" || rawTime === null || rawTime === "auto" ? null : rawTime,
    dateFormat: rawDate === "" || rawDate === null || rawDate === "auto" ? null : rawDate,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid format selection");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({
      time_format: parsed.data.timeFormat,
      date_format: parsed.data.dateFormat,
    })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  // Every surface that renders a date/time reads the profile, so
  // invalidate broadly. These are the highest-traffic ones.
  revalidatePath("/app");
  revalidatePath("/app/settings");
  revalidatePath("/app/plan");
  revalidatePath("/app/sessions");
  revalidatePath("/app/stats/prs");
  revalidatePath("/app/stats/movements");
}
