/**
 * /app/stats — command-center overview (Direction C2 redesign).
 *
 * The single landing page for everything the engine collects. A hero
 * verdict band (progress · readiness · consistency) sits over a bento of
 * focused tiles (strength, endurance, recovery & load, consistency &
 * balance, bodyweight, training volume). The previous flat card grid and
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
 *    region freshness, bodyweight) read once.
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
import { type WeightUnit } from "@/lib/stats/units";
import { type ProfileForFormat } from "@/lib/format/datetime";
import { parseRange, rangeWindowDays, type Range } from "@/lib/stats/range";
import {
  StatsCommandCenter,
  type StatsRangeBucket,
} from "@/components/stats/StatsCommandCenter";
import { PageHeader } from "@/components/ui/PageHeader";

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

  const strengthRelevant =
    Boolean(block?.planStrength) || volumeAll.totalKg > 0 || strengthAll.perLift.length > 0;
  const cardioRelevant =
    Boolean(block?.planCardio) || enduranceAll.direction !== "no-run-data";

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <PageHeader
        title="Stats"
        subtitle="Your training at a glance — where strength and endurance are trending, how recovered you are, and whether you're showing up."
      />

      <StatsCommandCenter
        initialRange={range}
        byRange={byRange}
        block={block}
        readiness={readiness}
        streak={streak}
        rhythm={rhythm}
        freshness={freshness}
        bodyweight={bodyweight}
        units={units}
        formatProfile={formatProfile}
        relevance={{ strength: strengthRelevant, cardio: cardioRelevant }}
      />

      <DeepDiveLinks showEngine={Boolean(block?.usesAdaptiveEngine)} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Bottom — slim deep-dive footer. Tiles now open drawers for depth; these
// stay as a low-emphasis index to the full subpages (each drawer is a
// summary + a deep link, so the full pages still need an entry point).
//
// The "Adaptive engine" chip only appears for blocks the adaptive engine
// actually drives (the built-in Hybrid generator / legacy archetype blocks).
// Foreign platform programs run fixed templates, so that page is noise for
// them — see `usesAdaptiveEngine` on ActiveBlockProgress.
// ──────────────────────────────────────────────────────────────────────

function DeepDiveLinks({ showEngine }: { showEngine: boolean }) {
  const links: Array<{ label: string; href: string }> = [
    { label: "PRs & per-movement", href: "/app/stats/prs" },
    ...(showEngine
      ? [{ label: "Adaptive engine", href: "/app/stats/engine" }]
      : []),
    { label: "Block analytics", href: "/app/stats/blocks" },
    { label: "Consistency details", href: "/app/stats/adherence" },
  ];
  return (
    <section
      data-testid="stats-deep-dive-links"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px 14px",
        marginTop: 8,
        paddingTop: 14,
        borderTop: "1px solid var(--cp-border)",
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "var(--cp-text-muted)", fontWeight: 600 }}>Full pages</span>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          data-testid="stats-deep-dive"
          className="cp-chip"
        >
          {l.label}
        </Link>
      ))}
    </section>
  );
}
