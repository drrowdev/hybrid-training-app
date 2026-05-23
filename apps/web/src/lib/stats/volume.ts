/**
 * Volume (tonnage) — 30-day strength volume for the Stats overview card.
 *
 * Phase 1 brief decision (Stats Overview §F): **pure tonnage**, defined
 * as `Σ weight_kg × reps` across non-warmup strength `set_logs` from
 * non-deleted sessions in the last 30 days. No INOL / set-volume / fancy
 * unit translation. If we want load-aware metrics later, that's Phase
 * 2+ (the engine already exposes the six-bucket model — point the next
 * surface at that).
 *
 * Weekly buckets: anchor each session's `performed_at` (UTC YYYY-MM-DD)
 * to the Monday of its ISO week. We return five buckets ending at the
 * Monday of the current calendar week, oldest-first, so the bar chart
 * reads left-to-right as it does on every other surface.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd, mondayOfYmd, todayYmd } from "@/lib/dates";

const WINDOW_DAYS = 30;
const BUCKETS = 5;

export type SetRow = {
  weightKg: number | null;
  reps: number | null;
  setKind: string | null;
  /** Session's performed_at as YYYY-MM-DD in the user's timezone. */
  performedYmd: string;
};

export type VolumeResult = {
  /** Total kg tonnage in the 30-day window. */
  totalKg: number;
  /** 5 weekly buckets oldest-first, each kg tonnage. */
  weeklyKg: number[];
  /** Monday YYYY-MM-DD of each bucket, same order as `weeklyKg`. */
  weekStarts: string[];
};

/**
 * Pure aggregator over already-filtered set rows. Warmups and cardio
 * (reps null or weight null) are skipped — we only count strength work.
 */
export function bucketTonnageByWeek(
  rows: SetRow[],
  today: string,
): VolumeResult {
  const currentMonday = mondayOfYmd(today);
  const weekStarts: string[] = [];
  for (let i = BUCKETS - 1; i >= 0; i--) {
    weekStarts.push(addDaysToYmd(currentMonday, -7 * i));
  }
  const weeklyKg = new Array(BUCKETS).fill(0) as number[];
  let totalKg = 0;
  const earliest = weekStarts[0];

  for (const row of rows) {
    if (row.setKind === "warmup") continue;
    if (row.weightKg == null || row.reps == null) continue;
    if (row.reps <= 0 || row.weightKg <= 0) continue;
    if (row.performedYmd < earliest) continue;
    const tonnage = row.weightKg * row.reps;
    totalKg += tonnage;
    const sessionMonday = mondayOfYmd(row.performedYmd);
    const idx = weekStarts.indexOf(sessionMonday);
    if (idx >= 0) weeklyKg[idx] += tonnage;
  }
  return { totalKg, weeklyKg, weekStarts };
}

export async function getVolume30d(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
): Promise<VolumeResult> {
  const today = todayYmd(tz);
  const earliestMonday = addDaysToYmd(mondayOfYmd(today), -7 * (BUCKETS - 1));
  // Floor at midnight UTC of the earliest bucket Monday; a one-day fudge
  // either side is fine because `performedYmd` is the true filter and
  // the SQL bound just trims the scan size.
  const earliestIso = `${earliestMonday}T00:00:00Z`;

  const { data, error } = await supabase
    .from("set_logs")
    .select(
      "weight_kg, reps, set_kind, sessions!inner(performed_at, user_id, deleted_at)",
    )
    .eq("sessions.user_id", userId)
    .is("sessions.deleted_at", null)
    .gte("sessions.performed_at", earliestIso)
    .neq("set_kind", "warmup")
    .not("weight_kg", "is", null)
    .not("reps", "is", null);
  if (error) throw new Error(error.message);

  type Row = {
    weight_kg: number | string | null;
    reps: number | null;
    set_kind: string | null;
    sessions:
      | { performed_at: string }
      | Array<{ performed_at: string }>
      | null;
  };
  const rows = (data ?? []) as Row[];
  const mapped: SetRow[] = rows
    .map((r) => {
      const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
      if (!s?.performed_at) return null;
      return {
        weightKg: r.weight_kg == null ? null : Number(r.weight_kg),
        reps: r.reps,
        setKind: r.set_kind,
        performedYmd: String(s.performed_at).slice(0, 10),
      } satisfies SetRow;
    })
    .filter((r): r is SetRow => r != null);

  return bucketTonnageByWeek(mapped, today);
}

export { WINDOW_DAYS as VOLUME_WINDOW_DAYS, BUCKETS as VOLUME_WEEKLY_BUCKETS };
