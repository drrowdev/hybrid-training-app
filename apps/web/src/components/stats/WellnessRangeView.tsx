"use client";

/**
 * /app/stats/wellness — client wrapper that owns the range toggle.
 *
 * Audit F2 measured 1.4–1.6s per range click under the old
 * `<Link href="?range=…">` pattern because every click re-ran auth +
 * the wellness/sessions queries. The underlying I/O returns the same
 * shape of data filtered to a date window, so we now read the widest
 * window once on the server, slice into per-range buckets, and let the
 * client pick which bucket to display from local state. Matches the
 * pattern PR #134 introduced on `PlanRedesign`.
 */
import { useCallback, useState } from "react";
import type { SessionWellnessRow, WellnessRow } from "@/lib/stats/wellness";
import {
  predictionPairsFromSessions,
  calcPredictionCorrelation,
  predictionStrength,
  linearTrendSeries,
} from "@/lib/stats/wellness";
import { displayWeight, weightUnitLabel, type WeightUnit } from "@/lib/stats/units";
import { DEFAULT_RANGE, RANGE_LABEL, type Range } from "@/lib/stats/range";
import { MiniLine } from "@/components/stats/charts/MiniLine";
import { MiniScatter } from "@/components/stats/charts/MiniScatter";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricHelp } from "@/components/ui/MetricHelp";

export type WellnessByRange = Record<
  Range,
  {
    wellness: WellnessRow[];
    sessions: SessionWellnessRow[];
  }
>;

export type WellnessRangeViewProps = {
  initialRange: Range;
  byRange: WellnessByRange;
  units: WeightUnit;
};

export function WellnessRangeView(props: WellnessRangeViewProps) {
  const { initialRange, byRange, units } = props;
  const [range, setRange] = useState<Range>(initialRange);

  const syncUrl = useCallback((next: Range) => {
    if (typeof window === "undefined") return;
    const url =
      next === DEFAULT_RANGE
        ? "/app/stats/wellness"
        : `/app/stats/wellness?range=${next}`;
    window.history.replaceState(null, "", url + window.location.hash);
  }, []);

  const onSelect = useCallback(
    (next: Range) => {
      setRange(next);
      syncUrl(next);
    },
    [syncUrl],
  );

  const current = byRange[range];

  return (
    <>
      <RangeToggle current={range} onSelect={onSelect} />
      <div
        data-testid="stats-wellness-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        <BodyweightCard rows={current.wellness} units={units} range={range} />
        <FatigueCard rows={current.sessions} range={range} />
        <SorenessCard rows={current.sessions} range={range} />
        <MotivationCard rows={current.wellness} range={range} />
      </div>
      <PredictionAccuracyCard rows={current.sessions} />
    </>
  );
}

function RangeToggle({
  current,
  onSelect,
}: {
  current: Range;
  onSelect: (next: Range) => void;
}) {
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
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            data-testid="stats-wellness-range-option"
            data-range={opt}
            data-active={active ? "true" : "false"}
            aria-pressed={active}
            style={{
              fontSize: 12,
              padding: "5px 12px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: active ? "var(--cp-accent)" : "var(--cp-text-muted)",
              background: active ? "var(--cp-accent-soft)" : "transparent",
            }}
          >
            {RANGE_LABEL[opt]}
          </button>
        );
      })}
    </nav>
  );
}

// ── A1 — Bodyweight ──────────────────────────────────────────────────

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
        <CardTitle title="Bodyweight" subtitle={`${unit} · ${subtitle}`} helpTerm="bodyweight_trend" />
        <EmptyState
          variant="inline"
          title="No bodyweight logged"
          body="Log bodyweight via the Today-page bodyweight prompt or in Settings → Preferences and your trend populates this card."
        />
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
  const rangeLabel = range === "all" ? "all-time" : range === "90d" ? "90d" : "30d";

  return (
    <Card testId="stats-wellness-bodyweight">
      <CardTitle title="Bodyweight" subtitle={`${unit} · ${subtitle}`} helpTerm="bodyweight_trend" />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {display} {unit}
        </span>
        {displayDelta != null && (
          <span
            style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
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

// ── A3 — Fatigue & Soreness ──────────────────────────────────────────

function FatigueCard({ rows, range }: { rows: SessionWellnessRow[]; range: Range }) {
  return (
    <PreCheckInLineCard
      rows={rows}
      pick={(r) => r.fatigue}
      title="Fatigue"
      subtitle={subtitleForRange(range)}
      ariaLabel="pre-session fatigue (1 fresh - 5 cooked)"
      testId="stats-wellness-fatigue"
      helpTerm="fatigue_score"
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
      helpTerm="soreness_score"
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
  helpTerm,
}: {
  rows: SessionWellnessRow[];
  pick: (r: SessionWellnessRow) => number | null;
  title: string;
  subtitle: string;
  ariaLabel: string;
  testId: string;
  helpTerm?: string;
}) {
  const values: number[] = [];
  for (const r of rows) {
    const v = pick(r);
    if (v != null) values.push(v);
  }
  if (values.length === 0) {
    return (
      <Card testId={testId} empty>
        <CardTitle title={title} subtitle={subtitle} helpTerm={helpTerm} />
        <EmptyState
          variant="inline"
          title={`No ${title.toLowerCase()} data`}
          body="Pre-session check-in not used yet — log fatigue + soreness before a session and this card populates."
        />
      </Card>
    );
  }
  const avg = round1(values.reduce((a, b) => a + b, 0) / values.length);
  const accent: "success" | "warning" | "danger" =
    avg <= 2 ? "success" : avg <= 3.5 ? "warning" : "danger";
  return (
    <Card testId={testId}>
      <CardTitle title={title} subtitle={subtitle} helpTerm={helpTerm} />
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
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>avg · 1–5 scale</span>
      </div>
      <MiniLine values={values} accent={accent} ariaLabel={ariaLabel} />
    </Card>
  );
}

// ── A4 — Motivation ──────────────────────────────────────────────────

function MotivationCard({ rows, range }: { rows: WellnessRow[]; range: Range }) {
  const values: number[] = [];
  for (const r of rows) {
    if (r.motivation != null) values.push(r.motivation);
  }
  if (values.length === 0) {
    return (
      <Card testId="stats-wellness-motivation" empty>
        <CardTitle title="Motivation" subtitle={subtitleForRange(range)} helpTerm="motivation_score" />
        <EmptyState
          variant="inline"
          title="No motivation logged"
          body="Daily motivation logging has been retired. Any historic entries still display here."
        />
      </Card>
    );
  }
  const avg = round1(values.reduce((a, b) => a + b, 0) / values.length);
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
      <CardTitle title="Motivation" subtitle={subtitleForRange(range)} helpTerm="motivation_score" />
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
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>avg · 1–5 scale</span>
      </div>
      <MiniLine
        values={values}
        accent={accent}
        ariaLabel={`motivation over the ${subtitleForRange(range)}`}
      />
    </Card>
  );
}

// ── A5 — Predicted vs Actual ─────────────────────────────────────────

function PredictionAccuracyCard({ rows }: { rows: SessionWellnessRow[] }) {
  const pairs = predictionPairsFromSessions(rows);
  const correlation = calcPredictionCorrelation(pairs);

  if (correlation == null) {
    return (
      <Card testId="stats-wellness-prediction" empty wide>
        <CardTitle title="How well do you predict your sessions?" subtitle="pre-check-in vs post-session sRPE" helpTerm="prediction_accuracy" />
        <EmptyState
          variant="inline"
          title="Not enough paired sessions"
          body="Need at least 10 sessions with both a pre-session check-in and a post-session RPE before this card can compute."
        />
      </Card>
    );
  }

  const strength = predictionStrength(correlation);
  const interp =
    Math.abs(correlation) >= 0.5
      ? "you read your body well — your gut-feel mostly matches how hard the session ends up feeling"
      : "your gut feel and the post-session reality often diverge — consider trusting the engine more, or logging more carefully";

  const points = pairs.map((p) => ({ x: p.pre, y: p.rpe }));

  return (
    <Card testId="stats-wellness-prediction" wide>
      <CardTitle
        title="How well do you predict your sessions?"
        subtitle="pre-check-in vs post-session sRPE"
        helpTerm="prediction_accuracy"
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

// ── Shared bits ──────────────────────────────────────────────────────

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

function CardTitle({ title, subtitle, helpTerm }: { title: string; subtitle?: string; helpTerm?: string }) {
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
        {helpTerm != null && <MetricHelp term={helpTerm} />}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
