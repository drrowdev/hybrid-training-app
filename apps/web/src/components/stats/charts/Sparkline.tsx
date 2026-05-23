/**
 * Sparkline — vanilla SVG mini line chart, sized for inline use in
 * dashboard cards (default viewBox 120×40). No new dependency; the
 * primitives in this directory are the canonical chart kit for stats
 * surfaces (see Phase 1 brief "SVG chart primitives").
 *
 * Single-tone fill under the line — color picked from the Clawpilot
 * semantic palette via the `accent` prop. Empty input renders the
 * baseline so the card still has a deliberate shape.
 */
import type { CSSProperties } from "react";

export type SparklineAccent = "success" | "warning" | "danger" | "accent";

const ACCENT_VAR: Record<SparklineAccent, string> = {
  success: "var(--cp-success)",
  warning: "var(--cp-warning)",
  danger: "var(--cp-danger)",
  accent: "var(--cp-accent)",
};

const W = 120;
const H = 40;
const PAD = 2;

export function Sparkline({
  values,
  accent = "accent",
  style,
  ariaLabel,
}: {
  values: number[];
  accent?: SparklineAccent;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const color = ACCENT_VAR[accent];
  const n = values.length;
  if (n === 0) {
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel ?? "sparkline (no data)"}
        data-testid="sparkline"
        style={{ width: "100%", height: H, display: "block", ...style }}
      >
        <line
          x1={PAD}
          x2={W - PAD}
          y1={H / 2}
          y2={H / 2}
          stroke="var(--cp-border)"
          strokeDasharray="2 2"
        />
      </svg>
    );
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = n === 1 ? 0 : (W - 2 * PAD) / (n - 1);
  const points = values.map((v, i) => {
    const x = PAD + stepX * i;
    const y = H - PAD - ((v - min) / span) * (H - 2 * PAD);
    return { x, y };
  });
  const linePath =
    n === 1
      ? `M${points[0].x},${points[0].y} L${W - PAD},${points[0].y}`
      : "M" + points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" L");
  const fillPath =
    n === 1
      ? `M${PAD},${H - PAD} L${W - PAD},${H - PAD} L${W - PAD},${points[0].y} L${PAD},${points[0].y} Z`
      : `${linePath} L${(W - PAD).toFixed(2)},${(H - PAD).toFixed(2)} L${PAD.toFixed(2)},${(H - PAD).toFixed(2)} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel ?? `sparkline of ${n} values`}
      data-testid="sparkline"
      style={{ width: "100%", height: H, display: "block", ...style }}
    >
      <path
        d={fillPath}
        fill={color}
        opacity={0.18}
        data-testid="sparkline-fill"
      />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        data-testid="sparkline-line"
      />
    </svg>
  );
}
