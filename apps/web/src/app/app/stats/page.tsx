/**
 * /app/stats — Stats overview dashboard (Phase 1 data-driven pass).
 *
 * Single landing page that summarises everything the engine has been
 * collecting (sessions, sets, RPE, wellness, sleep, motivation, PRs,
 * region freshness, block lifecycle).
 *
 * Above-the-fold cards: A (current block) / B (adherence) / C (PRs) /
 * D (region freshness) / E (sleep) / F (volume) / G (bodyweight).
 * Bottom: deep-dive link grid. The existing /app/stats/engine and
 * /app/stats/movements/[slug] surfaces stay where they are — this page
 * just routes to them.
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
 *  5. Comparison ranges are hardcoded (30 d adherence/volume, 7 d sleep,
 *     this calendar month for PRs). A range toggle is Phase 2+.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { getActiveBlockProgress } from "@/lib/stats/active-block-progress";
import { getAdherenceForWindow, type AdherenceResult } from "@/lib/stats/adherence";
import { getPrsForRange, type PrsRangeResult } from "@/lib/stats/prs-range";
import { getFreshnessMini, type FreshnessMiniRow } from "@/lib/stats/freshness-mini";
import { getSleepForRange, type SleepRangeResult } from "@/lib/stats/sleep-trend";
import { getVolumeForRange, type VolumeRangeResult } from "@/lib/stats/volume";
import { getBodyweightTrend, type BodyweightTrend } from "@/lib/stats/bodyweight-trend";
import { displayWeight, weightUnitLabel, type WeightUnit } from "@/lib/stats/units";
import {
  DEFAULT_RANGE,
  RANGE_LABEL,
  parseRange,
  rangeWindowDays,
  type Range,
} from "@/lib/stats/range";
import { Sparkline } from "@/components/stats/charts/Sparkline";
import { MiniBars } from "@/components/stats/charts/MiniBars";

export const dynamic = "force-dynamic";

export default async function StatsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const windowDays = rangeWindowDays(range);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("units, timezone")
    .eq("id", user.id)
    .maybeSingle();
  const units: WeightUnit = profile?.units === "imperial" ? "imperial" : "metric";
  const tz = profile?.timezone ?? (await getUserTimezone(user.id));

  // All-parallel reads. The four time-bounded cards (adherence / PRs /
  // sleep / volume) take the same `windowDays` so the toggle drives
  // them in lockstep; bodyweight + freshness stay on their existing
  // bounded reads (30-day trend / right-now snapshot).
  const [block, adherence, prs, freshness, sleep, volume, bodyweight] = await Promise.all([
    getActiveBlockProgress(supabase, user.id, tz),
    getAdherenceForWindow(supabase, user.id, tz, windowDays),
    getPrsForRange(supabase, user.id, tz, windowDays),
    getFreshnessMini(supabase, user.id),
    getSleepForRange(supabase, user.id, tz, windowDays),
    getVolumeForRange(supabase, user.id, tz, windowDays),
    getBodyweightTrend(supabase, user.id, tz),
  ]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: "-0.01em" }}>Stats</h1>
        <p style={{ margin: "4px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Your dashboard — block progress, adherence, PRs, freshness, sleep, volume, bodyweight.
        </p>
      </header>

      {/* A — Current block strip */}
      <CurrentBlockStrip progress={block} />

      {/* Range toggle — drives adherence / PRs / sleep / volume queries */}
      <RangeToggle current={range} />

      {/* B–G — responsive card grid */}
      <div
        data-testid="stats-overview-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        <AdherenceCard data={adherence} range={range} />
        <PrsCard data={prs} units={units} range={range} />
        <FreshnessCard rows={freshness} />
        <SleepCard data={sleep} range={range} />
        <VolumeCard data={volume} units={units} range={range} />
        <BodyweightCard data={bodyweight} units={units} />
      </div>

      {/* Bottom — deep-dive links */}
      <DeepDiveLinks />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Range toggle (Phase 2)
// ──────────────────────────────────────────────────────────────────────

function RangeToggle({ current }: { current: Range }) {
  const opts: Range[] = ["30d", "90d", "all"];
  return (
    <nav
      data-testid="stats-range-toggle"
      aria-label="Range"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 3,
        borderRadius: 999,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
        width: "fit-content",
      }}
    >
      {opts.map((opt) => {
        const active = opt === current;
        // Default range = 30d, so omit the query param when picking it
        // (keeps the canonical URL clean on initial load).
        const href = opt === DEFAULT_RANGE ? "/app/stats" : `/app/stats?range=${opt}`;
        return (
          <Link
            key={opt}
            href={href}
            data-testid="stats-range-option"
            data-range={opt}
            data-active={active ? "true" : "false"}
            scroll={false}
            style={{
              fontSize: 12,
              padding: "5px 12px",
              borderRadius: 999,
              textDecoration: "none",
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: active ? "var(--cp-accent)" : "var(--cp-text-muted)",
              background: active ? "var(--cp-accent-soft)" : "transparent",
            }}
          >
            {RANGE_LABEL[opt]}
          </Link>
        );
      })}
    </nav>
  );
}

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
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Current block
          </div>
          <div style={{ fontSize: 16, marginTop: 4 }}>No active block.</div>
        </div>
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
// B — Adherence (30 days)
// ──────────────────────────────────────────────────────────────────────

function AdherenceCard({ data, range }: { data: AdherenceResult; range: Range }) {
  const pct = Math.round(data.ratio * 100);
  const accent = data.ratio >= 0.8 ? "success" : data.ratio >= 0.5 ? "warning" : "danger";
  const accentVar = `var(--cp-${accent})`;
  const subtitle =
    range === "all" ? "all-time" : range === "90d" ? "last 90 days" : "last 30 days";
  return (
    <section
      className="cp-card"
      data-testid="stats-card-adherence"
      data-empty={data.scheduled === 0 ? "true" : "false"}
      style={{ padding: 16, display: "grid", gap: 6 }}
    >
      <CardTitle title="Adherence" subtitle={subtitle} />
      {data.scheduled === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
          Nothing scheduled in this window yet — once a block is live,
          this card tracks how many planned sessions you actually log.
        </p>
      ) : (
        <>
          <div style={{ fontSize: 28, fontWeight: 700, color: accentVar, letterSpacing: "-0.01em" }}>
            {pct}%
          </div>
          <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            {data.completed} of {data.scheduled} sessions
            {data.skipped > 0 && <> · {data.skipped} counted as missed (skipped)</>}
          </div>
        </>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// C — PRs this month
// ──────────────────────────────────────────────────────────────────────

function PrsCard({ data, units, range }: { data: PrsRangeResult; units: WeightUnit; range: Range }) {
  const unit = weightUnitLabel(units);
  const title =
    range === "all" ? "PRs (all-time)" : range === "90d" ? "PRs (last 90 days)" : "PRs (last 30 days)";
  return (
    <section
      className="cp-card"
      data-testid="stats-card-prs"
      data-empty={data.uniqueMovementCount === 0 ? "true" : "false"}
      style={{ padding: 16, display: "grid", gap: 8 }}
    >
      <CardTitle
        title={title}
        subtitle={`${data.uniqueMovementCount} ${data.uniqueMovementCount === 1 ? "lift" : "lifts"}`}
      />
      {data.uniqueMovementCount === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
          No PRs in this window yet — your turn.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {data.topThree.map((p) => (
            <li
              key={`${p.movementId}-${p.date}`}
              data-testid="stats-pr-row"
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 13,
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.movementSlug ? (
                  <Link
                    href={`/app/stats/movements/${p.movementSlug}`}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    {p.movementDisplayName}
                  </Link>
                ) : (
                  p.movementDisplayName
                )}
              </span>
              <span className="mono" style={{ flexShrink: 0, color: "var(--cp-text-muted)" }}>
                {round1(displayWeight(p.weight, units))} {unit} × {p.reps}
                {" · "}
                {formatDay(p.date)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// D — Region freshness mini
// ──────────────────────────────────────────────────────────────────────

function FreshnessCard({ rows }: { rows: FreshnessMiniRow[] }) {
  const colorByAccent: Record<FreshnessMiniRow["accent"], string> = {
    success: "var(--cp-success)",
    warning: "var(--cp-warning)",
    danger: "var(--cp-danger)",
  };
  return (
    <section
      className="cp-card"
      data-testid="stats-card-freshness"
      data-empty={rows.length === 0 ? "true" : "false"}
      style={{ padding: 16, display: "grid", gap: 8 }}
    >
      <CardTitle
        title="Region freshness"
        subtitle="right now"
        right={
          <Link
            href="/app/stats/engine"
            data-testid="stats-freshness-cta"
            style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
          >
            Engine details →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
          No region load yet. Log a session to see freshness build up.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {rows.map((r) => {
            const pct = Math.round(r.freshness * 100);
            const color = colorByAccent[r.accent];
            return (
              <li
                key={r.region}
                data-testid="stats-freshness-row"
                title={`${r.regionLabel}: ${pct}% fresh`}
                style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", fontSize: 12 }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.regionLabel}
                </span>
                <div
                  aria-hidden="true"
                  style={{ width: 80, height: 6, background: "var(--cp-surface-soft)", borderRadius: 3, overflow: "hidden" }}
                >
                  <div style={{ width: `${pct}%`, height: "100%", background: color }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// E — Sleep (last 7 nights)
// ──────────────────────────────────────────────────────────────────────

function SleepCard({ data, range }: { data: SleepRangeResult; range: Range }) {
  const subtitle =
    range === "all" ? "all-time" : range === "90d" ? "last 90 days" : "last 30 days";
  return (
    <section
      className="cp-card"
      data-testid="stats-card-sleep"
      data-empty={data.avgHours == null ? "true" : "false"}
      style={{ padding: 16, display: "grid", gap: 8 }}
    >
      <CardTitle title="Sleep" subtitle={subtitle} />
      {data.avgHours == null ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
          Track sleep to see patterns — the pre-session chip on the next
          check-in is the fastest way.
        </p>
      ) : (
        <>
          <div style={{ fontSize: 22, fontWeight: 600 }}>
            {data.avgHours.toFixed(1)}h <span style={{ fontSize: 12, color: "var(--cp-text-muted)", fontWeight: 400 }}>avg</span>
          </div>
          <MiniBars
            values={data.series.map((n) => n.hours)}
            max={10}
            accent="accent"
            ariaLabel="sleep hours per night in the selected window"
          />
        </>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// F — Volume (30 days, weekly buckets)
// ──────────────────────────────────────────────────────────────────────

function VolumeCard({ data, units, range }: { data: VolumeRangeResult; units: WeightUnit; range: Range }) {
  const unit = weightUnitLabel(units);
  const totalDisplay = displayWeight(data.totalKg, units);
  const weeklyDisplay = data.weeklyKg.map((kg) => displayWeight(kg, units));
  const subtitle =
    range === "all"
      ? `${unit} · all-time (${data.weeklyKg.length} wk)`
      : range === "90d"
      ? `${unit} · last 90 days`
      : `${unit} · last 30 days`;
  return (
    <section
      className="cp-card"
      data-testid="stats-card-volume"
      data-empty={data.totalKg === 0 ? "true" : "false"}
      style={{ padding: 16, display: "grid", gap: 8 }}
    >
      <CardTitle
        title="Volume"
        subtitle={subtitle}
        right={
          <Link
            href="/app/stats#movements"
            data-testid="stats-volume-cta"
            style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
          >
            By movement →
          </Link>
        }
      />
      {data.totalKg === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
          No strength sets logged in this window yet.
        </p>
      ) : (
        <>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {formatTonnage(totalDisplay)} {unit}
          </div>
          <MiniBars
            values={weeklyDisplay}
            accent="accent"
            ariaLabel={`weekly tonnage for the last ${data.weeklyKg.length} weeks`}
          />
        </>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// G — Bodyweight trend
// ──────────────────────────────────────────────────────────────────────

function BodyweightCard({ data, units }: { data: BodyweightTrend; units: WeightUnit }) {
  const unit = weightUnitLabel(units);
  if (!data.latest) {
    return (
      <section
        className="cp-card"
        data-testid="stats-card-bodyweight"
        data-empty="true"
        style={{ padding: 16, display: "grid", gap: 8 }}
      >
        <CardTitle title="Bodyweight" subtitle={`${unit} · 30 d trend`} />
        <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
          Log your bodyweight to see the trend. The Today nudge or the
          settings page both work.
        </p>
      </section>
    );
  }
  const latest = displayWeight(data.latest.kg, units);
  const delta = data.delta30dKg == null ? null : displayWeight(data.delta30dKg, units);
  const accent: "success" | "warning" | "danger" | "accent" =
    delta == null
      ? "accent"
      : delta > 0
      ? "warning"
      : delta < 0
      ? "success"
      : "accent";
  return (
    <section
      className="cp-card"
      data-testid="stats-card-bodyweight"
      style={{ padding: 16, display: "grid", gap: 8 }}
    >
      <CardTitle title="Bodyweight" subtitle={`${unit} · 30 d trend`} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 600 }}>
          {round1(latest)} {unit}
        </span>
        {delta != null && (
          <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            {delta > 0 ? "+" : ""}
            {round1(delta)} {unit} (30 d)
          </span>
        )}
      </div>
      <Sparkline
        values={data.series.map((p) => displayWeight(p.kg, units))}
        accent={accent}
        ariaLabel="bodyweight over the last 30 days"
      />
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
        body="Bodyweight, sleep, fatigue, motivation, prediction accuracy."
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

// Note: a `DeepDivePlaceholder` lived here through Phase 3 to advertise
// the Phase 4 adherence dashboard. With that dashboard now live, every
// deep-dive card on the overview links to a live page.



// ──────────────────────────────────────────────────────────────────────
// Shared bits
// ──────────────────────────────────────────────────────────────────────

function CardTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      <div>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {right}
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatTonnage(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return Math.round(n).toLocaleString();
}

function formatDay(ymd: string): string {
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  const monthShort = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][m - 1];
  return `${monthShort} ${d}`;
}
