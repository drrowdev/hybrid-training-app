/**
 * TrainingHeatmap — GitHub-style contribution grid for the last N weeks.
 *
 * Layout: Mon (top row) → Sun (bottom row), oldest week leftmost. Each
 * cell is a square link to /app/sessions?date=YYYY-MM-DD (the closest
 * existing surface today; the sessions list will eventually filter by
 * date). Hover/tap surfaces a native-tooltip with the date + session
 * titles.
 *
 * State → paint:
 *   strength → solid `--cp-accent` (lime, our strength tone)
 *   cardio   → solid `--cp-link`   (cool blue, our cardio tone)
 *   both     → 45° linear-gradient lime/blue split
 *   rest     → no fill, soft border
 *   missed   → no fill, dashed warning border
 *   empty    → near-invisible surface so the grid still reads as 7 rows
 *
 * Today's cell gets a 2px accent ring on top of whatever fill it has.
 *
 * Pure presentation — caller passes in pre-computed `cells`.
 */
import Link from "next/link";
import type { HeatmapCell, CellState } from "@/lib/stats/training-heatmap-data";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const STATE_LABEL: Record<CellState, string> = {
  empty: "No session",
  strength: "Strength",
  cardio: "Cardio",
  both: "Strength + Cardio",
  rest: "Rest",
  missed: "Missed",
};

function cellBackground(state: CellState): string {
  switch (state) {
    case "strength":
      return "var(--cp-accent)";
    case "cardio":
      return "var(--cp-link)";
    case "both":
      return "linear-gradient(45deg, var(--cp-accent) 0 50%, var(--cp-link) 50% 100%)";
    case "rest":
    case "missed":
    case "empty":
    default:
      return "var(--cp-surface-soft)";
  }
}

function cellBorder(state: CellState): string {
  switch (state) {
    case "missed":
      return "1px dashed var(--cp-warning)";
    case "rest":
      return "1px solid var(--cp-border)";
    case "empty":
      return "1px solid var(--cp-border)";
    default:
      // Filled cells get a subtle border so adjacent same-state cells
      // still read as separate squares against the card background.
      return "1px solid rgba(0,0,0,0.06)";
  }
}

function describeCell(cell: HeatmapCell): string {
  const lines: string[] = [cell.date, STATE_LABEL[cell.state]];
  if (cell.titles.length > 0) lines.push(...cell.titles);
  return lines.join(" — ");
}

function monthLabel(date: string): string | null {
  // Show "MMM D" when this Monday is in the first 7 days of a month
  // (i.e. crosses or starts a month boundary); otherwise null.
  const day = Number(date.slice(8, 10));
  if (day > 7) return null;
  const d = new Date(`${date}T00:00:00Z`);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${day}`;
}

export type TrainingHeatmapProps = {
  cells: HeatmapCell[];
  /** Number of weeks (column count). Defaults to inferred. */
  weeks?: number;
};

export function TrainingHeatmap({ cells, weeks }: TrainingHeatmapProps) {
  const weekCount =
    weeks ??
    (cells.length > 0 ? Math.max(...cells.map((c) => c.weekIndex)) + 1 : 0);

  // Bucket cells into [day][week]. Mon (0) → Sun (6).
  const grid: (HeatmapCell | undefined)[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: weekCount }, () => undefined),
  );
  for (const c of cells) grid[c.dayIndex][c.weekIndex] = c;

  // Month labels: one per week column, only when the week starts a month.
  const monthLabels: (string | null)[] = Array.from({ length: weekCount }, (_, w) => {
    const monday = grid[0][w]?.date;
    return monday ? monthLabel(monday) : null;
  });

  return (
    <section
      className="cp-card"
      data-testid="training-heatmap"
      style={{ padding: 18, display: "grid", gap: 12 }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Training calendar
          </div>
          <div style={{ fontSize: 14, marginTop: 2, color: "var(--cp-text-muted)" }}>
            Last {weekCount} weeks · strength + cardio per day
          </div>
        </div>
        <Legend />
      </header>

      <div style={{ overflowX: "auto", overflowY: "hidden" }}>
        <div
          className="cp-heatmap-grid"
          style={{
            display: "inline-grid",
            // 32px gutter on the left for day-of-week labels.
            gridTemplateColumns: `32px repeat(${weekCount}, var(--cp-heatmap-cell, 14px))`,
            gap: 4,
          }}
        >
          {/* Top-left blank corner */}
          <div />
          {/* Month-label row */}
          {monthLabels.map((label, w) => (
            <div
              key={`m-${w}`}
              style={{
                fontSize: 10,
                color: "var(--cp-text-muted)",
                textAlign: "center",
                lineHeight: 1,
                minHeight: 12,
              }}
            >
              {label ?? ""}
            </div>
          ))}

          {/* Seven rows: weekday label + week cells */}
          {grid.map((row, dayIdx) => (
            <RowFragment
              key={`r-${dayIdx}`}
              dayLabel={DAY_LABELS[dayIdx]}
              row={row}
            />
          ))}
        </div>
      </div>

      <style>{`
        .cp-heatmap-grid { --cp-heatmap-cell: 14px; }
        @media (max-width: 640px) {
          .cp-heatmap-grid { --cp-heatmap-cell: 12px; }
        }
      `}</style>
    </section>
  );
}

function RowFragment({
  dayLabel,
  row,
}: {
  dayLabel: string;
  row: (HeatmapCell | undefined)[];
}) {
  return (
    <>
      <div
        style={{
          fontSize: 10,
          color: "var(--cp-text-muted)",
          alignSelf: "center",
          textAlign: "right",
          paddingRight: 4,
          height: "var(--cp-heatmap-cell, 14px)",
          lineHeight: "var(--cp-heatmap-cell, 14px)",
        }}
      >
        {dayLabel}
      </div>
      {row.map((cell, weekIdx) => (
        <CellSquare key={`c-${weekIdx}`} cell={cell} />
      ))}
    </>
  );
}

function CellSquare({ cell }: { cell: HeatmapCell | undefined }) {
  if (!cell) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: "var(--cp-heatmap-cell, 14px)",
          height: "var(--cp-heatmap-cell, 14px)",
        }}
      />
    );
  }
  const ring = cell.isToday
    ? "0 0 0 2px var(--cp-accent), 0 0 0 3px var(--cp-surface)"
    : "none";
  const sharedStyle: React.CSSProperties = {
    width: "var(--cp-heatmap-cell, 14px)",
    height: "var(--cp-heatmap-cell, 14px)",
    borderRadius: 3,
    background: cellBackground(cell.state),
    border: cellBorder(cell.state),
    boxShadow: ring,
    display: "block",
    // Future-day fills get knocked back so they don't read as completed.
    opacity: cell.isFuture && cell.state === "empty" ? 0.5 : 1,
  };
  const title = describeCell(cell);
  const testid = `heatmap-cell-${cell.date}`;
  if (cell.sessionIds.length > 0) {
    return (
      <Link
        href={`/app/sessions?date=${cell.date}`}
        title={title}
        aria-label={title}
        data-testid={testid}
        data-state={cell.state}
        data-today={cell.isToday ? "true" : "false"}
        style={{ ...sharedStyle, cursor: "pointer", textDecoration: "none" }}
      />
    );
  }
  return (
    <span
      title={title}
      aria-label={title}
      data-testid={testid}
      data-state={cell.state}
      data-today={cell.isToday ? "true" : "false"}
      style={sharedStyle}
    />
  );
}

function Legend() {
  const items: Array<{ state: CellState; label: string }> = [
    { state: "strength", label: "Strength" },
    { state: "cardio", label: "Cardio" },
    { state: "both", label: "Both" },
    { state: "rest", label: "Rest" },
    { state: "missed", label: "Missed" },
  ];
  return (
    <ul
      data-testid="training-heatmap-legend"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        listStyle: "none",
        padding: 0,
        margin: 0,
        fontSize: 11,
        color: "var(--cp-text-muted)",
      }}
    >
      {items.map((it) => (
        <li key={it.state} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 2,
              background: cellBackground(it.state),
              border: cellBorder(it.state),
            }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
