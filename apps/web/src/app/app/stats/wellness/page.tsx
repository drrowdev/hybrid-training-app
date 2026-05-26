/**
 * /app/stats/wellness — Wellness dashboard.
 *
 * Sections (mobile-first stack, 2-col on tablet+, 3-col on desktop):
 *
 *   A1 Bodyweight — latest value + delta from start of range, daily
 *     line with a thin regression-trend overlay. Unit follows
 *     profile.units (kg/lb).
 *   A3 Fatigue & soreness — two cards. Mean value in range + line
 *     chart over time. HIGH values are red on both (1=fresh/none,
 *     5=cooked/severe). Pulled from sessions (DC-P1).
 *   A4 Motivation — avg + line chart, accent colour follows the
 *     latest direction (rising = success, falling = warning).
 *   A5 Predicted vs Actual — scatter of pre-session fatigue+soreness
 *     against post-session sRPE (DC-A2). Pearson correlation labelled
 *     weak / moderate / strong / very strong per spec. Requires n>=10
 *     paired sessions to render.
 *
 * Section A2 ("Sleep") was removed in fix/sleep-walkback — manual
 * sleep entry is deferred to the future health-app integration. The
 * `wellness.sleep_hours` column remains for the integration to
 * back-fill; the dashboard will gain a sleep section once that data
 * source returns. Section ids (A1, A3, A4, A5) are intentionally
 * left non-contiguous to make the gap explicit.
 *
 * The page reuses Phase 1+2 conventions:
 *   - `?range=30d|90d|all` parses through `parseRange`.
 *   - Cards use `cp-card` + the Clawpilot semantic palette tokens.
 *   - All queries run in parallel and read only the user's own rows
 *     (RLS-enforced).
 *
 * Methodology purity: no external program names appear in any string.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import {
  parseRange,
  type Range,
} from "@/lib/stats/range";
import {
  getSessionWellness,
  getWellnessTimeseries,
} from "@/lib/stats/wellness";
import { type WeightUnit } from "@/lib/stats/units";
import { getWeeklyRecoveryRollup, type WeeklyRecoveryRow } from "@/lib/engine/recovered-weeks";
import { isRecoveredWeek } from "@hta/engine";
import { getMuscleFreshness } from "@/lib/muscle/muscle-freshness";
import { MuscleGrid16 } from "@/components/muscle-grid/MuscleGrid16";
import { WellnessRangeView, type WellnessByRange } from "@/components/stats/WellnessRangeView";
import { addDaysToYmd, todayYmd } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function StatsWellnessPage({
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
    .select("units, timezone")
    .eq("id", user.id)
    .maybeSingle();
  const units: WeightUnit = profile?.units === "imperial" ? "imperial" : "metric";
  const tz = profile?.timezone ?? (await getUserTimezone(user.id));

  // Read the widest window once and pre-slice into the three range
  // buckets the client toggle picks between. Audit F2 measured
  // 1.4–1.6s per click under the old `<Link href="?range=…">` pattern
  // because every click ran auth + both timeseries queries again.
  const [wellnessAll, sessionsAll, recoveryRollup, muscleFreshness] = await Promise.all([
    getWellnessTimeseries(supabase, user.id, tz, null),
    getSessionWellness(supabase, user.id, tz, null),
    getWeeklyRecoveryRollup(supabase, user.id, { weeks: 12, tz }),
    getMuscleFreshness(supabase, user.id, { tz }),
  ]);

  const today = todayYmd(tz);
  const cutoff30 = addDaysToYmd(today, -29);
  const cutoff90 = addDaysToYmd(today, -89);
  // Sessions store an ISO timestamptz; compare with the ISO prefix.
  const iso30 = `${cutoff30}T00:00:00Z`;
  const iso90 = `${cutoff90}T00:00:00Z`;
  const byRange: WellnessByRange = {
    "30d": {
      wellness: wellnessAll.filter((r) => r.date >= cutoff30),
      sessions: sessionsAll.filter((r) => r.performed_at >= iso30),
    },
    "90d": {
      wellness: wellnessAll.filter((r) => r.date >= cutoff90),
      sessions: sessionsAll.filter((r) => r.performed_at >= iso90),
    },
    all: { wellness: wellnessAll, sessions: sessionsAll },
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <Link
          href="/app/stats"
          data-testid="stats-wellness-back"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ← stats
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          Wellness
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Bodyweight, fatigue, soreness, motivation, and how
          well your pre-session gut-feel predicts post-session
          difficulty.
        </p>
      </header>

      {/* Client component owns the range toggle + range-dependent cards
          so the per-click cost goes from 1.4–1.6s of server round-trip
          to local state. Recovered weeks + muscle freshness are
          range-invariant and render below. */}
      <WellnessRangeView initialRange={range} byRange={byRange} units={units} />

      <div
        data-testid="stats-wellness-grid-static"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        <RecoveredWeeksCard rollup={recoveryRollup} />
      </div>

      <section
        data-testid="stats-wellness-muscle-grid-card"
        style={{
          padding: 16,
          border: "1px solid var(--cp-border)",
          borderRadius: 10,
          background: "var(--cp-surface)",
          display: "grid",
          gap: 10,
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Muscle freshness</h2>
          <Link
            href="/app/freshness"
            data-testid="stats-wellness-freshness-link"
            style={{ fontSize: 12, color: "var(--cp-accent)", textDecoration: "none" }}
          >
            Open full grid →
          </Link>
        </header>
        <MuscleGrid16 rows={muscleFreshness} />
      </section>

      <footer
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 4,
        }}
      >
        <Link
          href="/app/stats"
          data-testid="stats-wellness-overview-link"
          style={{ color: "var(--cp-text-muted)", fontSize: 13, textDecoration: "none" }}
        >
          ← Stats overview
        </Link>
        <Link
          href="/app/stats/engine"
          data-testid="stats-wellness-engine-link"
          style={{ color: "var(--cp-accent)", fontSize: 13, textDecoration: "none" }}
        >
          View region freshness →
        </Link>
      </footer>
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────
// Recovered weeks (DC-K1)
// ──────────────────────────────────────────────────────────────────────


function RecoveredWeeksCard({ rollup }: { rollup: WeeklyRecoveryRow[] }) {
  // DC-K1 — count weeks that qualify as recovered across the 12-week lookback.
  const qualified = rollup.map((w) => ({ week: w, q: isRecoveredWeek(w) }));
  const total = qualified.length;
  const recovered = qualified.filter((q) => q.q.isRecovered).length;
  const tone: "ok" | "warning" | "danger" =
    recovered >= 8 ? "ok" : recovered >= 5 ? "warning" : "danger";
  const accent =
    tone === "ok"
      ? "var(--cp-success, var(--cp-accent))"
      : tone === "warning"
        ? "var(--cp-warning, var(--cp-text))"
        : "var(--cp-danger, var(--cp-text))";

  return (
    <section
      className="cp-card"
      data-testid="stats-wellness-recovered-weeks"
      data-tone={tone}
      data-recovered-count={recovered}
      data-total-weeks={total}
      style={{ padding: 16, display: "grid", gap: 8 }}
    >
      <h3 style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
        Recovered weeks{" "}
        <span className="cp-info" tabIndex={0} aria-label="What counts as recovered?">
          i
          <span className="pop" style={{ width: 280 }}>
            A week is recovered when every planned session is either logged
            or intentionally skipped. Recovered weeks build the ceiling.
          </span>
        </span>
      </h3>
      <div
        data-testid="stats-wellness-recovered-summary"
        style={{ fontSize: 24, fontWeight: 700, color: accent }}
      >
        {recovered} <span style={{ color: "var(--cp-text-muted)", fontSize: 14, fontWeight: 500 }}>of last {total}</span>
      </div>
      <details
        data-testid="stats-wellness-recovered-details"
        style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
      >
        <summary style={{ cursor: "pointer" }}>
          {recovered === total ? "Every week qualified" : "See each week's reason"}
        </summary>
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 2 }}>
          {qualified.map(({ week, q }) => (
            <li
              key={week.weekStart}
              data-testid="stats-wellness-recovered-row"
              data-recovered={q.isRecovered ? "true" : "false"}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "2px 0",
                borderBottom: "1px dashed var(--cp-border)",
              }}
            >
              <span className="mono">
                {q.isRecovered ? "✓" : "·"} {week.weekStart}
              </span>
              <span style={{ textAlign: "right", color: q.isRecovered ? "var(--cp-text)" : "var(--cp-text-muted)" }}>
                {q.reason}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <p style={{ margin: 0, fontSize: 11, color: "var(--cp-text-muted)", fontStyle: "italic" }}>
        Feeds the ceiling base.
      </p>
    </section>
  );
}