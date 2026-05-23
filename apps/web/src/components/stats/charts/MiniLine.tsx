/**
 * MiniLine — line-only variant of Sparkline (no fill underneath).
 *
 * Used when the card already has a strong visual anchor and the under-line
 * fill would create visual noise. Same 120×40 viewBox so cards line up.
 */
import type { CSSProperties } from "react";

export type MiniLineAccent = "success" | "warning" | "danger" | "accent";

const ACCENT_VAR: Record<MiniLineAccent, string> = {
  success: "var(--cp-success)",
  warning: "var(--cp-warning)",
  danger: "var(--cp-danger)",
  accent: "var(--cp-accent)",
};

const W = 120;
const H = 40;
const PAD = 2;

export function MiniLine({
  values,
  accent = "accent",
  style,
  ariaLabel,
}: {
  values: number[];
  accent?: MiniLineAccent;
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
        aria-label={ariaLabel ?? "line chart (no data)"}
        data-testid="miniline"
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
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const path =
    n === 1
      ? `M${PAD},${H / 2} L${W - PAD},${H / 2}`
      : "M" + points.join(" L");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel ?? `line chart of ${n} values`}
      data-testid="miniline"
      style={{ width: "100%", height: H, display: "block", ...style }}
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        data-testid="miniline-path"
      />
    </svg>
  );
}
