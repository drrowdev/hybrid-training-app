/**
 * Sleep — last 7 nights for the Stats overview card E.
 *
 * Reads `wellness.sleep_hours` for the last 7 calendar days (user tz),
 * returns a 7-bucket fixed-length series (oldest → newest) with `null`
 * entries on days with no log, plus the simple average across the
 * non-null entries.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd, todayYmd } from "@/lib/dates";

export type SleepNight = { date: string; hours: number | null };

export type SleepTrend = {
  /** 7 nights oldest-first, length-fixed (null = no log that day). */
  nights: SleepNight[];
  /** Simple average across logged nights. Null when no logged nights. */
  avgHours: number | null;
  /** Number of nights with a logged value (0..7). */
  loggedCount: number;
};

export async function getSleep7d(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<SleepTrend> {
  const today = todayYmd(tz);
  const earliest = addDaysToYmd(today, -6);

  const { data, error } = await supabase
    .from("wellness")
    .select("date, sleep_hours")
    .eq("user_id", userId)
    .gte("date", earliest)
    .lte("date", today)
    .not("sleep_hours", "is", null);
  if (error) throw new Error(error.message);

  type Row = { date: string; sleep_hours: number | string | null };
  const byDate = new Map<string, number>();
  for (const r of (data ?? []) as Row[]) {
    if (r.sleep_hours == null) continue;
    byDate.set(r.date, Number(r.sleep_hours));
  }

  const nights: SleepNight[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDaysToYmd(today, -i);
    const hours = byDate.get(date);
    nights.push({ date, hours: hours ?? null });
  }
  const logged = nights.filter((n) => n.hours != null) as Array<{ date: string; hours: number }>;
  const avgHours =
    logged.length === 0
      ? null
      : Math.round((logged.reduce((a, n) => a + n.hours, 0) / logged.length) * 10) / 10;

  return { nights, avgHours, loggedCount: logged.length };
}
