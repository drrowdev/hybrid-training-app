/**
 * MiniBars — vanilla SVG bar chart for dashboard cards.
 *
 * One bar per input value, sized into a 120×40 viewBox by default. Per-bar
 * color can be overridden by passing a `colors` array of the same length;
 * otherwise every bar uses the `accent` token.
 *
 * Empty / all-zero inputs degrade to a thin baseline so the card keeps a
 * deliberate shape.
 */
import type { CSSProperties } from "react";

export type MiniBarsAccent = "success" | "warning" | "danger" | "accent";

const ACCENT_VAR: Record<MiniBarsAccent, string> = {
  success: "var(--cp-success)",
  warning: "var(--cp-warning)",
  danger: "var(--cp-danger)",
  accent: "var(--cp-accent)",
};

const W = 120;
const DEFAULT_H = 40;
const PAD = 2;
const GAP = 2;

export function MiniBars({
  values,
  max,
  accent = "accent",
  colors,
  overlay,
  height,
  style,
  ariaLabel,
}: {
  values: number[];
  /** Override max for the y-axis. Defaults to max(values). */
  max?: number;
  accent?: MiniBarsAccent;
  /** Per-bar CSS color, same length as `values`. Overrides `accent`. */
  colors?: string[];
  /**
   * Optional second series rendered as a thin dashed line on top of
   * the bars, sharing the same y-scale. Used for rolling-average
   * overlays on the Wellness dashboard (Phase 3). Must be the same
   * length as `values`; `null` entries (e.g. not enough data yet for
   * a window) are skipped.
   */
  overlay?: Array<number | null>;
  /** SVG viewport height — defaults to the compact 40px card variant. */
  height?: number;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const baseColor = ACCENT_VAR[accent];
  const H = height && height > 0 ? height : DEFAULT_H;
  const n = values.length;
  if (n === 0) {
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel ?? "bar chart (no data)"}
        data-testid="minibars"
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
  const yMax = max ?? Math.max(...values, 0);
  const safeMax = yMax > 0 ? yMax : 1;
  const totalGap = GAP * (n - 1);
  const barW = Math.max(1, (W - 2 * PAD - totalGap) / n);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel ?? `bar chart of ${n} values`}
      data-testid="minibars"
      style={{ width: "100%", height: H, display: "block", ...style }}
    >
      {values.map((v, i) => {
        const h = Math.max(1, ((v > 0 ? v : 0) / safeMax) * (H - 2 * PAD));
        const x = PAD + i * (barW + GAP);
        const y = H - PAD - h;
        const fill = colors?.[i] ?? baseColor;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            fill={fill}
            rx={1}
            data-testid="minibars-bar"
          />
        );
      })}
      {overlay && overlay.length === n && (() => {
        const pts: string[] = [];
        for (let i = 0; i < n; i++) {
          const v = overlay[i];
          if (v == null) continue;
          const x = PAD + i * (barW + GAP) + barW / 2;
          const y = H - PAD - ((v > 0 ? v : 0) / safeMax) * (H - 2 * PAD);
          pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
        }
        if (pts.length < 2) return null;
        return (
          <path
            d={"M" + pts.join(" L")}
            fill="none"
            stroke="var(--cp-text-muted)"
            strokeWidth={1}
            strokeDasharray="2 2"
            strokeLinejoin="round"
            strokeLinecap="round"
            data-testid="minibars-overlay"
          />
        );
      })()}
    </svg>
  );
}
