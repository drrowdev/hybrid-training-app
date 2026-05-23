/**
 * Pace PRs card.
 *
 * Table of canonical run distances (mile · 5K · 10K · half · marathon)
 * showing the best estimated time in the last 12 months, the delta vs
 * the previous 12 months, the PR date, and an external Strava link.
 *
 * v1 approximation (footnoted): average pace of the full activity is
 * extrapolated to the target distance when the activity covered at
 * least that distance. Per-activity splits will refine this later.
 */
import { EmptyState } from "@/components/ui/EmptyState";
import {
  formatDelta,
  formatDuration,
  type PacePrState,
  type PrRow,
} from "@/lib/stats/pace-prs";

export type PacePRsCardProps = {
  state: PacePrState;
};

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function StravaLink({ activityId }: { activityId: string }) {
  return (
    <a
      href={`https://www.strava.com/activities/${activityId}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View activity on Strava"
      data-testid="cardio-pace-pr-strava-link"
      style={{
        fontSize: 11,
        color: "var(--cp-accent, var(--cp-link))",
        textDecoration: "none",
        marginLeft: 4,
      }}
    >
      ↗
    </a>
  );
}

function Row({ row }: { row: PrRow }) {
  const delta = formatDelta(row.deltaSec);
  const deltaColor =
    delta.tone === "success"
      ? "var(--cp-success)"
      : delta.tone === "danger"
        ? "var(--cp-danger)"
        : "var(--cp-text-muted)";

  return (
    <tr data-testid="cardio-pace-pr-row" data-distance={row.key}>
      <th
        scope="row"
        style={{
          textAlign: "left",
          fontWeight: 500,
          fontSize: 13,
          color: "var(--cp-text)",
          padding: "6px 8px 6px 0",
        }}
      >
        {row.label}
      </th>
      <td className="mono" style={{ padding: "6px 8px", fontSize: 13, color: "var(--cp-text)" }}>
        {row.current ? formatDuration(row.current.timeSec) : "—"}
      </td>
      <td className="mono" style={{ padding: "6px 8px", fontSize: 13, color: deltaColor }}>
        {delta.text}
      </td>
      <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--cp-text-muted)" }}>
        {row.current ? (
          <>
            {fmtDate(row.current.date)}
            {row.current.stravaActivityId ? <StravaLink activityId={row.current.stravaActivityId} /> : null}
          </>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

export function PacePRsCard({ state }: PacePRsCardProps) {
  if (state.kind === "no-strava") {
    return (
      <EmptyState
        title="Pace PRs need Strava"
        body="Connect Strava to import your runs. Once imported, this card surfaces your best 1-mile / 5K / 10K / half / marathon times and how they're trending year over year."
        action={{ label: "Connect Strava", href: "/app/settings/strava" }}
      />
    );
  }
  if (state.kind === "no-runs") {
    return (
      <EmptyState
        title="No runs yet"
        body="Once Strava-imported runs land in your log, this card shows your best 1-mile / 5K / 10K / half / marathon times and how they&apos;re improving."
      />
    );
  }

  return (
    <section
      data-testid="cardio-pace-prs"
      className="cp-card"
      style={{ padding: 16, display: "grid", gap: 10 }}
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
          Pace PRs
        </div>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
          Best time per distance · current 12 months vs the previous 12
        </div>
      </header>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr
            style={{
              color: "var(--cp-text-muted)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            <th scope="col" style={{ textAlign: "left", padding: "4px 8px 4px 0", fontWeight: 600 }}>
              Distance
            </th>
            <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
              Best
            </th>
            <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
              Δ vs prior
            </th>
            <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
              Date
            </th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((r) => (
            <Row key={r.key} row={r} />
          ))}
        </tbody>
      </table>

      <footer style={{ fontSize: 11, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
        Approximated by scaling each activity&apos;s average pace to the target distance; per-activity splits will refine this when available.
      </footer>
    </section>
  );
}
