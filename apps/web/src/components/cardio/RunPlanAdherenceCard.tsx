/**
 * Run-plan adherence card.
 *
 * Weekly view of the last N ISO weeks: planned cardio (outlined bar)
 * vs actual cardio (filled bar, coloured by % completion). Pure server
 * component — reads precomputed `WeekRow[]` from the lib helper.
 *
 * Empty branches surface via `<EmptyState>`:
 *   - no Strava connection → connect-strava CTA
 *   - no plan at all       → start-a-block CTA
 *   - plan exists, all empty weeks → render the bars (they read "0 of 0")
 */
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricHelp } from "@/components/ui/MetricHelp";
import type { WeekRow } from "@/lib/stats/run-plan-adherence";
import { toneForPct } from "@/lib/stats/run-plan-adherence";
import { formatDate, type ProfileForFormat } from "@/lib/format/datetime";

export type RunPlanAdherenceCardProps = {
  weeks: WeekRow[];
  hasPlan: boolean;
  hasStravaConnection: boolean;
  formatProfile?: ProfileForFormat;
};

const TONE_FILL: Record<ReturnType<typeof toneForPct>, string> = {
  success: "var(--cp-success)",
  warning: "var(--cp-warning)",
  danger: "var(--cp-danger)",
  neutral: "var(--cp-border)",
};

function fmtMon(weekStart: string, profile: ProfileForFormat): string {
  const [y, m, d] = weekStart.split("-").map((n) => Number(n));
  const date = new Date(Date.UTC(y, m - 1, d));
  const utcProfile: ProfileForFormat = profile
    ? { ...profile, timezone: "UTC" }
    : { timezone: "UTC" };
  return formatDate(date, utcProfile, "short_date");
}

export function RunPlanAdherenceCard({
  weeks,
  hasPlan,
  hasStravaConnection,
  formatProfile,
}: RunPlanAdherenceCardProps) {
  if (!hasStravaConnection) {
    return (
      <EmptyState
        title="No cardio plan yet"
        body="Connect Strava and start a block with cardio sessions to see planned vs actual each week."
        action={{ label: "Connect Strava", href: "/app/settings/strava" }}
      />
    );
  }
  if (!hasPlan) {
    return (
      <EmptyState
        title="No cardio plan yet"
        body="Start a block with cardio sessions and this card shows planned vs actual each week."
        action={{ label: "Start a block", href: "/app/plan" }}
      />
    );
  }

  const maxMin = Math.max(
    1,
    ...weeks.map((w) => Math.max(w.plannedMin, w.actualMin)),
  );

  return (
    <section
      data-testid="cardio-run-plan-adherence"
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
          Run-plan adherence
          <MetricHelp term="run_plan_adherence" />
        </div>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
          Last {weeks.length} weeks · planned (outline) vs actual (filled)
        </div>
      </header>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
        {weeks.map((w) => {
          const tone = toneForPct(w.volumePct);
          const plannedWidth = (w.plannedMin / maxMin) * 100;
          const actualWidth = (w.actualMin / maxMin) * 100;
          return (
            <li
              key={w.weekStart}
              data-testid="cardio-run-plan-week"
              data-week={w.weekStart}
              data-tone={tone}
              style={{ display: "grid", gap: 3 }}
            >
              <div
                aria-label={`planned ${w.plannedMin} min`}
                style={{
                  height: 10,
                  width: `${Math.max(plannedWidth, w.plannedMin > 0 ? 3 : 0)}%`,
                  border: "1px solid var(--cp-border)",
                  borderRadius: 3,
                  background: "transparent",
                  minWidth: w.plannedMin > 0 ? 8 : 0,
                }}
              />
              <div
                aria-label={`actual ${w.actualMin} min`}
                style={{
                  height: 10,
                  width: `${Math.max(actualWidth, w.actualMin > 0 ? 3 : 0)}%`,
                  background: TONE_FILL[tone],
                  borderRadius: 3,
                  minWidth: w.actualMin > 0 ? 8 : 0,
                }}
              />
              <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
                Wk of {fmtMon(w.weekStart, formatProfile ?? null)} · {w.actualSessions} of {w.plannedSessions} sessions ·{" "}
                {w.actualMin} of {w.plannedMin} min
              </div>
            </li>
          );
        })}
      </ul>

      <footer style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
        Threshold: ≥ 90% volume = green, 70–89% = yellow, &lt; 70% = red. Skipped
        cardio counts as missed.
      </footer>
    </section>
  );
}
