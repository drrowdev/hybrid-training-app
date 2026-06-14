/**
 * Ceiling utilization — "how close are you to the archetype's weekly cap?"
 *
 * Phase 2 MVP: count this week's strength working sets (excludes warmup)
 * and compare to the archetype's prescribed strength volume for the
 * current week index. Cardio uses cardio session count vs prescribed.
 *
 * Bands:
 *   <70%  -> "Under-loading"  — could push harder if recovered
 *   70-90% -> "On budget"      — engine sweet spot
 *   90-110% -> "At the line"   — about right but no room to spare
 *   110-130% -> "Over budget"  — past the recommended dose
 *   >=130% -> "Way over"       — high injury / regression risk
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { ARCHETYPES, type ArchetypeId } from "@/lib/planner/archetypes";
import { archetypeDisplayName } from "@/lib/planner/queries";

export type CeilingBand = "under" | "on-budget" | "at-line" | "over" | "way-over";

export type CeilingUtilization = {
  archetypeName: string;
  weekIndex: number;
  weekLabel: string;
  strength: { actual: number; prescribed: number; pct: number; band: CeilingBand; bandLabel: string };
  cardio: { actual: number; prescribed: number; pct: number; band: CeilingBand; bandLabel: string };
};

function bandFor(pct: number): { band: CeilingBand; label: string } {
  if (pct < 0.7) return { band: "under", label: "Under-loading" };
  if (pct < 0.9) return { band: "on-budget", label: "On budget" };
  if (pct < 1.1) return { band: "at-line", label: "At the line" };
  if (pct < 1.3) return { band: "over", label: "Over budget" };
  return { band: "way-over", label: "Way over" };
}

/** Counts the strength + cardio items prescribed in one archetype week. */
function prescribedCountsForWeek(
  archetypeId: string,
  weekIndex: number,
): { strengthSets: number; cardioSessions: number } | null {
  const archetype = ARCHETYPES[archetypeId as Exclude<ArchetypeId, "custom">];
  if (!archetype) return null;
  const week = archetype.weekProfiles[weekIndex] ?? archetype.weekProfiles[archetype.weekProfiles.length - 1];
  if (!week) return null;

  const volumeScale = week.strengthVolumeScale ?? 1.0;
  // Working sets per strength day = number of setIntensities entries
  // (one working set per intensity step), scaled by the week's volume
  // scalar. Multiply by the count of strength days in the archetype.
  const strengthDayCount = archetype.days.filter((d) => d.kind === "strength").length;
  const setsPerDay = week.setIntensities.length;
  const strengthSets = Math.round(strengthDayCount * setsPerDay * volumeScale);

  const cardioSessions = archetype.days.filter((d) => d.kind === "cardio").length;
  return { strengthSets, cardioSessions };
}

/** Strength-item kinds that count as a prescribed working set (excludes warmup). */
const STRENGTH_WORKING_KINDS = new Set([
  "main",
  "back_off",
  "accessory",
  "tendon",
  "power_potentiation",
]);

/**
 * Pure tally of a week's planned sessions → prescribed working sets + cardio
 * session count. Exported for unit testing without a Supabase round-trip.
 */
export function tallyPlannedWeek(
  rows: Array<{ prescription: Prescription | null; role?: string | null }>,
): {
  counts: { strengthSets: number; cardioSessions: number };
  isDeload: boolean;
} {
  let strengthSets = 0;
  let cardioSessions = 0;
  let isDeload = false;
  for (const r of rows) {
    if (r.role === "deload") isDeload = true;
    const items = r.prescription?.items ?? [];
    let hasCardio = false;
    for (const it of items) {
      if (STRENGTH_WORKING_KINDS.has(it.kind)) {
        strengthSets += it.sets ?? 1;
      } else if (it.kind.startsWith("cardio")) {
        hasCardio = true;
      }
    }
    if (hasCardio) cardioSessions += 1;
  }
  return { counts: { strengthSets, cardioSessions }, isDeload };
}

/**
 * Program-agnostic prescribed counts for platform blocks (archetype NULL).
 *
 * Archetype config is unavailable for platform programs (5/3/1 / TB / GP /
 * Hybrid), so the prescribed weekly volume is read straight from the
 * materialised `planned_sessions` of the current week: sum the working sets
 * across all strength items, and count the sessions that carry any cardio item.
 * This mirrors the "actual" side (set_logs rows + cardio_logs) so the
 * utilisation ratio is apples-to-apples. Returns null when the week has no
 * planned sessions.
 */
async function prescribedCountsFromPlannedSessions(
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
  weekIndex: number,
): Promise<{
  counts: { strengthSets: number; cardioSessions: number };
  isDeload: boolean;
} | null> {
  const { data: rows } = await supabase
    .from("planned_sessions")
    .select("prescription, role")
    .eq("user_id", userId)
    .eq("block_id", blockId)
    .eq("week_index", weekIndex);
  if (!rows || rows.length === 0) return null;
  return tallyPlannedWeek(
    rows as Array<{ prescription: Prescription | null; role?: string | null }>,
  );
}

export async function getCeilingUtilization(
  supabase: SupabaseClient,
  userId: string,
): Promise<CeilingUtilization | null> {
  // Active block determines week index + prescribed-volume source.
  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, weeks, notes, program_family")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (!block) return null;

  const startedOn = new Date(block.started_on + "T00:00:00");
  const daysSinceStart = Math.floor((Date.now() - startedOn.getTime()) / 86_400_000);
  const weekIndex = Math.max(0, Math.min(block.weeks - 1, Math.floor(daysSinceStart / 7)));

  // Prescribed counts + labels: archetype config for legacy archetype blocks
  // (byte-identical), else read from the materialised planned_sessions for
  // platform programs (archetype NULL).
  const archetype = ARCHETYPES[block.archetype as Exclude<ArchetypeId, "custom">];
  let prescribed: { strengthSets: number; cardioSessions: number } | null;
  let archetypeName: string;
  let weekLabel: string;
  if (archetype) {
    prescribed = prescribedCountsForWeek(block.archetype, weekIndex);
    const weekProfile =
      archetype.weekProfiles[weekIndex] ??
      archetype.weekProfiles[archetype.weekProfiles.length - 1];
    archetypeName = archetype.name;
    weekLabel = weekProfile?.intensityLabel ?? `Week ${weekIndex + 1}`;
  } else {
    const wk = await prescribedCountsFromPlannedSessions(
      supabase,
      userId,
      block.id,
      weekIndex,
    );
    prescribed = wk?.counts ?? null;
    archetypeName = archetypeDisplayName(block.archetype, block.notes);
    weekLabel = wk?.isDeload ? "Deload" : `Week ${weekIndex + 1}`;
  }
  if (!prescribed) return null;

  // Week window: last 7 days (rolling) instead of strict calendar week —
  // matches the rolling-week pattern used elsewhere (region freshness,
  // muscle volume).
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", userId)
    .gte("performed_at", sevenDaysAgo)
    .is("deleted_at", null);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  let actualStrength = 0;
  let actualCardio = 0;
  if (sessionIds.length > 0) {
    const [setCount, cardioCount] = await Promise.all([
      supabase
        .from("set_logs")
        .select("id", { count: "exact", head: true })
        .in("session_id", sessionIds)
        .neq("set_kind", "warmup")
        .not("reps", "is", null)
        .gt("reps", 0),
      supabase
        .from("cardio_logs")
        .select("id", { count: "exact", head: true })
        .in("session_id", sessionIds),
    ]);
    actualStrength = setCount.count ?? 0;
    actualCardio = cardioCount.count ?? 0;
  }

  const strengthPct = prescribed.strengthSets > 0 ? actualStrength / prescribed.strengthSets : 0;
  const cardioPct = prescribed.cardioSessions > 0 ? actualCardio / prescribed.cardioSessions : 0;
  const sBand = bandFor(strengthPct);
  const cBand = bandFor(cardioPct);

  return {
    archetypeName,
    weekIndex,
    weekLabel,
    strength: {
      actual: actualStrength,
      prescribed: prescribed.strengthSets,
      pct: strengthPct,
      band: sBand.band,
      bandLabel: sBand.label,
    },
    cardio: {
      actual: actualCardio,
      prescribed: prescribed.cardioSessions,
      pct: cardioPct,
      band: cBand.band,
      bandLabel: cBand.label,
    },
  };
}

export { bandFor as ceilingBandFor };
