/**
 * StackedBars — vanilla SVG stacked bar chart for dashboard cards.
 *
 * Each bar represents one bucket; segments stack bottom-up in the order
 * passed. Used by the Phase 4 adherence dashboard (logged / skipped /
 * missed stacks per ISO week) but it's archetype-agnostic — the caller
 * passes the segments and colours.
 *
 * Y-axis is shared across all bars: the tallest stack (sum of its
 * segments) defines the scale unless `max` is set explicitly. Empty /
 * all-zero inputs degrade to a thin baseline so the card keeps shape.
 *
 * Mirrors the contract of `MiniBars` (120×40 viewBox, percentage width
 * via `width: 100%`) so it slots into the same card layouts.
 */
import type { CSSProperties } from "react";

export type StackSegmentKey = string;

export type StackedBarsAccent = "success" | "warning" | "danger" | "accent" | "neutral";

const ACCENT_VAR: Record<StackedBarsAccent, string> = {
  success: "var(--cp-success)",
  warning: "var(--cp-warning)",
  danger: "var(--cp-danger)",
  accent: "var(--cp-accent)",
  neutral: "var(--cp-border)",
};

const W = 120;
const H = 40;
const PAD = 2;
const GAP = 2;

export type StackedBar = {
  /** Bottom-to-top segment values. Negative entries are clamped to 0. */
  segments: number[];
  /** Optional label for assistive copy ("week of May 6"). */
  label?: string;
};

export function StackedBars({
  bars,
  segmentColors,
  max,
  style,
  ariaLabel,
}: {
  bars: StackedBar[];
  /**
   * One CSS colour per segment slot. The length defines how many
   * segments each bar has — segments missing from a bar default to 0.
   */
  segmentColors: Array<StackedBarsAccent | string>;
  /** Override the max stack total. Defaults to the largest sum across bars. */
  max?: number;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const n = bars.length;
  if (n === 0 || segmentColors.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel ?? "stacked bar chart (no data)"}
        data-testid="stacked-bars"
        style={{ width: "100%", height: H, display: "block", ...style }}
      >
        <line
          x1={PAD}
          x2={W - PAD}
          y1={H - PAD}
          y2={H - PAD}
          stroke="var(--cp-border)"
        />
      </svg>
    );
  }

  const sums = bars.map((b) =>
    b.segments.reduce((acc, v) => acc + Math.max(0, v), 0),
  );
  const yMax = Math.max(max ?? 0, ...sums, 0);
  const safeMax = yMax > 0 ? yMax : 1;

  const totalGap = GAP * (n - 1);
  const barW = Math.max(1, (W - 2 * PAD - totalGap) / n);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel ?? `stacked bar chart of ${n} buckets`}
      data-testid="stacked-bars"
      style={{ width: "100%", height: H, display: "block", ...style }}
    >
      {bars.map((bar, i) => {
        const x = PAD + i * (barW + GAP);
        if (sums[i] === 0) {
          // Empty bar — render a 1px placeholder at the baseline so the
          // x-axis remains continuous.
          return (
            <rect
              key={i}
              x={x}
              y={H - PAD - 1}
              width={barW}
              height={1}
              fill="var(--cp-border)"
              rx={0.5}
              data-testid="stacked-bars-bar"
              data-empty="true"
              data-label={bar.label}
            />
          );
        }
        let yCursor = H - PAD;
        return (
          <g key={i} data-testid="stacked-bars-bar" data-label={bar.label}>
            {bar.segments.map((v, segIdx) => {
              const seg = Math.max(0, v);
              if (seg === 0) return null;
              const h = (seg / safeMax) * (H - 2 * PAD);
              const y = yCursor - h;
              yCursor = y;
              const colorRaw = segmentColors[segIdx] ?? "accent";
              const fill =
                colorRaw in ACCENT_VAR
                  ? ACCENT_VAR[colorRaw as StackedBarsAccent]
                  : (colorRaw as string);
              return (
                <rect
                  key={segIdx}
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(0.5, h)}
                  fill={fill}
                  data-testid="stacked-bars-segment"
                  data-segment={segIdx}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
