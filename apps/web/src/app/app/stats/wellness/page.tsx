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
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import {
  DEFAULT_RANGE,
  RANGE_LABEL,
  parseRange,
  rangeWindowDays,
  type Range,
} from "@/lib/stats/range";
import {
  getSessionWellness,
  getWellnessTimeseries,
  predictionPairsFromSessions,
  calcPredictionCorrelation,
  predictionStrength,
  linearTrendSeries,
  type SessionWellnessRow,
  type WellnessRow,
} from "@/lib/stats/wellness";
import { displayWeight, weightUnitLabel, type WeightUnit } from "@/lib/stats/units";
import { MiniLine } from "@/components/stats/charts/MiniLine";
import { MiniScatter } from "@/components/stats/charts/MiniScatter";

export const dynamic = "force-dynamic";

export default async function StatsWellnessPage({
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

  const [wellness, sessions] = await Promise.all([
    getWellnessTimeseries(supabase, user.id, tz, windowDays),
    getSessionWellness(supabase, user.id, tz, windowDays),
  ]);

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

      <RangeToggle current={range} />

      <div
        data-testid="stats-wellness-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        <BodyweightCard rows={wellness} units={units} range={range} />
        <FatigueCard rows={sessions} range={range} />
        <SorenessCard rows={sessions} range={range} />
        <MotivationCard rows={wellness} range={range} />
      </div>

      <PredictionAccuracyCard rows={sessions} />

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
// Range toggle (URL-param like Phase 2)
// ──────────────────────────────────────────────────────────────────────

function RangeToggle({ current }: { current: Range }) {
  const opts: Range[] = ["30d", "90d", "all"];
  return (
    <nav
      data-testid="stats-wellness-range-toggle"
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
        const href =
          opt === DEFAULT_RANGE ? "/app/stats/wellness" : `/app/stats/wellness?range=${opt}`;
        return (
          <Link
            key={opt}
            href={href}
            data-testid="stats-wellness-range-option"
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
// A1 — Bodyweight
// ──────────────────────────────────────────────────────────────────────

function BodyweightCard({
  rows,
  units,
  range,
}: {
  rows: WellnessRow[];
  units: WeightUnit;
  range: Range;
}) {
  const unit = weightUnitLabel(units);
  const series = rows.filter((r) => r.bodyweight_kg != null) as Array<
    WellnessRow & { bodyweight_kg: number }
  >;
  const subtitle =
    range === "all" ? "all-time" : range === "90d" ? "last 90 days" : "last 30 days";

  if (series.length === 0) {
    return (
      <Card testId="stats-wellness-bodyweight" empty>
        <CardTitle title="Bodyweight" subtitle={`${unit} · ${subtitle}`} />
        <EmptyText>Log bodyweight on the Today page to see your trend</EmptyText>
      </Card>
    );
  }

  const latest = series[series.length - 1].bodyweight_kg;
  const start = series[0].bodyweight_kg;
  const deltaKg = series.length >= 2 ? latest - start : null;
  const display = round1(displayWeight(latest, units));
  const displayDelta = deltaKg == null ? null : round1(displayWeight(deltaKg, units));

  const valuesDisplay = series.map((r) => displayWeight(r.bodyweight_kg, units));
  const trend = linearTrendSeries(valuesDisplay) ?? undefined;
  const rangeLabel =
    range === "all" ? "all-time" : range === "90d" ? "90d" : "30d";

  return (
    <Card testId="stats-wellness-bodyweight">
      <CardTitle title="Bodyweight" subtitle={`${unit} · ${subtitle}`} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {display} {unit}
        </span>
        {displayDelta != null && (
          <span
            style={{
              fontSize: 12,
              color: "var(--cp-text-muted)",
            }}
            data-testid="stats-wellness-bodyweight-delta"
          >
            {displayDelta > 0 ? "+" : ""}
            {displayDelta} {unit} ({rangeLabel})
          </span>
        )}
      </div>
      <MiniLine
        values={valuesDisplay}
        overlay={trend}
        accent="accent"
        ariaLabel={`bodyweight over the ${subtitle}`}
      />
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// A3 — Fatigue & Soreness (two cards)
// ──────────────────────────────────────────────────────────────────────

function FatigueCard({ rows, range }: { rows: SessionWellnessRow[]; range: Range }) {
  return (
    <PreCheckInLineCard
      rows={rows}
      pick={(r) => r.fatigue}
      title="Fatigue"
      subtitle={subtitleForRange(range)}
      ariaLabel="pre-session fatigue (1 fresh - 5 cooked)"
      testId="stats-wellness-fatigue"
    />
  );
}

function SorenessCard({ rows, range }: { rows: SessionWellnessRow[]; range: Range }) {
  return (
    <PreCheckInLineCard
      rows={rows}
      pick={(r) => r.soreness}
      title="Soreness"
      subtitle={subtitleForRange(range)}
      ariaLabel="pre-session soreness (1 none - 5 severe)"
      testId="stats-wellness-soreness"
    />
  );
}

function PreCheckInLineCard({
  rows,
  pick,
  title,
  subtitle,
  ariaLabel,
  testId,
}: {
  rows: SessionWellnessRow[];
  pick: (r: SessionWellnessRow) => number | null;
  title: string;
  subtitle: string;
  ariaLabel: string;
  testId: string;
}) {
  const values: number[] = [];
  for (const r of rows) {
    const v = pick(r);
    if (v != null) values.push(v);
  }
  if (values.length === 0) {
    return (
      <Card testId={testId} empty>
        <CardTitle title={title} subtitle={subtitle} />
        <EmptyText>Pre-session check-in not used yet — try it tomorrow</EmptyText>
      </Card>
    );
  }
  const avg = round1(values.reduce((a, b) => a + b, 0) / values.length);
  // High values = bad on both 1..5 scales.
  const accent: "success" | "warning" | "danger" =
    avg <= 2 ? "success" : avg <= 3.5 ? "warning" : "danger";
  return (
    <Card testId={testId}>
      <CardTitle title={title} subtitle={subtitle} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: `var(--cp-${accent})`,
          }}
        >
          {avg}
        </span>
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          avg · 1–5 scale
        </span>
      </div>
      <MiniLine values={values} accent={accent} ariaLabel={ariaLabel} />
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// A4 — Motivation
// ──────────────────────────────────────────────────────────────────────

function MotivationCard({ rows, range }: { rows: WellnessRow[]; range: Range }) {
  const values: number[] = [];
  for (const r of rows) {
    if (r.motivation != null) values.push(r.motivation);
  }
  if (values.length === 0) {
    return (
      <Card testId="stats-wellness-motivation" empty>
        <CardTitle title="Motivation" subtitle={subtitleForRange(range)} />
        <EmptyText>
          Track motivation on daily check-ins to see your patterns
        </EmptyText>
      </Card>
    );
  }
  const avg = round1(values.reduce((a, b) => a + b, 0) / values.length);
  // Direction: compare last value with the value ~1/3 of the way back —
  // a single-step diff is too noisy on a 1-5 scale.
  const direction: "up" | "down" | "flat" = (() => {
    if (values.length < 2) return "flat";
    const tailIdx = Math.max(0, Math.floor(values.length * 0.66));
    const recent = values[values.length - 1];
    const earlier = values[tailIdx];
    if (recent > earlier) return "up";
    if (recent < earlier) return "down";
    return "flat";
  })();
  const accent: "success" | "warning" | "accent" =
    direction === "up" ? "success" : direction === "down" ? "warning" : "accent";
  return (
    <Card testId="stats-wellness-motivation">
      <CardTitle title="Motivation" subtitle={subtitleForRange(range)} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: `var(--cp-${accent})`,
          }}
        >
          {avg}
        </span>
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          avg · 1–5 scale
        </span>
      </div>
      <MiniLine
        values={values}
        accent={accent}
        ariaLabel={`motivation over the ${subtitleForRange(range)}`}
      />
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// A5 — Predicted vs Actual
// ──────────────────────────────────────────────────────────────────────

function PredictionAccuracyCard({ rows }: { rows: SessionWellnessRow[] }) {
  const pairs = predictionPairsFromSessions(rows);
  const correlation = calcPredictionCorrelation(pairs);

  if (correlation == null) {
    return (
      <Card testId="stats-wellness-prediction" empty wide>
        <CardTitle
          title="How well do you predict your sessions?"
          subtitle="pre-check-in vs post-session sRPE"
        />
        <EmptyText>
          Need at least 10 sessions with both pre-check-in and
          post-session RPE
        </EmptyText>
      </Card>
    );
  }

  const strength = predictionStrength(correlation);
  const interp =
    Math.abs(correlation) >= 0.5
      ? "you read your body well — your gut-feel mostly matches how hard the session ends up feeling"
      : "your gut feel and the post-session reality often diverge — consider trusting the engine more, or logging more carefully";

  // Scatter points: x = pre (fatigue + soreness, 2..10), y = sRPE (0..10).
  // Span both axes 0..10 so the y=x reference line is unambiguous.
  const points = pairs.map((p) => ({ x: p.pre, y: p.rpe }));

  return (
    <Card testId="stats-wellness-prediction" wide>
      <CardTitle
        title="How well do you predict your sessions?"
        subtitle="pre-check-in vs post-session sRPE"
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          data-testid="stats-wellness-prediction-correlation"
          style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}
        >
          Prediction accuracy: {correlation.toFixed(2)}
        </span>
        <span
          data-testid="stats-wellness-prediction-strength"
          style={{ fontSize: 13, color: "var(--cp-text-muted)" }}
        >
          ({strength}, n={pairs.length})
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>{interp}</p>
      <MiniScatter
        points={points}
        xMin={0}
        xMax={10}
        yMin={0}
        yMax={10}
        referenceLine={[0, 0, 10, 10]}
        accent="accent"
        xLabel="pre-session (fatigue + soreness)"
        yLabel="post-session sRPE"
        ariaLabel="scatter of pre-session combined fatigue+soreness vs post-session sRPE; dashed reference line is the perfect-prediction y=x"
      />
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared bits
// ──────────────────────────────────────────────────────────────────────

function subtitleForRange(range: Range): string {
  return range === "all" ? "all-time" : range === "90d" ? "last 90 days" : "last 30 days";
}

function Card({
  testId,
  empty,
  wide,
  children,
}: {
  testId: string;
  empty?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className="cp-card"
      data-testid={testId}
      data-empty={empty ? "true" : "false"}
      style={{
        padding: 16,
        display: "grid",
        gap: 8,
        gridColumn: wide ? "1 / -1" : undefined,
      }}
    >
      {children}
    </section>
  );
}

function CardTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>{children}</p>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
