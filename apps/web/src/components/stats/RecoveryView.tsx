import { formatDate, type ProfileForFormat } from "@/lib/format/datetime";
import type { RegionFreshnessDetail, BucketPressureRow, CeilingExplain, OverrideEvent } from "@/lib/stats/engine";
import { MiniLine } from "./charts/MiniLine";
import { PressureMeter, pressureTone } from "./charts/PressureMeter";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import styles from "./RecoveryView.module.css";

export function RecoveryView({ regions, buckets, ceiling, overrides, formatProfile }: {
  regions: RegionFreshnessDetail[];
  buckets: BucketPressureRow[];
  ceiling: CeilingExplain;
  overrides: OverrideEvent[];
  formatProfile: ProfileForFormat;
}) {
  const hasLoad = buckets.some((row) => row.atl > 0 || row.ctl > 0);
  return <div className={styles.page}>
    <PageHeader back={{ href: "/app/stats", label: "Stats" }} title="Recovery" titleTestId="stats-engine-header" />
    <div className={styles.charts}>
      <section className={`cp-card ${styles.card}`} data-testid="stats-engine-regions" data-empty={regions.length === 0}>
        <header className={styles.heading}><h2>Recovery by area</h2><span>14 days</span></header>
        {regions.length === 0 ? <EmptyState variant="inline" title="No training logged" /> :
          <div className={styles.rows}>{regions.map((row) => {
            const tone = row.currentFreshness >= 0.7 ? "var(--cp-success)" : row.currentFreshness >= 0.4 ? "var(--cp-warning)" : "var(--cp-danger)";
            return <div key={row.region} className={styles.row} data-testid="stats-engine-region-row" data-region={row.region}>
              <div className={styles.rowHeading}>
                <strong>{row.label}</strong>
                <span className="mono" style={{ color: tone }}>{Math.round(row.currentFreshness * 100)}% fresh</span>
              </div>
              <MiniLine values={row.history} height={60} accent="accent" ariaLabel={`14-day freshness history for ${row.label}`} />
              <div className={styles.meta}>
                <span>Last trained {row.lastLoadDate
                  ? <time dateTime={row.lastLoadDate}>{formatDate(row.lastLoadDate, { ...formatProfile, timezone: "UTC" }, "short_date")}</time>
                  : "—"}</span>
                <span>Loaded days: {row.setCounts.d7} / 7 · {row.setCounts.d14} / 14 · {row.setCounts.d28} / 28</span>
              </div>
            </div>;
          })}</div>}
      </section>

      <section className={`cp-card ${styles.card}`} data-testid="stats-engine-buckets" data-empty={!hasLoad}>
        <header className={styles.heading}><h2>Training load</h2><span>% of usual</span></header>
        {!hasLoad ? <EmptyState variant="inline" title="No training logged" /> :
          <ul className={styles.rows}>{buckets.map((row) => {
            const tone = pressureTone(row.percentOfCeiling);
            const color = tone === "ok" ? "var(--cp-success)" : tone === "danger" ? "var(--cp-danger)" : "var(--cp-warning)";
            return <li key={row.bucket} className={styles.row} data-testid="stats-engine-bucket-row" data-bucket={row.bucket}>
              <div className={styles.rowHeading}>
                <strong>{row.label}</strong>
                <span className="mono" style={{ color }}>{Math.round(row.percentOfCeiling * 100)}%</span>
              </div>
              <PressureMeter value={row.percentOfCeiling}
                marks={[{ at: 0.7 }, { at: 0.9 }, { at: 1, label: "Usual load" }]}
                ariaLabel={`${row.label}: ${Math.round(row.percentOfCeiling * 100)}% of usual load`} />
            </li>;
          })}</ul>}
      </section>
    </div>

    <section className={`cp-card ${styles.card}`} data-testid="stats-engine-ceiling" data-formula={ceiling.formula}>
      <div className={styles.rowHeading}>
        <h2>Weekly capacity</h2>
        <span className={`mono ${styles.capacity}`} data-testid="stats-engine-ceiling-final">
          ≈ {Math.round(ceiling.finalCeiling).toLocaleString()} kg
        </span>
      </div>
    </section>

    <details className={`cp-card ${styles.calculation}`} data-testid="recovery-calculation">
      <summary>How this is calculated</summary>
      <div className={styles.method}>
        <p>These are estimates from your logged training.</p>
        <p>Recovery by area compares recent load with your recorded tolerance. Training load compares a 7-day weighted average with a 28-day average.</p>
        <p>Weekly capacity uses the weight lifted across your recovered weeks. With fewer than three recovered weeks, the estimate is reduced.</p>
        <dl className={styles.inputs}>
          <div><dt>Recovered weeks</dt><dd data-testid="stats-engine-ceiling-recovered-badge">{ceiling.inputs.recoveredWeeksCount}</dd></div>
          <div><dt>Base capacity</dt><dd>{Math.round(ceiling.baseCeiling).toLocaleString()} kg</dd></div>
          <div><dt>Adjustment</dt><dd>× {ceiling.confidenceBias.toFixed(2)}</dd></div>
        </dl>
        {ceiling.basisWeeks.length > 0 && <ul className={styles.rows} data-testid="stats-engine-ceiling-basis">
          {ceiling.basisWeeks.map((week) => <li key={week.weekStart} className={styles.rowHeading}
            data-testid="stats-engine-ceiling-basis-row" data-included={week.included}>
            <time dateTime={week.weekStart}>{formatDate(week.weekStart, { ...formatProfile, timezone: "UTC" }, "short_date")}</time>
            <span>{week.included ? "Included" : "Excluded"}</span>
            <span className="mono">{week.volume.toLocaleString()} kg</span>
          </li>)}
        </ul>}
      </div>
    </details>

    <section className={`cp-card ${styles.card}`} data-testid="stats-engine-overrides" data-empty={overrides.length === 0}>
      <header className={styles.heading}><h2>Recent changes</h2></header>
      {overrides.length === 0 ? <EmptyState variant="inline" title="No changes yet" /> :
        <ul className={styles.rows}>{overrides.map((event, index) => <li key={index} className={styles.row}
          data-testid="stats-engine-override-row" data-kind={event.kind}>
          <div className={styles.rowHeading}>
            <strong>{event.what}</strong>
            <time dateTime={event.occurredAt}>{formatDate(event.occurredAt, formatProfile, "short_date")}</time>
          </div>
          <span className={styles.meta}>{event.did}</span>
          {event.note && <blockquote data-testid="stats-engine-override-note" className={styles.note}>{event.note}</blockquote>}
        </li>)}</ul>}
    </section>
  </div>;
}
