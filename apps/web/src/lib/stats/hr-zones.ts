/**
 * Time-in-HR-zones — Strava-gated intensity-distribution card.
 *
 * v1 simplification: we don't yet have per-second HR streams, only the
 * `avg_hr_bpm` rollup persisted per cardio_logs row. We bucket the
 * entire activity into whichever zone the average HR falls into. This
 * over-credits Z2 and under-credits transient spikes — flagged as
 * "approximated from session average" in the card footnote.
 *
 * Zone thresholds:
 *   - If the user has saved zones in `profiles.intake.hrZones`, use those.
 *   - Else if a single `profiles.intake.hrMax` is set, derive Z1–Z5 as
 *     %max bands (Z1 < 60%, Z2 60–70, Z3 70–80, Z4 80–90, Z5 ≥ 90 —
 *     middle-of-the-road defaults used in practitioner guides).
 *   - Else: no zone config → empty-state branch.
 *
 * The Seiler 2010 polarised model targets ~80% time in Z1–Z2 + ~20% in
 * Z4–Z5 with minimal Z3 — we surface the principle and the user's own
 * split as a one-liner below the bar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd, todayYmd } from "@/lib/dates";

export type Zone = "Z1" | "Z2" | "Z3" | "Z4" | "Z5";

export type ZoneBands = {
  /** Upper bound (exclusive) of Z1, in bpm. */
  z1Max: number;
  /** Upper bound (exclusive) of Z2. */
  z2Max: number;
  /** Upper bound (exclusive) of Z3. */
  z3Max: number;
  /** Upper bound (exclusive) of Z4 — anything at/above is Z5. */
  z4Max: number;
};

export type ActivitySummary = {
  durationSec: number;
  avgHrBpm: number | null;
};

export type ZoneTotals = Record<Zone, number>;

const ZONES: Zone[] = ["Z1", "Z2", "Z3", "Z4", "Z5"];

/**
 * Build default zone bands from a max-HR value. Uses the Karvonen-style
 * % HRmax bands common in entry-level coaching templates (Z1 < 60%,
 * Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 ≥ 90%).
 */
export function zoneBandsFromMaxHr(hrMax: number): ZoneBands {
  return {
    z1Max: hrMax * 0.6,
    z2Max: hrMax * 0.7,
    z3Max: hrMax * 0.8,
    z4Max: hrMax * 0.9,
  };
}

/** Map a single avg-HR value to a zone using the configured bands. */
export function zoneForBpm(bpm: number, bands: ZoneBands): Zone {
  if (bpm < bands.z1Max) return "Z1";
  if (bpm < bands.z2Max) return "Z2";
  if (bpm < bands.z3Max) return "Z3";
  if (bpm < bands.z4Max) return "Z4";
  return "Z5";
}

/**
 * Bucket activities into total seconds-per-zone using session-average
 * HR. Activities without an avg HR are skipped (the card surfaces a
 * dropped-count footnote when needed).
 */
export function bucketByZone(
  activities: ActivitySummary[],
  bands: ZoneBands,
): { totals: ZoneTotals; skipped: number } {
  const totals: ZoneTotals = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  let skipped = 0;
  for (const a of activities) {
    if (a.avgHrBpm == null || !Number.isFinite(a.avgHrBpm) || a.avgHrBpm <= 0) {
      skipped += 1;
      continue;
    }
    const zone = zoneForBpm(a.avgHrBpm, bands);
    totals[zone] += a.durationSec;
  }
  return { totals, skipped };
}

export type PolarisedSplit = {
  easyPct: number;      // Z1 + Z2
  thresholdPct: number; // Z3
  hardPct: number;      // Z4 + Z5
};

/** Compute the easy / threshold / hard percentage split for the polarised one-liner. */
export function polarisedSplit(totals: ZoneTotals): PolarisedSplit {
  const total = ZONES.reduce((acc, z) => acc + totals[z], 0);
  if (total === 0) return { easyPct: 0, thresholdPct: 0, hardPct: 0 };
  return {
    easyPct: (totals.Z1 + totals.Z2) / total,
    thresholdPct: totals.Z3 / total,
    hardPct: (totals.Z4 + totals.Z5) / total,
  };
}

export type HrZoneState =
  | { kind: "no-strava" }
  | { kind: "no-zones" }
  | { kind: "no-hr-data" }
  | {
      kind: "ok";
      totals: ZoneTotals;
      split: PolarisedSplit;
      bands: ZoneBands;
      activityCount: number;
      droppedCount: number;
      windowDays: number;
    };

/**
 * Read the user's HR-zone configuration off the profile `intake` blob.
 * The blob is intentionally untyped (`jsonb`) so we narrow defensively.
 */
export function readZoneConfig(intake: Record<string, unknown> | null | undefined): ZoneBands | null {
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
    return zoneBandsFromMaxHr(hrMax);
  }
  return null;
}

/**
 * Server fetcher — returns the discriminated state the card renders
 * directly. windowDays defaults to 28 (≈ 4 weeks).
 */
export async function getHrZones(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  windowDays = 28,
): Promise<HrZoneState> {
  const { data: strava } = await supabase
    .from("strava_connections")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!strava) return { kind: "no-strava" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("intake")
    .eq("id", userId)
    .maybeSingle();
  const bands = readZoneConfig((profile?.intake as Record<string, unknown> | null) ?? null);

  const today = todayYmd(tz);
  const since = addDaysToYmd(today, -windowDays);

  const { data: logs } = await supabase
    .from("cardio_logs")
    .select(
      "duration_sec, avg_hr_bpm, external_source, session:sessions!inner(performed_at, deleted_at, user_id)",
    )
    .eq("session.user_id", userId)
    .is("session.deleted_at", null)
    .gte("session.performed_at", `${since}T00:00:00Z`);

  const activities: ActivitySummary[] = [];
  for (const row of logs ?? []) {
    const session = Array.isArray(row.session) ? row.session[0] : row.session;
    if (!session) continue;
    activities.push({
      durationSec: row.duration_sec ?? 0,
      avgHrBpm: row.avg_hr_bpm == null ? null : Number(row.avg_hr_bpm),
    });
  }

  const withHr = activities.filter((a) => a.avgHrBpm != null);
  if (withHr.length === 0) return { kind: "no-hr-data" };
  if (!bands) return { kind: "no-zones" };

  const { totals, skipped } = bucketByZone(activities, bands);
  return {
    kind: "ok",
    totals,
    split: polarisedSplit(totals),
    bands,
    activityCount: withHr.length,
    droppedCount: skipped,
    windowDays,
  };
}
