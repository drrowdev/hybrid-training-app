/**
 * Bodyweight trend — Stats overview card G.
 *
 * Reads the last ~30 days of `wellness.bodyweight_kg` rows. Returns
 * latest value, delta vs ~30 days ago (closest row to the 30-day-prior
 * mark), and a sparkline-friendly time series in oldest-first order.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd, todayYmd } from "@/lib/dates";

export type BodyweightPoint = { date: string; kg: number };

export type BodyweightTrend = {
  latest: BodyweightPoint | null;
  /** kg delta vs ~30 days ago. Null when we don't have enough data. */
  delta30dKg: number | null;
  /** Oldest-first series of last 30 days, ready for the sparkline. */
  series: BodyweightPoint[];
};

export async function getBodyweightTrend(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<BodyweightTrend> {
  const today = todayYmd(tz);
  const earliest = addDaysToYmd(today, -30);

  const { data, error } = await supabase
    .from("wellness")
    .select("date, bodyweight_kg")
    .eq("user_id", userId)
    .gte("date", earliest)
    .lte("date", today)
    .not("bodyweight_kg", "is", null)
    .order("date", { ascending: true });
  if (error) throw new Error(error.message);

  type Row = { date: string; bodyweight_kg: number | string | null };
  const rows = (data ?? []) as Row[];
  const series: BodyweightPoint[] = rows
    .filter((r) => r.bodyweight_kg != null)
    .map((r) => ({ date: r.date, kg: Number(r.bodyweight_kg) }));

  if (series.length === 0) {
    return { latest: null, delta30dKg: null, series: [] };
  }

  const latest = series[series.length - 1];
  // Find earliest row on or after the 30-day-ago anchor. If we have a
  // single data point we can't show a delta yet.
  const baseline = series[0];
  const delta30dKg = series.length >= 2 ? round1(latest.kg - baseline.kg) : null;

  return { latest, delta30dKg, series };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
