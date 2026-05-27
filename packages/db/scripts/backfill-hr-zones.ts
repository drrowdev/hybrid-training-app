/**
 * backfill-hr-zones.ts
 *
 * One-off backfill for `cardio_logs.hr_zones`. For each row that
 * already has `avg_hr_bpm` set but `hr_zones IS NULL`, we approximate
 * the per-zone seconds from the session average + max heart rate and
 * the user's saved zone configuration (`profiles.intake.hrZones` or
 * `profiles.intake.hrMax`), then update the row.
 *
 * Why this exists: PR A (audit I3) starts populating `hr_zones` on
 * every NEW Strava import. Rows imported BEFORE that change are
 * orphaned with `hr_zones = null`. This script catches them up. It is
 * NOT auto-run by the sync — invoke manually so future, better
 * methods (streams endpoint) aren't overwritten by this summary-based
 * approximation.
 *
 * Idempotent: only touches rows where `hr_zones IS NULL`, so re-runs
 * are safe.
 *
 * Run:
 *   pnpm --filter @hta/db tsx scripts/backfill-hr-zones.ts
 *
 * Required env:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * APPROXIMATED FROM SUMMARY. For finer accuracy, use Strava streams
 * (future work). Mirrors the algorithm in
 * `apps/web/src/lib/integrations/strava/zones-from-summary.ts`.
 */
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ZoneBands = {
  z1Max: number;
  z2Max: number;
  z3Max: number;
  z4Max: number;
};

export type HrZonesSeconds = {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
};

function zoneIndexForBpm(bpm: number, bands: ZoneBands): number {
  if (bpm < bands.z1Max) return 0;
  if (bpm < bands.z2Max) return 1;
  if (bpm < bands.z3Max) return 2;
  if (bpm < bands.z4Max) return 3;
  return 4;
}

function bandBounds(idx: number, bands: ZoneBands): { lo: number; hi: number } {
  const step = bands.z4Max - bands.z3Max;
  switch (idx) {
    case 0:
      return { lo: 0, hi: bands.z1Max };
    case 1:
      return { lo: bands.z1Max, hi: bands.z2Max };
    case 2:
      return { lo: bands.z2Max, hi: bands.z3Max };
    case 3:
      return { lo: bands.z3Max, hi: bands.z4Max };
    default:
      return { lo: bands.z4Max, hi: bands.z4Max + Math.max(step, 1) };
  }
}

/** Pure — same logic as the web helper, kept inline for script use. */
export function estimateZones(input: {
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  durationSec: number;
  bands: ZoneBands | null;
}): HrZonesSeconds | null {
  const { avgHrBpm, maxHrBpm, durationSec, bands } = input;
  if (!bands) return null;
  if (avgHrBpm == null || !Number.isFinite(avgHrBpm) || avgHrBpm <= 0) return null;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  const shares = [0, 0, 0, 0, 0];
  const d = zoneIndexForBpm(avgHrBpm, bands);
  shares[d] = 1;

  const { lo, hi } = bandBounds(d, bands);
  const span = hi - lo;
  const t = span > 0 ? Math.max(0, Math.min(1, (avgHrBpm - lo) / span)) : 0.5;
  if (t > 0.66 && d < 4) {
    const leak = ((t - 0.66) / 0.34) * 0.25;
    shares[d] -= leak;
    shares[d + 1] += leak;
  } else if (t < 0.33 && d > 0) {
    const leak = ((0.33 - t) / 0.33) * 0.25;
    shares[d] -= leak;
    shares[d - 1] += leak;
  }

  if (maxHrBpm != null && Number.isFinite(maxHrBpm) && maxHrBpm > 0) {
    const m = zoneIndexForBpm(maxHrBpm, bands);
    if (m > d) {
      const distance = m - d;
      const maxShare = distance === 1 ? 0.15 : 0.2;
      const pulled = Math.min(maxShare, Math.max(0, shares[d]));
      shares[d] -= pulled;
      shares[m] += pulled;
    }
  }

  const rounded = shares.map((s) => Math.round(s * durationSec));
  const total = rounded.reduce((a, b) => a + b, 0);
  rounded[d] += Math.round(durationSec) - total;
  for (let i = 0; i < rounded.length; i++) if (rounded[i] < 0) rounded[i] = 0;

  return {
    z1: rounded[0],
    z2: rounded[1],
    z3: rounded[2],
    z4: rounded[3],
    z5: rounded[4],
  };
}

export function readZoneConfig(
  intake: Record<string, unknown> | null | undefined,
): ZoneBands | null {
  if (!intake) return null;
  const explicit = intake.hrZones as Partial<ZoneBands> | undefined;
  if (
    explicit &&
    typeof explicit.z1Max === "number" &&
    typeof explicit.z2Max === "number" &&
    typeof explicit.z3Max === "number" &&
    typeof explicit.z4Max === "number"
  ) {
    return {
      z1Max: explicit.z1Max,
      z2Max: explicit.z2Max,
      z3Max: explicit.z3Max,
      z4Max: explicit.z4Max,
    };
  }
  const hrMax = intake.hrMax;
  if (typeof hrMax === "number" && hrMax > 60 && hrMax < 260) {
    return {
      z1Max: hrMax * 0.6,
      z2Max: hrMax * 0.7,
      z3Max: hrMax * 0.8,
      z4Max: hrMax * 0.9,
    };
  }
  return null;
}

export type CardioRow = {
  id: string;
  user_id: string;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
  duration_sec: number;
};

export type ProfileRow = {
  id: string;
  intake: Record<string, unknown> | null;
};

/**
 * Pure planner — given a fetched set of cardio rows + profiles,
 * returns the list of `{ id, hr_zones }` updates that should be
 * written. Skips rows whose user has no zone config (we don't guess).
 */
export function planBackfill(
  rows: CardioRow[],
  profilesByUser: Map<string, ProfileRow>,
): { id: string; hr_zones: HrZonesSeconds }[] {
  const out: { id: string; hr_zones: HrZonesSeconds }[] = [];
  const bandsByUser = new Map<string, ZoneBands | null>();
  for (const row of rows) {
    if (!bandsByUser.has(row.user_id)) {
      const profile = profilesByUser.get(row.user_id) ?? null;
      bandsByUser.set(row.user_id, readZoneConfig(profile?.intake ?? null));
    }
    const bands = bandsByUser.get(row.user_id) ?? null;
    const hrZones = estimateZones({
      avgHrBpm: row.avg_hr_bpm,
      maxHrBpm: row.max_hr_bpm,
      durationSec: row.duration_sec,
      bands,
    });
    if (hrZones) out.push({ id: row.id, hr_zones: hrZones });
  }
  return out;
}

async function fetchCandidates(
  supabase: SupabaseClient,
): Promise<{ rows: CardioRow[]; profiles: Map<string, ProfileRow> }> {
  const { data: cardio, error: ce } = await supabase
    .from("cardio_logs")
    .select(
      "id, avg_hr_bpm, max_hr_bpm, duration_sec, session:sessions!inner(user_id, deleted_at)",
    )
    .is("hr_zones", null)
    .not("avg_hr_bpm", "is", null)
    .is("session.deleted_at", null);
  if (ce) throw new Error(`cardio_logs fetch: ${ce.message}`);

  const rows: CardioRow[] = [];
  const userIds = new Set<string>();
  for (const r of (cardio ?? []) as Array<{
    id: string;
    avg_hr_bpm: number | null;
    max_hr_bpm: number | null;
    duration_sec: number;
    session: { user_id: string } | { user_id: string }[] | null;
  }>) {
    const session = Array.isArray(r.session) ? r.session[0] : r.session;
    if (!session) continue;
    userIds.add(session.user_id);
    rows.push({
      id: r.id,
      user_id: session.user_id,
      avg_hr_bpm: r.avg_hr_bpm == null ? null : Number(r.avg_hr_bpm),
      max_hr_bpm: r.max_hr_bpm == null ? null : Number(r.max_hr_bpm),
      duration_sec: r.duration_sec,
    });
  }

  const profilesByUser = new Map<string, ProfileRow>();
  if (userIds.size > 0) {
    const { data: profiles, error: pe } = await supabase
      .from("profiles")
      .select("id, intake")
      .in("id", Array.from(userIds));
    if (pe) throw new Error(`profiles fetch: ${pe.message}`);
    for (const p of (profiles ?? []) as ProfileRow[]) {
      profilesByUser.set(p.id, p);
    }
  }

  return { rows, profiles: profilesByUser };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  const supabase = createClient(url, key);

  const { rows, profiles } = await fetchCandidates(supabase);
  console.log(`[backfill-hr-zones] candidates: ${rows.length}`);
  const updates = planBackfill(rows, profiles);
  console.log(`[backfill-hr-zones] planned updates: ${updates.length}`);

  let written = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("cardio_logs")
      .update({ hr_zones: u.hr_zones })
      .eq("id", u.id)
      .is("hr_zones", null);
    if (error) {
      console.error(`[backfill-hr-zones] update ${u.id} failed: ${error.message}`);
      continue;
    }
    written++;
  }
  console.log(`[backfill-hr-zones] wrote: ${written}/${updates.length}`);
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
