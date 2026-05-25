/**
 * Centralised helper for fetching the minimal profile shape needed by
 * `formatDate` / `formatTime`. Use this in every server component or
 * server action that renders a date/time to ensure the user's
 * `date_format` / `time_format` / `timezone` preferences propagate.
 *
 * Returns `null` when the user has no profile row (the formatters
 * accept null and fall back to the timezone-inferred or ISO default).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileForFormat } from "./datetime";

export async function getFormatProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileForFormat> {
  const { data } = await supabase
    .from("profiles")
    .select("timezone, time_format, date_format")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    timezone: data.timezone ?? null,
    time_format: data.time_format ?? null,
    date_format: data.date_format ?? null,
  };
}
