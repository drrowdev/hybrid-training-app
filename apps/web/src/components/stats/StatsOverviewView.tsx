"use client";

/**
 * /app/stats overview — client wrapper that owns the range toggle.
 *
 * Mirrors the pattern PR #134 introduced on `/app/plan` (PlanRedesign):
 * server renders the page shell + the range-invariant cards, and
 * pre-fetches the three range-dependent buckets in one Promise.all
 * (30d / 90d / all). This component owns local `useState` for the
 * currently-displayed range, swaps cards from the precomputed record,
 * and syncs the URL via `history.replaceState` so deep-links + reload
 * still land on the right bucket. No router navigation, no DB round
 * trip per click — the audit measured 0.9–1.3s per `<Link>`-driven
 * toggle on this surface (audit F1).
 *
 * The range-invariant freshness + bodyweight cards live inside this
 * component too so they can share the same responsive grid.
 */
import Link from "next/link";
import { useCallback, useState } from "react";
import type { AdherenceResult } from "@/lib/stats/adherence";
import type { PrsRangeResult } from "@/lib/stats/prs-range";
import type { VolumeRangeResult } from "@/lib/stats/volume";
import type { FreshnessMiniRow } from "@/lib/stats/freshness-mini";
import type { BodyweightTrend } from "@/lib/stats/bodyweight-trend";
import { displayWeight, weightUnitLabel, type WeightUnit } from "@/lib/stats/units";
import { formatDate, type ProfileForFormat } from "@/lib/format/datetime";
import { DEFAULT_RANGE, RANGE_LABEL, type Range } from "@/lib/stats/range";
import { Sparkline } from "@/components/stats/charts/Sparkline";
import { MiniBars } from "@/components/stats/charts/MiniBars";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricHelp } from "@/components/ui/MetricHelp";

export type StatsOverviewByRange = Record<
  Range,
  {
    adherence: AdherenceResult;
    prs: PrsRangeResult;
    volume: VolumeRangeResult;
  }
>;

export type StatsOverviewViewProps = {
  initialRange: Range;
  byRange: StatsOverviewByRange;
  freshness: FreshnessMiniRow[];
  bodyweight: BodyweightTrend;
  units: WeightUnit;
  formatProfile: ProfileForFormat;
};

export function StatsOverviewView(props: StatsOverviewViewProps) {
  const { initialRange, byRange, freshness, bodyweight, units, formatProfile } = props;
  const [range, setRange] = useState<Range>(initialRange);

  const syncUrl = useCallback((next: Range) => {
    if (typeof window === "undefined") return;
    const url =
      next === DEFAULT_RANGE
        ? "/app/stats"
        : `/app/stats?range=${next}`;
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
        data-testid="stats-overview-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        <AdherenceCard data={current.adherence} range={range} />
        <PrsCard data={current.prs} units={units} range={range} formatProfile={formatProfile} />
        <FreshnessCard rows={freshness} />
        <VolumeCard data={current.volume} units={units} range={range} />
        <BodyweightCard data={bodyweight} units={units} />
      </div>
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
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            data-testid="stats-range-option"
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

// ── B — Adherence ─────────────────────────────────────────────────────

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
      <CardTitle title="Adherence" subtitle={subtitle} helpTerm="adherence" />
      {data.scheduled === 0 ? (
        <EmptyState
          variant="inline"
          title="Nothing scheduled"
          body="Once a block is live, this card tracks how many planned sessions you actually log in the window."
        />
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

// ── C — PRs ──────────────────────────────────────────────────────────

function PrsCard({
  data,
  units,
  range,
  formatProfile,
}: {
  data: PrsRangeResult;
  units: WeightUnit;
  range: Range;
  formatProfile: ProfileForFormat;
}) {
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
        <EmptyState
          variant="inline"
          title="No PRs in window"
          body="Log a top set or AMRAP heavier than your previous best on a tracked lift and it lands here."
        />
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
                {formatDate(
                  p.date + "T00:00:00Z",
                  { ...(formatProfile ?? {}), timezone: "UTC" },
                  "short_date",
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── D — Freshness (range-invariant) ──────────────────────────────────

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
        helpTerm="region_freshness"
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
        <EmptyState
          variant="inline"
          title="No region load yet"
          body="Log a session (strength or cardio) and freshness builds up region by region."
        />
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

// ── F — Volume ───────────────────────────────────────────────────────

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
        helpTerm="weekly_tonnage"
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
        <EmptyState
          variant="inline"
          title="No strength sets"
          body="Log a strength session in this window and weekly tonnage populates here."
        />
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

// ── G — Bodyweight (range-invariant 30d trend) ───────────────────────

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
        <CardTitle title="Bodyweight" subtitle={`${unit} · 30 d trend`} helpTerm="bodyweight_trend" />
        <EmptyState
          variant="inline"
          title="No bodyweight logged"
          body="Log your bodyweight on Today (How recovered? check-in) or in Settings and your 30-day trend populates here."
        />
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
      <CardTitle title="Bodyweight" subtitle={`${unit} · 30 d trend`} helpTerm="bodyweight_trend" />
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

// ── Shared bits ──────────────────────────────────────────────────────

function CardTitle({
  title,
  subtitle,
  right,
  helpTerm,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  helpTerm?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      <div>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {title}
          {helpTerm != null && <MetricHelp term={helpTerm} />}
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
