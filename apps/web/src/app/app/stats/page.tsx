/**
 * /app/stats — command-center overview (Direction C2 redesign).
 *
 * The single landing page for everything the engine collects. A hero
 * verdict band (progress · readiness · consistency) sits over a bento of
 * focused tiles (strength, endurance, recovery & load, consistency &
 * balance, bodyweight, decision trace). The previous flat card grid and
 * the 20-week calendar heatmap were retired in this redesign — the
 * heatmap's grid layout tested poorly and the bento surfaces the same
 * "are you training consistently" signal through the weekly-rhythm tile.
 *
 * Data posture (no hardcoded numbers — every cell traces to a query):
 *  - Range-dependent buckets (adherence / PRs / volume / strength /
 *    endurance, and the derived progress verdict) are pre-fetched for all
 *    three windows in one Promise.all so the client toggle is a state
 *    swap, not a server round-trip (audit F1).
 *  - Range-invariant signals (block, readiness, streak, weekly rhythm,
 *    region freshness, bodyweight, decision trace) read once.
 *
 * "all"-time strength/endurance use a 10-year window sentinel because
 * those two queries take a concrete `windowDays` (they bound the e1RM /
 * pace regression); 3650 days captures the full history honestly.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { getActiveBlockProgress } from "@/lib/stats/active-block-progress";
import { getAdherenceForWindow } from "@/lib/stats/adherence";
import { getPrsForRange } from "@/lib/stats/prs-range";
import { getFreshnessMini } from "@/lib/stats/freshness-mini";
import { getVolumeForRange } from "@/lib/stats/volume";
import { getBodyweightTrend } from "@/lib/stats/bodyweight-trend";
import { getReadiness } from "@/lib/stats/readiness";
import { getStrengthProgress } from "@/lib/stats/strength-progress";
import { getEnduranceProgress } from "@/lib/stats/endurance-progress";
import { getProgressVerdict } from "@/lib/stats/progress-verdict";
import { getWeeklyRhythm } from "@/lib/stats/weekly-rhythm";
import { getStreak } from "@/lib/stats/streak";
import { getDecisionTrace } from "@/lib/stats/engine";
import { type WeightUnit } from "@/lib/stats/units";
import { type ProfileForFormat } from "@/lib/format/datetime";
import { parseRange, rangeWindowDays, type Range } from "@/lib/stats/range";
import {
  StatsCommandCenter,
  type StatsRangeBucket,
} from "@/components/stats/StatsCommandCenter";

export const dynamic = "force-dynamic";

// All-time strength/endurance window: those queries require a concrete
// day count (they bound the regression), so "all" maps to ~10 years.
const ALL_TIME_WINDOW_DAYS = 3650;

function strengthWindow(range: Range): number {
  return rangeWindowDays(range) ?? ALL_TIME_WINDOW_DAYS;
}

export default async function StatsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("units, timezone, time_format, date_format")
    .eq("id", user.id)
    .maybeSingle();
  const units: WeightUnit = profile?.units === "imperial" ? "imperial" : "metric";
  const tz = profile?.timezone ?? (await getUserTimezone(user.id));
  const formatProfile: ProfileForFormat = profile
    ? {
        timezone: profile.timezone ?? null,
        time_format: profile.time_format ?? null,
        date_format: profile.date_format ?? null,
      }
    : null;

  const [
    block,
    freshness,
    bodyweight,
    readiness,
    streak,
    rhythm,
    decisionTrace,
    adherence30d,
    adherence90d,
    adherenceAll,
    prs30d,
    prs90d,
    prsAll,
    volume30d,
    volume90d,
    volumeAll,
    strength30d,
    strength90d,
    strengthAll,
    endurance30d,
    endurance90d,
    enduranceAll,
  ] = await Promise.all([
    getActiveBlockProgress(supabase, user.id, tz),
    getFreshnessMini(supabase, user.id),
    getBodyweightTrend(supabase, user.id, tz),
    getReadiness(supabase, user.id, tz),
    getStreak(supabase, user.id, tz),
    getWeeklyRhythm(supabase, user.id, tz),
    getDecisionTrace(supabase, user.id, tz),
    getAdherenceForWindow(supabase, user.id, tz, rangeWindowDays("30d")),
    getAdherenceForWindow(supabase, user.id, tz, rangeWindowDays("90d")),
    getAdherenceForWindow(supabase, user.id, tz, rangeWindowDays("all")),
    getPrsForRange(supabase, user.id, tz, rangeWindowDays("30d")),
    getPrsForRange(supabase, user.id, tz, rangeWindowDays("90d")),
    getPrsForRange(supabase, user.id, tz, rangeWindowDays("all")),
    getVolumeForRange(supabase, user.id, tz, rangeWindowDays("30d")),
    getVolumeForRange(supabase, user.id, tz, rangeWindowDays("90d")),
    getVolumeForRange(supabase, user.id, tz, rangeWindowDays("all")),
    getStrengthProgress(supabase, user.id, tz, strengthWindow("30d")),
    getStrengthProgress(supabase, user.id, tz, strengthWindow("90d")),
    getStrengthProgress(supabase, user.id, tz, strengthWindow("all")),
    getEnduranceProgress(supabase, user.id, tz, strengthWindow("30d")),
    getEnduranceProgress(supabase, user.id, tz, strengthWindow("90d")),
    getEnduranceProgress(supabase, user.id, tz, strengthWindow("all")),
  ]);

  const byRange: Record<Range, StatsRangeBucket> = {
    "30d": {
      adherence: adherence30d,
      prs: prs30d,
      volume: volume30d,
      strength: strength30d,
      endurance: endurance30d,
      verdict: getProgressVerdict(strength30d, endurance30d),
    },
    "90d": {
      adherence: adherence90d,
      prs: prs90d,
      volume: volume90d,
      strength: strength90d,
      endurance: endurance90d,
      verdict: getProgressVerdict(strength90d, endurance90d),
    },
    all: {
      adherence: adherenceAll,
      prs: prsAll,
      volume: volumeAll,
      strength: strengthAll,
      endurance: enduranceAll,
      verdict: getProgressVerdict(strengthAll, enduranceAll),
    },
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: "-0.01em" }}>Stats</h1>
        <p style={{ margin: "4px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          A command center — read the verdict up top, scan the tiles for detail.
        </p>
      </header>

      <StatsCommandCenter
        initialRange={range}
        byRange={byRange}
        block={block}
        readiness={readiness}
        streak={streak}
        rhythm={rhythm}
        freshness={freshness}
        bodyweight={bodyweight}
        decisionTrace={decisionTrace}
        units={units}
        formatProfile={formatProfile}
      />

      <DeepDiveLinks />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Bottom — deep-dive link grid (Phase 3 folds these into tile drawers)
// ──────────────────────────────────────────────────────────────────────

function DeepDiveLinks() {
  return (
    <section
      data-testid="stats-deep-dive-links"
      style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 4 }}
    >
      <DeepDive
        title="PRs & per-movement"
        body="Personal records, top sets, and per-lift e1RM history."
        href="/app/stats/prs"
      />
      <DeepDive
        title="Engine internals"
        body="Buckets, region freshness, RPE drift."
        href="/app/stats/engine"
      />
      <DeepDive
        title="Block outcomes"
        body="Past blocks + completion stats."
        href="/app/stats/blocks"
      />
      <DeepDive
        title="Adherence dashboard"
        body="Weekly completion, weekday breakdown, archetype mix, skip notes, streaks."
        href="/app/stats/adherence"
      />
    </section>
  );
}

function DeepDive({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <Link
      href={href}
      data-testid="stats-deep-dive"
      style={{
        display: "block",
        padding: 14,
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        background: "var(--cp-surface)",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14 }}>{title} →</div>
      <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 2 }}>{body}</div>
    </Link>
  );
}
