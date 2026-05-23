/**
 * backfill-region-state-history.ts
 *
 * One-shot backfill for `region_state_history`. For every existing
 * user with at least one completed session, this writes a row per
 * region per day for the trailing 30 days.
 *
 * Idempotent — the upsert keys on (user_id, region, snapshot_date)
 * with ON CONFLICT DO UPDATE, so re-running this script overwrites
 * the existing rows with the freshly-derived values. Safe to run
 * repeatedly during development or after a re-import.
 *
 * The derivation matches the cron / page live-fallback path: we walk
 * the 35-day EWMA window per region, sliding the "as-of" date back
 * one day at a time and emitting a row for each region with non-zero
 * baseline or any load activity in the window. Cost per user is ~30 ×
 * (sessions × set_logs join), which is fine for a one-shot.
 *
 * Run:
 *   pnpm --filter @hta/db tsx scripts/backfill-region-state-history.ts
 *
 * Required env:
 *   - DATABASE_URL or:
 *     - NEXT_PUBLIC_SUPABASE_URL
 *     - SUPABASE_SERVICE_ROLE_KEY
 *
 * Reads `.env` from cwd via dotenv if present.
 */
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Region =
  | "foot_ankle_calf"
  | "knee"
  | "hamstring_posterior"
  | "adductor_groin"
  | "lumbar_trunk"
  | "shoulder_scapular"
  | "elbow_forearm";

const ALL_REGIONS: readonly Region[] = [
  "foot_ankle_calf",
  "knee",
  "hamstring_posterior",
  "adductor_groin",
  "lumbar_trunk",
  "shoulder_scapular",
  "elbow_forearm",
];

const LOOKBACK_DAYS = 35;
const BACKFILL_DAYS = 30;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(ymdStr: string, days: number): string {
  const d = new Date(ymdStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ewmaStep(prev: number, value: number, window: number): number {
  const alpha = 2 / (window + 1);
  return prev + alpha * (value - prev);
}

function computeRegionFreshness(atl: number, baseline: number): number {
  if (baseline <= 0) return 1;
  const ratio = atl / baseline;
  return Math.max(0, Math.min(1, 1 - ratio));
}

type MovementRefs = { primary_region: string; secondary_regions: unknown };

function normaliseMovement(m: unknown): MovementRefs | null {
  if (!m) return null;
  if (Array.isArray(m)) return (m[0] as MovementRefs) ?? null;
  return m as MovementRefs;
}

async function listAllUserIds(supabase: SupabaseClient): Promise<string[]> {
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
    if (page > 100) break;
  }
  return ids;
}

type DailyLoad = Map<string, number>;

type UserData = {
  baselineByRegion: Map<Region, number>;
  lastLoadByRegion: Map<Region, string | null>;
  dailyByRegion: Record<Region, DailyLoad>;
};

async function loadUserData(supabase: SupabaseClient, userId: string): Promise<UserData> {
  const today = ymd(new Date());
  // Pull lookback covering the oldest "as-of" we'll snapshot.
  const farLookbackStart = addDays(today, -(BACKFILL_DAYS + LOOKBACK_DAYS));
  const sinceIso = new Date(farLookbackStart + "T00:00:00Z").toISOString();

  const [{ data: regionStateRows }, { data: sessions }] = await Promise.all([
    supabase
      .from("region_state")
      .select("region, baseline_tolerance, last_load_date")
      .eq("user_id", userId),
    supabase
      .from("sessions")
      .select("id, performed_at")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .is("deleted_at", null)
      .gte("performed_at", sinceIso)
      .order("performed_at", { ascending: true }),
  ]);

  const baselineByRegion = new Map<Region, number>();
  const lastLoadByRegion = new Map<Region, string | null>();
  for (const r of regionStateRows ?? []) {
    baselineByRegion.set(r.region as Region, Number(r.baseline_tolerance ?? 0));
    lastLoadByRegion.set(r.region as Region, (r.last_load_date as string | null) ?? null);
  }

  const dailyByRegion: Record<Region, DailyLoad> = Object.fromEntries(
    ALL_REGIONS.map((r) => [r, new Map<string, number>()]),
  ) as Record<Region, DailyLoad>;

  if (sessions && sessions.length > 0) {
    const sessionIds = sessions.map((s) => s.id);
    const performedAtById = new Map(
      sessions.map((s) => [s.id, s.performed_at as string]),
    );
    const { data: sets } = await supabase
      .from("set_logs")
      .select(
        "session_id, weight_kg, reps, rpe, set_kind, movement:movements(primary_region, secondary_regions)",
      )
      .in("session_id", sessionIds)
      .not("reps", "is", null)
      .gt("reps", 0);

    for (const row of sets ?? []) {
      if (row.set_kind === "warmup") continue;
      const performedAt = performedAtById.get(row.session_id);
      if (!performedAt) continue;
      const date = performedAt.slice(0, 10);
      const movement = normaliseMovement(row.movement);
      if (!movement) continue;
      const reps = Number(row.reps);
      const weight = Number(row.weight_kg ?? 0);
      const rpe = row.rpe == null ? 7 : Number(row.rpe);
      if (reps <= 0 || weight <= 0) continue;
      const setLoad = reps * weight * Math.max(0.3, Math.min(1.0, rpe / 10));
      const primary = movement.primary_region as Region;
      if (ALL_REGIONS.includes(primary)) {
        dailyByRegion[primary].set(date, (dailyByRegion[primary].get(date) ?? 0) + setLoad);
      }
      if (Array.isArray(movement.secondary_regions)) {
        for (const r of movement.secondary_regions as string[]) {
          const region = r as Region;
          if (ALL_REGIONS.includes(region)) {
            dailyByRegion[region].set(
              date,
              (dailyByRegion[region].get(date) ?? 0) + setLoad * 0.5,
            );
          }
        }
      }
    }
  }

  return { baselineByRegion, lastLoadByRegion, dailyByRegion };
}

function countSetsInWindows(
  series: DailyLoad,
  asOf: string,
): { d7: number; d14: number; d28: number } {
  let d7 = 0;
  let d14 = 0;
  let d28 = 0;
  const asOfMs = Date.UTC(
    Number(asOf.slice(0, 4)),
    Number(asOf.slice(5, 7)) - 1,
    Number(asOf.slice(8, 10)),
  );
  for (const [date, load] of series) {
    if (load <= 0) continue;
    const dMs = Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    );
    const diff = Math.round((asOfMs - dMs) / 86_400_000);
    if (diff < 0) continue;
    if (diff < 7) d7++;
    if (diff < 14) d14++;
    if (diff < 28) d28++;
  }
  return { d7, d14, d28 };
}

function snapshotForDate(
  data: UserData,
  asOf: string,
): Array<{
  region: Region;
  freshness: number;
  atl: number;
  baseline: number;
  setCounts: { d7: number; d14: number; d28: number };
  lastLoadDate: string | null;
}> {
  const start = addDays(asOf, -(LOOKBACK_DAYS - 1));
  const out: Array<{
    region: Region;
    freshness: number;
    atl: number;
    baseline: number;
    setCounts: { d7: number; d14: number; d28: number };
    lastLoadDate: string | null;
  }> = [];

  for (const region of ALL_REGIONS) {
    const series = data.dailyByRegion[region];
    const baseline = data.baselineByRegion.get(region) ?? 0;
    // For the asOf date, restrict last-load to dates ≤ asOf so the
    // historical row is correct.
    let lastLoadOnOrBefore: string | null = null;
    for (const [date, load] of series) {
      if (load <= 0) continue;
      if (date > asOf) continue;
      if (!lastLoadOnOrBefore || date > lastLoadOnOrBefore) lastLoadOnOrBefore = date;
    }
    const sliceHasData = lastLoadOnOrBefore !== null;
    if (baseline <= 0 && !sliceHasData) continue;

    let atl = 0;
    for (let cursor = start; cursor <= asOf; cursor = addDays(cursor, 1)) {
      const load = series.get(cursor) ?? 0;
      atl = ewmaStep(atl, load, 7);
    }
    const freshness = computeRegionFreshness(atl, baseline > 0 ? baseline : Math.max(atl, 1));
    out.push({
      region,
      freshness,
      atl,
      baseline,
      setCounts: countSetsInWindows(series, asOf),
      lastLoadDate: lastLoadOnOrBefore,
    });
  }
  return out;
}

function roundToScale(n: number, scale: number): number {
  const f = 10 ** scale;
  return Math.round(n * f) / f;
}

async function backfillUser(supabase: SupabaseClient, userId: string): Promise<number> {
  const data = await loadUserData(supabase, userId);
  // Skip user if there's truly nothing.
  if (data.baselineByRegion.size === 0) {
    let anyLoad = false;
    for (const r of ALL_REGIONS) {
      if (data.dailyByRegion[r].size > 0) {
        anyLoad = true;
        break;
      }
    }
    if (!anyLoad) return 0;
  }

  const today = ymd(new Date());
  const rows: Array<Record<string, unknown>> = [];
  for (let i = BACKFILL_DAYS - 1; i >= 0; i--) {
    const asOf = addDays(today, -i);
    const snaps = snapshotForDate(data, asOf);
    for (const s of snaps) {
      rows.push({
        user_id: userId,
        region: s.region,
        snapshot_date: asOf,
        freshness_score: roundToScale(s.freshness, 4),
        context: {
          sets_7d: s.setCounts.d7,
          sets_14d: s.setCounts.d14,
          sets_28d: s.setCounts.d28,
          last_hit_date: s.lastLoadDate,
          atl: s.atl,
          baseline: s.baseline,
          backfilled: true,
        },
      });
    }
  }

  if (rows.length === 0) return 0;
  // Chunk to keep the request body reasonable.
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("region_state_history")
      .upsert(slice, { onConflict: "user_id,region,snapshot_date" });
    if (error) throw new Error(error.message);
    written += slice.length;
  }
  return written;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in your .env or shell.",
    );
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.error("Listing users…");
  const userIds = await listAllUserIds(supabase);
  console.error(`Found ${userIds.length} users. Backfilling ${BACKFILL_DAYS} days each.`);

  let totalWritten = 0;
  let totalUsers = 0;
  const errors: Array<{ userId: string; error: string }> = [];
  for (const userId of userIds) {
    try {
      const written = await backfillUser(supabase, userId);
      totalWritten += written;
      totalUsers++;
      if (written > 0) {
        console.error(`  ${userId}: ${written} rows`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ${userId}: ERROR ${msg}`);
      errors.push({ userId, error: msg });
    }
  }

  console.error(
    `Done. Users processed: ${totalUsers}/${userIds.length}. Rows upserted: ${totalWritten}. Errors: ${errors.length}.`,
  );
  if (errors.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
