"use client";

/**
 * /app/stats/movements/[slug] — client wrapper that owns the range toggle.
 *
 * Audit F4 measured the worst regression on this surface — the page
 * already contains the N+1 `getSisterMovements` (audit F6), so every
 * server-round-trip range click triggered up to 6 serial queries on
 * top of the 8 page-level queries. With this wrapper the server reads
 * the full working-set series once, pre-computes per-range slices
 * (top-sets / volume / RPE / creep), passes them as props, and the
 * client toggle just picks which bucket to render.
 */
import Link from "next/link";
import { useCallback, useState } from "react";
import type {
  RpeCreepDetection,
  RpePoint,
  TopSetPoint,
  VolumePoint,
} from "@/lib/stats/movement";
import { DEFAULT_RANGE, RANGE_LABEL, type Range } from "@/lib/stats/range";
import { displayWeight, weightUnitLabel, type WeightUnit } from "@/lib/stats/units";
import { MiniLine, type MiniLineMarker } from "@/components/stats/charts/MiniLine";
import { MiniBars } from "@/components/stats/charts/MiniBars";
import { formatDate as fmtDate } from "@/lib/format/datetime";

type FmtProfile = Parameters<typeof fmtDate>[1];

export type MovementRangeBucket = {
  topSets: TopSetPoint[];
  volume: VolumePoint[];
  rpe: RpePoint[];
  creep: RpeCreepDetection;
  /** Linear-regression slope of e1RM in display units per day. `null`
   *  when the series has < 2 points or zero variance. */
  e1rmSlopePerDayDisplay: number | null;
};

export type MovementByRange = Record<Range, MovementRangeBucket>;

export type MovementRangeViewProps = {
  slug: string;
  initialRange: Range;
  byRange: MovementByRange;
  units: WeightUnit;
  formatProfile: FmtProfile;
};

export function MovementRangeView(props: MovementRangeViewProps) {
  const { slug, initialRange, byRange, units, formatProfile } = props;
  const [range, setRange] = useState<Range>(initialRange);

  const syncUrl = useCallback(
    (next: Range) => {
      if (typeof window === "undefined") return;
      const url =
        next === DEFAULT_RANGE
          ? `/app/stats/movements/${slug}`
          : `/app/stats/movements/${slug}?range=${next}`;
      window.history.replaceState(null, "", url + window.location.hash);
    },
    [slug],
  );

  const onSelect = useCallback(
    (next: Range) => {
      setRange(next);
      syncUrl(next);
    },
    [syncUrl],
  );

  const bucket = byRange[range];

  return (
    <>
      <RangeToggle current={range} onSelect={onSelect} />

      <E1rmTrendCard
        series={bucket.topSets}
        units={units}
        rangeLabel={RANGE_LABEL[range]}
        slopePerDayDisplay={bucket.e1rmSlopePerDayDisplay}
        formatProfile={formatProfile}
      />

      <TopSetsCard
        rows={bucket.topSets.slice(-20).reverse()}
        units={units}
        formatProfile={formatProfile}
      />

      <VolumeTrendCard series={bucket.volume} units={units} formatProfile={formatProfile} />

      <RpeTrendCard series={bucket.rpe} creep={bucket.creep} />

      <RecentSessionsCard
        rows={bucket.topSets.slice(-5).reverse()}
        units={units}
        formatProfile={formatProfile}
      />
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
      data-testid="stats-movement-range-toggle"
      style={{
        marginTop: 12,
        display: "inline-flex",
        gap: 4,
        padding: 4,
        background: "var(--cp-surface-soft)",
        borderRadius: 8,
      }}
    >
      {opts.map((r) => {
        const isActive = r === current;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onSelect(r)}
            data-testid="stats-movement-range-option"
            data-range={r}
            data-active={isActive ? "true" : "false"}
            aria-pressed={isActive}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: isActive ? "var(--cp-bg)" : "transparent",
              color: isActive ? "var(--cp-text)" : "var(--cp-text-muted)",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {RANGE_LABEL[r]}
          </button>
        );
      })}
    </nav>
  );
}

// ── B · e1RM trend ─────────────────────────────────────────────────

function E1rmTrendCard({
  series,
  units,
  rangeLabel,
  slopePerDayDisplay,
  formatProfile,
}: {
  series: TopSetPoint[];
  units: WeightUnit;
  rangeLabel: string;
  slopePerDayDisplay: number | null;
  formatProfile: FmtProfile;
}) {
  const uLabel = weightUnitLabel(units);
  const values = series.map((p) => displayWeight(p.e1rm, units));
  const slopeText =
    slopePerDayDisplay != null ? formatSlopePerWeekDisplay(slopePerDayDisplay) : null;
  const slopePositive = slopePerDayDisplay != null && slopePerDayDisplay > 0;

  // Build the dashed-line overlay from the linear regression so the
  // user sees the trend the slope number describes.
  let overlay: number[] | undefined;
  if (slopePerDayDisplay != null && series.length >= 2) {
    const t0 = +new Date(series[0]!.performedAt);
    const meanY = values.reduce((a, b) => a + b, 0) / values.length;
    const meanX =
      series.reduce((acc, p) => acc + (+new Date(p.performedAt) - t0) / 86_400_000, 0) /
      series.length;
    const intercept = meanY - slopePerDayDisplay * meanX;
    overlay = series.map(
      (p) => slopePerDayDisplay * ((+new Date(p.performedAt) - t0) / 86_400_000) + intercept,
    );
  }

  const markers: MiniLineMarker[] = series
    .map((p, i): MiniLineMarker | null =>
      p.isPR
        ? {
            index: i,
            color: "var(--cp-danger)",
            label: `PR ${Math.round(displayWeight(p.e1rm, units))} ${uLabel} on ${fmtDate(p.performedAt, formatProfile)}`,
          }
        : null,
    )
    .filter((m): m is MiniLineMarker => m != null);

  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-e1rm"
      data-empty={series.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Estimated 1-rep max over time</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        One point per session over the last {rangeLabel.toLowerCase()}. PR sessions
        flagged with a red dot.
        {slopeText && (
          <>
            {" "}
            Trend:{" "}
            <span
              style={{
                color: slopePositive ? "var(--cp-success)" : "var(--cp-warning)",
                fontWeight: 600,
              }}
              data-testid="stats-movement-e1rm-slope"
            >
              {slopeText}
            </span>
            .
          </>
        )}
      </p>
      {series.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          Log a few sessions to see the trend.
        </p>
      ) : (
        <MiniLine
          values={values}
          overlay={overlay}
          markers={markers}
          height={200}
          ariaLabel={`estimated 1RM trend, ${series.length} sessions`}
        />
      )}
    </section>
  );
}

// ── C · Top sets table ─────────────────────────────────────────────

function TopSetsCard({
  rows,
  units,
  formatProfile,
}: {
  rows: TopSetPoint[];
  units: WeightUnit;
  formatProfile: FmtProfile;
}) {
  const uLabel = weightUnitLabel(units);
  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-top-sets"
      data-empty={rows.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Top sets</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Heaviest set per session, last 20. Tap a row to open that session.
      </p>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          No sessions in this range yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {rows.map((r) => (
            <li key={r.sessionId}>
              <Link
                href={`/app/sessions/${r.sessionId}`}
                data-testid="stats-movement-top-set-row"
                data-pr={r.isPR ? "true" : "false"}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  alignItems: "baseline",
                  padding: "10px 12px",
                  background: "var(--cp-surface-soft)",
                  borderRadius: 6,
                  textDecoration: "none",
                  color: "var(--cp-text)",
                  fontSize: 12,
                }}
              >
                <span style={{ color: "var(--cp-text-muted)", minWidth: 84 }}>
                  {fmtDate(r.performedAt, formatProfile)}
                </span>
                <span className="mono">
                  {Math.round(displayWeight(r.weight, units) * 10) / 10} {uLabel} × {r.reps}
                  <span style={{ color: "var(--cp-text-muted)", marginLeft: 8 }}>
                    {r.rpe != null ? `@ ${r.rpe}` : ""}
                  </span>
                </span>
                <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
                  <span className="mono" style={{ color: "var(--cp-text-muted)" }}>
                    {Math.round(displayWeight(r.e1rm, units))} {uLabel}
                  </span>
                  {r.isPR && (
                    <span
                      data-testid="stats-movement-pr-badge"
                      style={{
                        fontSize: 9,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        background: "var(--cp-danger)",
                        color: "var(--cp-bg)",
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontWeight: 700,
                      }}
                    >
                      PR
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── D · Volume trend ───────────────────────────────────────────────

function VolumeTrendCard({
  series,
  units,
  formatProfile,
}: {
  series: VolumePoint[];
  units: WeightUnit;
  formatProfile: FmtProfile;
}) {
  const uLabel = weightUnitLabel(units);
  const values = series.map((p) => Math.round(displayWeight(p.tonnage, units)));
  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-volume"
      data-empty={series.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Working volume</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Total tonnage (∑ weight × reps) across every working set, per session.
      </p>
      {series.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          No sessions in this range yet.
        </p>
      ) : (
        <>
          <MiniBars values={values} accent="accent" height={140} ariaLabel="volume per session" />
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: "var(--cp-text-muted)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>{fmtDate(series[0]!.performedAt, formatProfile)}</span>
            <span className="mono">
              max {values.reduce((a, b) => Math.max(a, b), 0).toLocaleString()} {uLabel}
            </span>
            <span>{fmtDate(series[series.length - 1]!.performedAt, formatProfile)}</span>
          </div>
        </>
      )}
    </section>
  );
}

// ── E · RPE trend + creep banner ───────────────────────────────────

function RpeTrendCard({
  series,
  creep,
}: {
  series: RpePoint[];
  creep: RpeCreepDetection;
}) {
  const rpeBearing = series.filter((p) => p.rpe != null);
  const values = rpeBearing.map((p) => p.rpe!);
  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-rpe"
      data-empty={rpeBearing.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Effort over time</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Mean RPE per session for this movement. Climbing RPE on flat weight is a
        deload signal.
      </p>
      {creep.flagged && (
        <div
          data-testid="stats-movement-rpe-creep"
          style={{
            margin: "0 0 12px",
            padding: "10px 12px",
            border: "1px solid var(--cp-warning)",
            background: "color-mix(in srgb, var(--cp-warning) 12%, transparent)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--cp-text)",
          }}
        >
          <strong>RPE creeping up</strong> — last 28 days averaged{" "}
          {creep.recent?.meanRpe.toFixed(1)} vs {creep.earlier?.meanRpe.toFixed(1)} the
          28 days before, on flat or lower weight. Consider a deload or check
          sleep/stress.
        </div>
      )}
      {rpeBearing.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          Log RPE on top sets to see trends.
        </p>
      ) : (
        <MiniLine
          values={values}
          accent={creep.flagged ? "warning" : "accent"}
          height={140}
          ariaLabel={`mean RPE per session, ${rpeBearing.length} sessions`}
        />
      )}
    </section>
  );
}

// ── G · Recent sessions snapshot ───────────────────────────────────

function RecentSessionsCard({
  rows,
  units,
  formatProfile,
}: {
  rows: TopSetPoint[];
  units: WeightUnit;
  formatProfile: FmtProfile;
}) {
  const uLabel = weightUnitLabel(units);
  const avgWeight =
    rows.length > 0 ? rows.reduce((a, b) => a + b.weight, 0) / rows.length : 0;
  return (
    <section
      className="cp-card"
      style={{ padding: 20 }}
      data-testid="stats-movement-recent"
      data-empty={rows.length === 0 ? "true" : "false"}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Recent sessions</h2>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        Last 5, newest first. Delta is relative to the average top-set weight in
        this range.
      </p>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
          No sessions yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {rows.map((r) => {
            const delta = r.weight - avgWeight;
            const deltaDisp = Math.round(displayWeight(delta, units) * 10) / 10;
            const sign = delta > 0 ? "+" : delta < 0 ? "" : "±";
            return (
              <li key={r.sessionId} data-testid="stats-movement-recent-row">
                <Link
                  href={`/app/sessions/${r.sessionId}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 6,
                    padding: "10px 12px",
                    background: "var(--cp-surface-soft)",
                    borderRadius: 6,
                    textDecoration: "none",
                    color: "var(--cp-text)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12 }}>
                      {fmtDate(r.performedAt, formatProfile, "weekday_short")}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                      {Math.round(displayWeight(r.weight, units) * 10) / 10} {uLabel} ×{" "}
                      {r.reps}
                      {r.rpe != null ? ` @ ${r.rpe}` : ""}
                    </div>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      alignSelf: "center",
                      color:
                        delta > 0
                          ? "var(--cp-success)"
                          : delta < 0
                            ? "var(--cp-warning)"
                            : "var(--cp-text-muted)",
                    }}
                  >
                    {sign}
                    {deltaDisp} {uLabel}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Local copy of formatSlopePerWeek so the client comp doesn't have to
// import from `@/lib/stats/movement` (which pulls in supabase/server).
// `slopePerDayDisplay` is already in the user's display units; the
// "kg/week" suffix is preserved from the pre-existing server helper
// for label parity (kept in `lib/stats/movement.ts:formatSlopePerWeek`).
function formatSlopePerWeekDisplay(slopePerDayDisplay: number): string {
  const perWeek = slopePerDayDisplay * 7;
  const sign = perWeek > 0 ? "+" : "";
  return `${sign}${perWeek.toFixed(1)} kg/week`;
}
