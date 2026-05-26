"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";

const dateTimeFormatSchema = z.object({
  timeFormat: z.enum(["12h", "24h"]).nullable(),
  dateFormat: z
    .enum(["iso", "dmy_long", "mdy_long", "dmy_short", "mdy_short"])
    .nullable(),
});

// Minimal IANA-zone shape check. Real validation is the user's runtime
// — `Intl.DateTimeFormat({timeZone})` would throw on bogus input — but
// for an opportunistic backfill on the server we just gate on the
// region/locality pattern. Examples accepted: "Europe/Helsinki",
// "America/New_York", "Asia/Hong_Kong". Rejected: "UTC", "GMT+2",
// "America" (no slash), random user-supplied strings.
const IANA_TIMEZONE_PATTERN = /^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/;

function looksLikeIanaTimezone(v: unknown): v is string {
  return typeof v === "string" && v.length <= 64 && IANA_TIMEZONE_PATTERN.test(v);
}

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
  } = await getAuthUser();
  if (!user) redirect("/login");

  // Opportunistically backfill `profiles.timezone` from the browser-
  // detected zone when the user has none on file. This makes the
  // auto-format resolver pick the right locale defaults across every
  // surface (not just the preview on this card). We never overwrite
  // a value the user already has — pick an explicit timezone in the
  // separate timezone control to change a live one.
  const rawDetectedTz = formData.get("detectedTimezone");
  const detectedTimezone = looksLikeIanaTimezone(rawDetectedTz) ? rawDetectedTz : null;

  let timezoneUpdate: string | null = null;
  if (detectedTimezone) {
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    const existing = existingProfile?.timezone;
    if (existing == null || (typeof existing === "string" && existing.trim() === "")) {
      timezoneUpdate = detectedTimezone;
    }
  }

  const update: Record<string, string | null> = {
    time_format: parsed.data.timeFormat,
    date_format: parsed.data.dateFormat,
  };
  if (timezoneUpdate != null) update.timezone = timezoneUpdate;

  const { error } = await supabase
    .from("profiles")
    .update(update)
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
