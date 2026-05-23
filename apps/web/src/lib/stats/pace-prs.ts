/**
 * Pace PRs — best per-distance time, current 12 months vs the previous 12.
 *
 * v1 simplification: we don't have per-activity splits, so we estimate
 * the time the user would hit a given canonical distance by scaling
 * their average pace over the full activity — only counting activities
 * whose distance is ≥ the target distance. Documented in the card
 * footnote as an approximation pending split ingestion.
 *
 * Canonical distances: 1 mile · 5K · 10K · half · full marathon.
 * Modality filter: `modality` contains "run" (covers `run`, `trail_run`
 * mapped via `mapping.ts` as `run`, etc.).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd, todayYmd } from "@/lib/dates";

export type Activity = {
  /** YYYY-MM-DD performed-at date. */
  date: string;
  modality: string;
  distanceKm: number;
  /** Average pace, seconds per km. Required for PR computation. */
  avgPaceSecPerKm: number | null;
  /** Optional Strava activity ID for the external link. */
  stravaActivityId: string | null;
};

export type TargetDistance = {
  key: "mile" | "5k" | "10k" | "half" | "marathon";
  label: string;
  km: number;
};

export const TARGET_DISTANCES: TargetDistance[] = [
  { key: "mile", label: "1 mile", km: 1.609344 },
  { key: "5k", label: "5K", km: 5 },
  { key: "10k", label: "10K", km: 10 },
  { key: "half", label: "Half marathon", km: 21.0975 },
  { key: "marathon", label: "Marathon", km: 42.195 },
];

export type PaceResult = {
  /** Estimated time at the target distance, in seconds. */
  timeSec: number;
  date: string;
  stravaActivityId: string | null;
};

/**
 * Find the best (lowest) estimated time at the target distance among
 * activities whose full distance ≥ target. Returns null when no
 * activity qualifies. Treats the activity's avg pace as constant across
 * the target distance — see the file header.
 */
export function findBestPace(
  activities: Activity[],
  targetKm: number,
): PaceResult | null {
  let best: PaceResult | null = null;
  for (const a of activities) {
    if (!a.modality.includes("run")) continue;
    if (a.distanceKm < targetKm) continue;
    if (a.avgPaceSecPerKm == null || !Number.isFinite(a.avgPaceSecPerKm)) continue;
    const timeSec = Math.round(a.avgPaceSecPerKm * targetKm);
    if (!best || timeSec < best.timeSec) {
      best = { timeSec, date: a.date, stravaActivityId: a.stravaActivityId };
    }
  }
  return best;
}

export type PrRow = {
  key: TargetDistance["key"];
  label: string;
  km: number;
  current: PaceResult | null;
  previous: PaceResult | null;
  /** seconds; positive = faster (improvement), negative = slower. Null when no comparison. */
  deltaSec: number | null;
};

/** Build the full PR table for the given activity list. */
export function computePrTable(
  activities: Activity[],
  today: string,
): PrRow[] {
  const oneYearAgo = addDaysToYmd(today, -365);
  const twoYearsAgo = addDaysToYmd(today, -730);
  const currentWindow = activities.filter((a) => a.date > oneYearAgo && a.date <= today);
  const previousWindow = activities.filter((a) => a.date > twoYearsAgo && a.date <= oneYearAgo);

  return TARGET_DISTANCES.map(({ key, label, km }) => {
    const current = findBestPace(currentWindow, km);
    const previous = findBestPace(previousWindow, km);
    const deltaSec =
      current && previous ? previous.timeSec - current.timeSec : null;
    return { key, label, km, current, previous, deltaSec };
  });
}

/** Format a duration in seconds as MM:SS or H:MM:SS. */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** Format a signed delta in seconds with arrow + sign. */
export function formatDelta(deltaSec: number | null): { text: string; tone: "success" | "danger" | "neutral" } {
  if (deltaSec == null) return { text: "—", tone: "neutral" };
  if (deltaSec === 0) return { text: "±0s", tone: "neutral" };
  if (deltaSec > 0) return { text: `↓ ${formatDuration(deltaSec)}`, tone: "success" };
  return { text: `↑ ${formatDuration(-deltaSec)}`, tone: "danger" };
}

export type PacePrState =
  | { kind: "no-strava" }
  | { kind: "no-runs" }
  | { kind: "ok"; rows: PrRow[] };

/** Server fetcher. */
export async function getPacePrs(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<PacePrState> {
  const { data: strava } = await supabase
    .from("strava_connections")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!strava) return { kind: "no-strava" };

  const today = todayYmd(tz);
  const earliest = addDaysToYmd(today, -730);

  const { data: logs } = await supabase
    .from("cardio_logs")
    .select(
      "modality, distance_km, avg_pace_sec_per_km, strava_activity_id, session:sessions!inner(performed_at, deleted_at, user_id)",
    )
    .eq("session.user_id", userId)
    .is("session.deleted_at", null)
    .gte("session.performed_at", `${earliest}T00:00:00Z`);

  const activities: Activity[] = [];
  for (const row of logs ?? []) {
    const session = Array.isArray(row.session) ? row.session[0] : row.session;
    if (!session?.performed_at) continue;
    const modality = String(row.modality ?? "");
    if (!modality.includes("run")) continue;
    const distanceKm = row.distance_km == null ? 0 : Number(row.distance_km);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) continue;
    activities.push({
      date: String(session.performed_at).slice(0, 10),
      modality,
      distanceKm,
      avgPaceSecPerKm: row.avg_pace_sec_per_km == null ? null : Number(row.avg_pace_sec_per_km),
      stravaActivityId: row.strava_activity_id == null ? null : String(row.strava_activity_id),
    });
  }

  if (activities.length === 0) return { kind: "no-runs" };
  return { kind: "ok", rows: computePrTable(activities, today) };
}
