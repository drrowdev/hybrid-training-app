/**
 * Adherence breakdown card — diagnostic split of the headline ratio.
 *
 * The headline number on /app/stats/adherence is `completed /
 * scheduled` (with skipped counted toward the denominator — see
 * `lib/stats/adherence.ts`). That number deliberately does NOT shift
 * when a user back-fills a workout: a Monday session logged Tuesday
 * still counts as completed. But it's useful to see HOW the
 * scheduled bucket actually split, especially after PR #173's
 * overdue surfaces:
 *
 *   - On-time   — completed, performed_at on or before planned date.
 *   - Late-logged — completed, performed_at strictly after planned.
 *   - Skipped   — explicit `skipped_at` (still counts as missed).
 *   - Missed    — neither completed nor skipped, date in the past.
 *
 * Purely additive — never changes the headline ratio.
 */
import type { AdherenceResult } from "@/lib/stats/adherence";

export function AdherenceBreakdownCard({ result }: { result: AdherenceResult }) {
  const total = result.scheduled;
  return (
    <section
      className="cp-card"
      data-testid="adherence-breakdown"
      style={{ padding: 16, display: "grid", gap: 10 }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, letterSpacing: "-0.005em" }}>Breakdown</h3>
        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          All-time · for reference
        </span>
      </header>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 6,
          fontSize: 13,
        }}
      >
        <Row
          label="On-time"
          value={result.onTime}
          total={total}
          testid="adherence-breakdown-on-time"
          tone="ok"
        />
        <Row
          label="Late-logged"
          value={result.lateLogged}
          total={total}
          testid="adherence-breakdown-late"
          tone="info"
        />
        <Row
          label="Skipped"
          value={result.skipped}
          total={total}
          testid="adherence-breakdown-skipped"
          tone="warn"
        />
        <Row
          label="Missed"
          value={result.accidentallyMissed}
          total={total}
          testid="adherence-breakdown-missed"
          tone="bad"
        />
      </ul>
    </section>
  );
}

function Row({
  label,
  value,
  total,
  testid,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  testid: string;
  tone: "ok" | "info" | "warn" | "bad";
}) {
  const dotColor =
    tone === "ok"
      ? "var(--cp-accent)"
      : tone === "info"
        ? "var(--cp-text-muted)"
        : tone === "warn"
          ? "var(--cp-warn, #c97e22)"
          : "var(--cp-danger, #b14a3a)";
  return (
    <li
      data-testid={testid}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: dotColor,
          display: "inline-block",
        }}
      />
      <span style={{ color: "var(--cp-text)" }}>{label}</span>
      <span className="mono" style={{ color: "var(--cp-text-muted)" }}>
        {value}/{total}
      </span>
    </li>
  );
}
