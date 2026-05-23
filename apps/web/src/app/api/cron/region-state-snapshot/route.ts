/**
 * GET /api/cron/region-state-snapshot — daily snapshot of per-region
 * freshness into `region_state_history`. Triggered by Vercel Cron at
 * 03:00 UTC (see `vercel.json`).
 *
 * ## Why a daily cache?
 *
 * The engine page (/app/stats/engine, Section B) renders a 14-day
 * freshness strip per region. Previously every page visit re-walked
 * the last 35 days of `set_logs` to recompute the strip — cost grew
 * linearly with user history. The cache replaces that with a single
 * indexed read of 14 rows per region.
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
 *   For each region (ALL_REGIONS):
 *     compute today's freshness via the shared
 *     `deriveRegionFreshnessLive` helper (the same derivation the
 *     read path uses for the today-fallback) and UPSERT into
 *     region_state_history keyed on (user_id, region, snapshot_date).
 *
 * Errors on a single user are logged and skipped — the batch never
 * bails on one user's data anomaly.
 */
import { NextResponse } from "next/server";
import { createAdmin } from "@/lib/supabase/server";
import { ALL_REGIONS } from "@hta/domain";
import { deriveRegionFreshnessLive } from "@/lib/stats/region-state-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

type UserErr = { userId: string; error: string };

export async function GET(req: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdmin();
  const today = todayUtcYmd();

  const userIds = await listAllUserIds(supabase);

  let usersProcessed = 0;
  let snapshotsWritten = 0;
  const errors: UserErr[] = [];

  for (const userId of userIds) {
    try {
      const live = await deriveRegionFreshnessLive(supabase, userId, "UTC");
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
      if (rows.length === 0) continue;

      const { error } = await supabase
        .from("region_state_history")
        .upsert(rows, { onConflict: "user_id,region,snapshot_date" });
      if (error) {
        errors.push({ userId, error: error.message });
        continue;
      }
      snapshotsWritten += rows.length;
    } catch (e) {
      errors.push({ userId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    snapshot_date: today,
    users_processed: usersProcessed,
    snapshots_written: snapshotsWritten,
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
