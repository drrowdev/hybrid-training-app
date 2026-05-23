/**
 * MiniScatter — vanilla SVG scatter plot for dashboard cards.
 *
 * Sized into a 280×200 viewBox by default (larger than the 120×40 inline
 * primitives because it carries two axes + a reference line). Used by
 * the Wellness dashboard's "predicted vs actual" card (Phase 3, A5) to
 * plot pre-session fatigue+soreness against post-session sRPE.
 *
 * Optional `referenceLine` draws a single straight line — typically the
 * y=x identity line for the "perfect prediction" reference.
 *
 * No new dependency: same SVG-only rule as Sparkline / MiniBars / MiniLine.
 */
import type { CSSProperties } from "react";

export type MiniScatterAccent = "success" | "warning" | "danger" | "accent";

const ACCENT_VAR: Record<MiniScatterAccent, string> = {
  success: "var(--cp-success)",
  warning: "var(--cp-warning)",
  danger: "var(--cp-danger)",
  accent: "var(--cp-accent)",
};

const W = 280;
const H = 200;
const PAD = 24;

export type ScatterPoint = { x: number; y: number };

export function MiniScatter({
  points,
  xMin,
  xMax,
  yMin,
  yMax,
  referenceLine,
  accent = "accent",
  xLabel,
  yLabel,
  style,
  ariaLabel,
}: {
  points: ScatterPoint[];
  /** Override axis bounds; otherwise derived from points. */
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** Reference line as [x1,y1,x2,y2] in data coordinates. */
  referenceLine?: [number, number, number, number];
  accent?: MiniScatterAccent;
  xLabel?: string;
  yLabel?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const color = ACCENT_VAR[accent];
  const n = points.length;

  if (n === 0) {
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel ?? "scatter plot (no data)"}
        data-testid="miniscatter"
        style={{ width: "100%", height: "auto", display: "block", ...style }}
      >
        <line
          x1={PAD}
          x2={W - PAD}
          y1={H - PAD}
          y2={H - PAD}
          stroke="var(--cp-border)"
        />
        <line
          x1={PAD}
          x2={PAD}
          y1={PAD}
          y2={H - PAD}
          stroke="var(--cp-border)"
        />
      </svg>
    );
  }

  const dataXMin = xMin ?? Math.min(...points.map((p) => p.x));
  const dataXMax = xMax ?? Math.max(...points.map((p) => p.x));
  const dataYMin = yMin ?? Math.min(...points.map((p) => p.y));
  const dataYMax = yMax ?? Math.max(...points.map((p) => p.y));
  const xSpan = dataXMax - dataXMin || 1;
  const ySpan = dataYMax - dataYMin || 1;

  const plotW = W - 2 * PAD;
  const plotH = H - 2 * PAD;

  function toX(x: number): number {
    return PAD + ((x - dataXMin) / xSpan) * plotW;
  }
  function toY(y: number): number {
    return H - PAD - ((y - dataYMin) / ySpan) * plotH;
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel ?? `scatter plot of ${n} points`}
      data-testid="miniscatter"
      style={{ width: "100%", height: "auto", display: "block", ...style }}
    >
      {/* Axes */}
      <line
        x1={PAD}
        x2={W - PAD}
        y1={H - PAD}
        y2={H - PAD}
        stroke="var(--cp-border)"
        data-testid="miniscatter-axis-x"
      />
      <line
        x1={PAD}
        x2={PAD}
        y1={PAD}
        y2={H - PAD}
        stroke="var(--cp-border)"
        data-testid="miniscatter-axis-y"
      />

      {/* Reference line (e.g. y = x) */}
      {referenceLine && (
        <line
          x1={toX(referenceLine[0])}
          y1={toY(referenceLine[1])}
          x2={toX(referenceLine[2])}
          y2={toY(referenceLine[3])}
          stroke="var(--cp-text-muted)"
          strokeDasharray="3 3"
          strokeWidth={1}
          data-testid="miniscatter-reference"
        />
      )}

      {/* Points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={toX(p.x).toFixed(2)}
          cy={toY(p.y).toFixed(2)}
          r={3.5}
          fill={color}
          fillOpacity={0.7}
          stroke={color}
          strokeWidth={0.5}
          data-testid="miniscatter-point"
        />
      ))}

      {/* Axis labels */}
      {xLabel && (
        <text
          x={W / 2}
          y={H - 4}
          textAnchor="middle"
          fontSize={10}
          fill="var(--cp-text-muted)"
        >
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text
          x={6}
          y={H / 2}
          textAnchor="middle"
          fontSize={10}
          fill="var(--cp-text-muted)"
          transform={`rotate(-90 6 ${H / 2})`}
        >
          {yLabel}
        </text>
      )}
    </svg>
  );
}
