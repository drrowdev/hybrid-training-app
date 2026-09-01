/**
 * GET /api/cron/region-state-snapshot — daily snapshot of per-region
 * freshness into `region_state_history` AND per-muscle freshness into
 * `muscle_state_history`. Triggered by Vercel Cron at 03:00 UTC (see
 * `vercel.json`).
 *
 * ## Why a daily cache?
 *
 * The engine page (/app/stats/engine, Section B) renders a 14-day
 * freshness strip per region. Previously every page visit re-walked
 * the last 35 days of `set_logs` to recompute the strip — cost grew
 * linearly with user history. The cache replaces that with a single
 * indexed read of 14 rows per region.
 *
 * The 16-muscle grid (/app/freshness) is the
 * same story at finer resolution — the same per-user lookback feeds
 * both tables, so we extend this handler rather than running a
 * second cron at a separate time.
 *
 * ## Auth
 *
 * Vercel injects `Authorization: Bearer $CRON_SECRET` on cron
 * invocations. Mirrors `/api/cron/trash-cleanup` (PR #27). The
 * service-role client bypasses RLS so the cron can write rows for
 * every user.
 *
 * ## Behavior
 *
 * For each user (auth.users):
 *   - Compute region freshness via the shared
 *     `deriveRegionFreshnessLive` helper → upsert into
 *     region_state_history keyed on (user_id, region, snapshot_date).
 *   - Compute muscle freshness via `deriveMuscleLoadEvents` +
 *     `computeMuscleFreshness` → upsert into muscle_state_history
 *     keyed on (user_id, muscle, snapshot_date).
 *
 * Errors on a single user (or a single table for one user) are
 * logged and skipped — the batch never bails on one user's anomaly.
 */
import { NextResponse } from "next/server";
import { createAdmin } from "@/lib/supabase/server";
import { ALL_REGIONS } from "@hta/domain";
import { deriveRegionFreshnessLive } from "@/lib/stats/region-state-snapshot";
import {
  ALL_MUSCLE_GROUPS,
  deriveMuscleLoadEvents,
  computeMuscleFreshness,
} from "@/lib/muscle";
import { todayYmd } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserErr = { userId: string; error: string };

export async function GET(req: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdmin();
  // Keep the existing batch-level response field. Individual rows below use
  // each user's local calendar date.
  const snapshotDate = todayYmd("UTC");
  const userIds = await listAllUserIds(supabase);

  let usersProcessed = 0;
  let snapshotsWritten = 0;
  let muscleSnapshotsWritten = 0;
  const errors: UserErr[] = [];

  for (const userId of userIds) {
    try {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", userId)
        .maybeSingle();
      if (profileError) throw new Error(profileError.message);
      const timezone = profile?.timezone ?? "UTC";
      const today = todayYmd(timezone);
      const live = await deriveRegionFreshnessLive(supabase, userId, timezone);
      const rows = ALL_REGIONS.flatMap((region) => {
        const snap = live.get(region);
        if (!snap) return [];
        return [
          {
            user_id: userId,
            region,
            snapshot_date: today,
            freshness_score: roundToScale(snap.freshness, 4),
            context: {
              sets_7d: snap.setCounts.d7,
              sets_14d: snap.setCounts.d14,
              sets_28d: snap.setCounts.d28,
              last_hit_date: snap.lastLoadDate,
              atl: snap.atl,
              baseline: snap.baseline,
            },
          },
        ];
      });

      usersProcessed++;
      if (rows.length > 0) {
        const { error } = await supabase
          .from("region_state_history")
          .upsert(rows, { onConflict: "user_id,region,snapshot_date" });
        if (error) {
          errors.push({ userId, error: error.message });
        } else {
          snapshotsWritten += rows.length;
        }
      }

      // Muscle snapshots — additive 16-muscle grid alongside the
      // 7-region model. Same lookback, separate table.
      try {
        const events = await deriveMuscleLoadEvents(supabase, userId, timezone);
        const computed = computeMuscleFreshness(events, today);
        const muscleRows = ALL_MUSCLE_GROUPS.map((muscle) => {
          const row = computed.get(muscle)!;
          return {
            user_id: userId,
            muscle,
            snapshot_date: today,
            freshness_score: roundToScale(row.freshness, 4),
            days_since_loaded: row.daysSinceLoaded,
            last_load_date: row.lastLoadDate,
            context: {
              atl: row.atl,
              band: row.band,
              top_movements: row.topContributors,
            },
          };
        });
        const { error: mErr } = await supabase
          .from("muscle_state_history")
          .upsert(muscleRows, { onConflict: "user_id,muscle,snapshot_date" });
        if (mErr) {
          errors.push({ userId, error: `muscle: ${mErr.message}` });
        } else {
          muscleSnapshotsWritten += muscleRows.length;
        }
      } catch (e) {
        errors.push({
          userId,
          error: `muscle: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    } catch (e) {
      errors.push({ userId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    snapshot_date: snapshotDate,
    users_processed: usersProcessed,
    snapshots_written: snapshotsWritten,
    muscle_snapshots_written: muscleSnapshotsWritten,
    errors,
  });
}

async function listAllUserIds(
  supabase: ReturnType<typeof createAdmin>,
): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers page=${page}: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) ids.push(u.id);
    if (users.length < perPage) break;
    page++;
    if (page > 100) break; // hard safety cap
  }
  return ids;
}

function roundToScale(n: number, scale: number): number {
  const f = 10 ** scale;
  return Math.round(n * f) / f;
}
