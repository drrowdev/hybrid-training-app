/**
 * MiniLine — line-only variant of Sparkline (no fill underneath).
 *
 * Default 120×40 viewBox keeps inline dashboard cards lined up; pass
 * `height` to expand to a "tall" variant (e.g. the Phase 5 per-movement
 * e1RM trend renders at 200px). `markers` overlays small filled dots at
 * specific indices (Phase 5 PR markers).
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
const DEFAULT_H = 40;
const PAD = 2;

export type MiniLineMarker = {
  /** Index into `values`. Out-of-range markers are ignored. */
  index: number;
  /** Per-marker color (defaults to var(--cp-danger) for PR-style dots). */
  color?: string;
  /** Optional <title> tooltip text. */
  label?: string;
};

export function MiniLine({
  values,
  overlay,
  markers,
  accent = "accent",
  height,
  style,
  ariaLabel,
}: {
  values: number[];
  /**
   * Optional second series rendered as a thin dashed line on top of the
   * main line, sharing the same y-scale. Used for trend / rolling-avg
   * overlays on the Wellness dashboard (Phase 3) and the linear-regression
   * trend on the Phase 5 movement deep-dive. Must be the same length as
   * `values` (or empty).
   */
  overlay?: number[];
  /**
   * Optional dot markers overlaid on the main line, e.g. PR sessions on
   * the e1RM trend. Each marker references an index into `values`; the
   * dot is rendered at that point on the line.
   */
  markers?: MiniLineMarker[];
  accent?: MiniLineAccent;
  /** SVG viewport height — defaults to the compact 40px card variant. */
  height?: number;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const color = ACCENT_VAR[accent];
  const H = height && height > 0 ? height : DEFAULT_H;
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
  const max = Math.max(...values, ...(overlay ?? []));
  const min = Math.min(...values, ...(overlay ?? []));
  const span = max - min || 1;
  const stepX = n === 1 ? 0 : (W - 2 * PAD) / (n - 1);
  const yAt = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const xAt = (i: number) => PAD + stepX * i;
  const points = values.map((v, i) => `${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`);
  const path =
    n === 1
      ? `M${PAD},${H / 2} L${W - PAD},${H / 2}`
      : "M" + points.join(" L");

  const overlayPath =
    overlay && overlay.length === n && n >= 2
      ? "M" +
        overlay
          .map((v, i) => `${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`)
          .join(" L")
      : null;

  const markerDots = (markers ?? []).filter(
    (m) => m.index >= 0 && m.index < n,
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
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
        vectorEffect="non-scaling-stroke"
        data-testid="miniline-path"
      />
      {overlayPath && (
        <path
          d={overlayPath}
          fill="none"
          stroke="var(--cp-text-muted)"
          strokeWidth={1}
          strokeDasharray="2 2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          data-testid="miniline-overlay"
        />
      )}
      {markerDots.map((m) => (
        <circle
          key={m.index}
          cx={xAt(m.index)}
          cy={yAt(values[m.index]!)}
          r={1.6}
          fill={m.color ?? "var(--cp-danger)"}
          vectorEffect="non-scaling-stroke"
          data-testid="miniline-marker"
        >
          {m.label ? <title>{m.label}</title> : null}
        </circle>
      ))}
    </svg>
  );
}
