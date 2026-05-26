/**
 * /app/stats — Stats overview dashboard (Phase 1 data-driven pass).
 *
 * Single landing page that summarises everything the engine has been
 * collecting (sessions, sets, RPE, wellness, motivation, PRs,
 * region freshness, block lifecycle).
 *
 * Above-the-fold cards: A (current block) / B (adherence) / C (PRs) /
 * D (region freshness) / F (volume) / G (bodyweight).
 * Bottom: deep-dive link grid. The existing /app/stats/engine and
 * /app/stats/movements/[slug] surfaces stay where they are — this page
 * just routes to them.
 *
 * Sleep card was removed in fix/sleep-walkback — manual sleep entry is
 * deferred to the future health-app integration (Apple Health /
 * Google Fit). The `wellness.sleep_hours` column remains for that
 * integration to back-fill.
 *
 * Design choices (documented in the PR body too):
 *  1. Skipped sessions count as MISSED in the 30-day adherence number
 *     (see `lib/stats/adherence.ts` for the long-form reasoning).
 *  2. Volume = pure tonnage (Σ weight × reps). Anything fancier moves
 *     to Phase 2+.
 *  3. Color semantics: green = fresh / improving, yellow = caution /
 *     primed, red = problem / heavily loaded, accent = current / featured.
 *  4. All queries run in parallel (`Promise.all`); each is bounded by
 *     a 30-day window or a top-N slice — no full-table scans.
 *  5. Comparison ranges are hardcoded (30 d adherence/volume,
 *     this calendar month for PRs). A range toggle is Phase 2+.
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
import { getTrainingHeatmap } from "@/lib/stats/training-heatmap-data";
import { TrainingHeatmap } from "@/components/stats/TrainingHeatmap";
import { type WeightUnit } from "@/lib/stats/units";
import { type ProfileForFormat } from "@/lib/format/datetime";
import { parseRange, rangeWindowDays } from "@/lib/stats/range";
import { StatsOverviewView, type StatsOverviewByRange } from "@/components/stats/StatsOverviewView";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

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

  // Pre-fetch all three range windows in one Promise.all so the
  // client-side toggle (StatsOverviewView) flips between buckets
  // without a server round-trip. Audit F1 measured 0.9–1.3s per click
  // under the old `<Link href="?range=…">` pattern. Block/freshness/
  // bodyweight/heatmap are range-invariant and read once.
  const [
    block,
    freshness,
    bodyweight,
    heatmapCells,
    adherence30d,
    adherence90d,
    adherenceAll,
    prs30d,
    prs90d,
    prsAll,
    volume30d,
    volume90d,
    volumeAll,
  ] = await Promise.all([
    getActiveBlockProgress(supabase, user.id, tz),
    getFreshnessMini(supabase, user.id),
    getBodyweightTrend(supabase, user.id, tz),
    getTrainingHeatmap(supabase, user.id, tz, 20),
    getAdherenceForWindow(supabase, user.id, tz, rangeWindowDays("30d")),
    getAdherenceForWindow(supabase, user.id, tz, rangeWindowDays("90d")),
    getAdherenceForWindow(supabase, user.id, tz, rangeWindowDays("all")),
    getPrsForRange(supabase, user.id, tz, rangeWindowDays("30d")),
    getPrsForRange(supabase, user.id, tz, rangeWindowDays("90d")),
    getPrsForRange(supabase, user.id, tz, rangeWindowDays("all")),
    getVolumeForRange(supabase, user.id, tz, rangeWindowDays("30d")),
    getVolumeForRange(supabase, user.id, tz, rangeWindowDays("90d")),
    getVolumeForRange(supabase, user.id, tz, rangeWindowDays("all")),
  ]);

  const byRange: StatsOverviewByRange = {
    "30d": { adherence: adherence30d, prs: prs30d, volume: volume30d },
    "90d": { adherence: adherence90d, prs: prs90d, volume: volume90d },
    all: { adherence: adherenceAll, prs: prsAll, volume: volumeAll },
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: "-0.01em" }}>Stats</h1>
        <p style={{ margin: "4px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Your dashboard — block progress, adherence, PRs, freshness, volume, bodyweight.
        </p>
      </header>

      {/* A — Current block strip */}
      <CurrentBlockStrip progress={block} />

      {/* Training calendar heatmap — last 20 weeks at a glance. */}
      <TrainingHeatmap cells={heatmapCells} weeks={20} />

      {/* Range toggle + B–G card grid — owned by a client component so
          flipping ranges is a state swap (audit F1). */}
      <StatsOverviewView
        initialRange={range}
        byRange={byRange}
        freshness={freshness}
        bodyweight={bodyweight}
        units={units}
        formatProfile={formatProfile}
      />

      {/* Bottom — deep-dive links */}
      <DeepDiveLinks />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────
// A — Current block strip
// ──────────────────────────────────────────────────────────────────────

function CurrentBlockStrip({
  progress,
}: {
  progress: Awaited<ReturnType<typeof getActiveBlockProgress>>;
}) {
  if (!progress) {
    return (
      <section
        className="cp-card"
        data-testid="stats-card-active-block"
        data-empty="true"
        style={{ padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <EmptyState
          variant="inline"
          title="No active block"
          body="Start a block and your weekly progression, adherence, and ceiling all light up here."
        />
        <Link
          href="/app/plan/new"
          data-testid="stats-active-block-cta"
          style={{ color: "var(--cp-accent)", fontSize: 13, textDecoration: "none", fontWeight: 600 }}
        >
          Start one →
        </Link>
      </section>
    );
  }
  const pct = progress.totalScheduled === 0
    ? 0
    : Math.min(100, Math.round((progress.scheduledToDate / progress.totalScheduled) * 100));
  return (
    <section
      className="cp-card"
      data-testid="stats-card-active-block"
      style={{ padding: 18, display: "grid", gap: 10 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Current block
          </div>
          <div style={{ fontSize: 18, marginTop: 4, fontWeight: 600 }}>
            You&rsquo;re on <span style={{ color: "var(--cp-accent)" }}>{progress.archetypeName}</span>
            {" · "}Week {progress.currentWeek} of {progress.weeks}
            {progress.daysPerWeek != null && (
              <>
                {" · "}Day {progress.currentDayInWeek} of {progress.daysPerWeek} days/week
              </>
            )}
          </div>
          <div style={{ fontSize: 13, color: "var(--cp-text-muted)", marginTop: 2 }}>
            <span data-testid="stats-active-block-completion">
              {progress.logged} of {progress.scheduledToDate} sessions logged
            </span>
            {progress.skipped > 0 && (
              <span style={{ marginLeft: 6, color: "var(--cp-warning)" }}>
                · {progress.skipped} skipped
              </span>
            )}
          </div>
        </div>
        <Link
          href="/app/plan/history"
          data-testid="stats-active-block-cta"
          style={{ color: "var(--cp-text-muted)", fontSize: 12, textDecoration: "none" }}
        >
          View block details →
        </Link>
      </div>
      <div
        aria-hidden="true"
        style={{ height: 6, borderRadius: 3, background: "var(--cp-surface-soft)", overflow: "hidden" }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--cp-accent)",
            transition: "width 0.3s",
          }}
        />
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Bottom — deep-dive link grid
// ──────────────────────────────────────────────────────────────────────

function DeepDiveLinks() {
  return (
    <section
      data-testid="stats-deep-dive-links"
      style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 4 }}
    >
      <DeepDive
        title="Per-movement stats"
        body="Top sets, history, e1RM trend."
        href="/app/stats#movements"
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
        title="Wellness dashboard"
        body="Bodyweight, fatigue, motivation, prediction accuracy."
        href="/app/stats/wellness"
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


