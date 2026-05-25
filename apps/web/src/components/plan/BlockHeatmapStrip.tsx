/**
 * BlockHeatmapStrip — single-row horizontal heatmap of the most
 * recent / upcoming ~4 weeks of planned sessions.
 *
 * Replaces the older multi-row weeks × days grid for the in-page
 * block-overview slot. Cells render at session granularity (one cell
 * per day, including rest gaps as a low-contrast spacer) so the strip
 * stays glanceable without dominating the page.
 *
 * Color/intensity vocabulary:
 *   completed → success token, full opacity
 *   skipped   → muted text token, faded
 *   today     → accent ring, accent-soft fill
 *   planned   → accent-soft fill
 *   rest      → bare surface-soft cell
 */
import Link from "next/link";
import { addDaysToYmd } from "@/lib/dates";

const DOW_INITIAL = ["M", "T", "W", "T", "F", "S", "S"];

export type HeatmapCell = {
  date: string;
  weekIndex: number;
  dayIndex: number;
  hasPlan: boolean;
  completed: boolean;
  skipped: boolean;
};

export function BlockHeatmapStrip({
  all,
  today,
  weeks = 4,
}: {
  all: {
    weekIndex: number;
    dayIndex: number;
    date: string;
    completedSessionId: string | null;
    skippedAt: string | null;
  }[];
  today: string;
  weeks?: number;
}) {
  // Anchor the strip around today: 1 week back + (weeks-1) weeks forward.
  // Snap to Monday so the columns align visually with the weekday header.
  const todayDow = isoMondayIndex(today); // 0=Mon..6=Sun
  const start = addDaysToYmd(today, -todayDow - 7);
  const days = weeks * 7;

  // Index planned days by date for O(1) lookup.
  const byDate = new Map<
    string,
    { completed: boolean; skipped: boolean; hasPlan: boolean }
  >();
  for (const d of all) {
    const prev = byDate.get(d.date) ?? { completed: false, skipped: false, hasPlan: false };
    byDate.set(d.date, {
      hasPlan: true,
      completed: prev.completed || !!d.completedSessionId,
      skipped: prev.skipped || !!d.skippedAt,
    });
  }

  const cells = Array.from({ length: days }, (_, i) => {
    const date = addDaysToYmd(start, i);
    const entry = byDate.get(date);
    return {
      date,
      isToday: date === today,
      isPast: date < today,
      hasPlan: !!entry?.hasPlan,
      completed: !!entry?.completed,
      skipped: !!entry?.skipped,
    };
  });

  return (
    <section
      className="cp-card"
      data-testid="plan-block-strip"
      style={{ padding: 10, display: "grid", gap: 6 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Block at a glance
        </h2>
        <div style={{ display: "flex", gap: 8, fontSize: 9, color: "var(--cp-text-muted)" }}>
          <Swatch color="var(--cp-success)" label="Done" />
          <Swatch color="var(--cp-accent)" label="Planned" />
          <Swatch color="var(--cp-text-muted)" label="Skipped" />
        </div>
      </div>
      <div
        role="row"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))`,
          gap: 2,
        }}
      >
        {cells.map((c) => (
          <StripCell key={c.date} cell={c} />
        ))}
      </div>
      <div
        aria-hidden
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))`,
          gap: 2,
          fontSize: 8,
          color: "var(--cp-text-muted)",
          textAlign: "center",
        }}
      >
        {cells.map((c, i) => (
          <span key={c.date}>{DOW_INITIAL[i % 7]}</span>
        ))}
      </div>
    </section>
  );
}

function StripCell({
  cell,
}: {
  cell: {
    date: string;
    isToday: boolean;
    isPast: boolean;
    hasPlan: boolean;
    completed: boolean;
    skipped: boolean;
  };
}) {
  const bg = cell.completed
    ? "var(--cp-success)"
    : cell.skipped
      ? "var(--cp-text-muted)"
      : cell.hasPlan
        ? "var(--cp-accent-soft)"
        : "var(--cp-surface-soft)";
  const opacity = cell.skipped ? 0.55 : !cell.hasPlan && cell.isPast ? 0.4 : 1;
  const border = cell.isToday
    ? "1.5px solid var(--cp-accent)"
    : cell.hasPlan
      ? "1px solid var(--cp-border)"
      : "1px solid transparent";
  const stateLabel = cell.completed
    ? "done"
    : cell.skipped
      ? "skipped"
      : cell.hasPlan
        ? "planned"
        : "rest";
  const a11yLabel = `${cell.date}${cell.isToday ? " (today)" : ""} — ${stateLabel}`;
  const inner = (
    <div
      title={a11yLabel}
      data-testid={`plan-strip-cell-${cell.date}`}
      data-state={stateLabel}
      style={{
        height: 18,
        borderRadius: 3,
        background: bg,
        border,
        opacity,
      }}
    />
  );
  if (!cell.hasPlan) {
    return (
      <div role="presentation" aria-hidden="true">
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={`/app/plan?date=${cell.date}`}
      aria-label={a11yLabel}
      style={{ display: "block" }}
    >
      {inner}
    </Link>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span>{label}</span>
    </span>
  );
}

function isoMondayIndex(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const jsDow = new Date(Date.UTC(y!, (m ?? 1) - 1, d!)).getUTCDay(); // Sun=0
  return (jsDow + 6) % 7; // Mon=0..Sun=6
}
