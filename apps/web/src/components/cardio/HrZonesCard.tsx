/**
 * Time-in-HR-zones card.
 *
 * Horizontal stacked bar showing seconds-per-zone over the lib's
 * configured window. Strava-gated — graceful EmptyState branches for
 * no-connection / no-zones / no-HR-data.
 *
 * Below the bar we surface the polarised-distribution principle
 * (Seiler 2010 polarised model: ~80% Z1–Z2 + ~20% Z4–Z5, minimising
 * Z3) and the user's actual easy/threshold/hard split as a single-line
 * comparison.
 */
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricHelp } from "@/components/ui/MetricHelp";
import type { HrZoneState, Zone, ZoneTotals } from "@/lib/stats/hr-zones";

export type HrZonesCardProps = {
  state: HrZoneState;
};

const ZONE_META: Record<Zone, { label: string; desc: string; color: string }> = {
  Z1: { label: "Z1", desc: "recovery", color: "var(--cp-zone-z1, #6bbf6b)" },
  Z2: { label: "Z2", desc: "easy aerobic", color: "var(--cp-zone-z2, #4ea8de)" },
  Z3: { label: "Z3", desc: "tempo", color: "var(--cp-zone-z3, #f7c948)" },
  Z4: { label: "Z4", desc: "threshold", color: "var(--cp-zone-z4, #f49f3b)" },
  Z5: { label: "Z5", desc: "VO2max", color: "var(--cp-zone-z5, #e35454)" },
};
const ZONES: Zone[] = ["Z1", "Z2", "Z3", "Z4", "Z5"];

function fmtMin(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${h}h ${rest}m`;
}

function totalSec(totals: ZoneTotals): number {
  return ZONES.reduce((acc, z) => acc + totals[z], 0);
}

export function HrZonesCard({ state }: HrZonesCardProps) {
  if (state.kind === "no-strava") {
    return (
      <EmptyState
        title="HR zones need Strava"
        body="Connect Strava to import runs and rides with heart-rate streams. Once your zones are configured, this card shows how your time splits across Z1–Z5."
        action={{ label: "Connect Strava", href: "/app/settings/strava" }}
      />
    );
  }
  if (state.kind === "no-hr-data") {
    return (
      <EmptyState
        title="No HR-stream data"
        body="Strava-imported activities with a heart-rate stream and configured zones populate this card. Outdoor runs and rides with a wrist or chest HR sensor work best."
      />
    );
  }
  if (state.kind === "no-zones") {
    return (
      <EmptyState
        title="Configure your HR zones"
        body="Tap below to set your Z1–Z5 thresholds. Once saved, this card backfills against your imported activities."
        action={{ label: "Set HR zones", href: "/app/settings/hr-zones" }}
      />
    );
  }

  const total = totalSec(state.totals);
  const pct = (z: Zone) => (total === 0 ? 0 : state.totals[z] / total);
  const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <section
      data-testid="cardio-hr-zones"
      className="cp-card"
      style={{ padding: 16, display: "grid", gap: 12 }}
    >
      <header>
        <div
          style={{
            fontSize: 11,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Time in HR zones
          <MetricHelp term="hr_zones" />
        </div>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
          Last {Math.round(state.windowDays / 7)} weeks · {state.activityCount} HR-tagged session
          {state.activityCount === 1 ? "" : "s"}
        </div>
      </header>

      <div
        role="img"
        aria-label="Time-in-zone stacked bar from Z1 (recovery) to Z5 (VO2max)"
        style={{
          display: "flex",
          height: 18,
          borderRadius: 4,
          overflow: "hidden",
          background: "var(--cp-surface-soft, var(--cp-surface))",
          border: "1px solid var(--cp-border)",
        }}
      >
        {ZONES.map((z) => (
          <div
            key={z}
            data-testid={`cardio-hr-zone-segment-${z}`}
            data-zone={z}
            title={`${ZONE_META[z].label} · ${ZONE_META[z].desc} · ${fmtMin(state.totals[z])}`}
            style={{
              width: `${pct(z) * 100}%`,
              background: ZONE_META[z].color,
              transition: "width 200ms ease",
            }}
          />
        ))}
      </div>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 8,
        }}
      >
        {ZONES.map((z) => (
          <li key={z} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: ZONE_META[z].color,
                flexShrink: 0,
              }}
              aria-hidden="true"
            />
            <span style={{ color: "var(--cp-text)" }}>
              {ZONE_META[z].label}{" "}
              <span style={{ color: "var(--cp-text-muted)" }}>· {ZONE_META[z].desc}</span>
            </span>
            <span style={{ marginLeft: "auto", color: "var(--cp-text-muted)" }} className="mono">
              {fmtPct(pct(z))}
            </span>
          </li>
        ))}
      </ul>

      <div data-testid="cardio-hr-zones-split" style={{ fontSize: 12, color: "var(--cp-text)" }}>
        Your split:{" "}
        <span className="mono">{fmtPct(state.split.easyPct)}</span> Z1–Z2 ·{" "}
        <span className="mono">{fmtPct(state.split.thresholdPct)}</span> Z3 ·{" "}
        <span className="mono">{fmtPct(state.split.hardPct)}</span> Z4–Z5
      </div>

      <footer style={{ fontSize: 11, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
        Seiler 2010 polarised model targets ~80% Z1–Z2 + ~20% Z4–Z5, minimising Z3.
        <MetricHelp term="polarised_distribution" />
        {" "}
        <span style={{ fontStyle: "italic" }}>
          {state.source === "measured"
            ? "Measured from per-second HR streams."
            : state.source === "mixed"
              ? "Measured from HR streams where available; approximated from session-average HR otherwise."
              : "Approximated from session-average HR; per-second streams will refine this when available."}
        </span>
        {state.droppedCount > 0 && (
          <>
            {" "}
            ({state.droppedCount} session{state.droppedCount === 1 ? "" : "s"} excluded for missing HR.)
          </>
        )}
      </footer>
    </section>
  );
}
