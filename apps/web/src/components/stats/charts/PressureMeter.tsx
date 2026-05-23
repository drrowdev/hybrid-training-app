/**
 * PressureMeter — horizontal pressure-meter for the Phase 6 engine page.
 *
 * Renders a single horizontal bar where:
 *   - `value` is the current pressure (0..1+).
 *   - The fill width clamps to 1.0 (100% of ceiling), with anything above
 *     1.0 rendered as a separate "over-ceiling" segment in danger color
 *     so an overshoot stays visible without distorting the meter scale.
 *   - Optional `marks` (e.g. an MEV/MAV/MRV reference, or a 70%/90% band)
 *     render as thin vertical ticks across the meter.
 *
 * Maps to DC-C2 "bucket pressure" presentation: low = green / ok,
 * approaching ceiling = warning, over ceiling = danger.
 *
 * Vanilla SVG; consistent with the Phase 1-5 chart primitives. Default
 * 200×16 viewBox keeps the meter compact next to a label column on
 * desktop but stretches to full width on mobile via 100% width style.
 */
import type { CSSProperties } from "react";

const W = 200;
const DEFAULT_H = 16;
const PAD = 1;

export type PressureTone = "ok" | "caution" | "warn" | "danger";

const TONE_VAR: Record<PressureTone, string> = {
  ok: "var(--cp-success)",
  caution: "var(--cp-warning)",
  warn: "var(--cp-warning)",
  danger: "var(--cp-danger)",
};

export type PressureMark = {
  /** Position on the meter, expressed as a fraction of the ceiling (0..1+). */
  at: number;
  /** Tick color. Defaults to var(--cp-border-strong). */
  color?: string;
  /** Optional <title> + aria text. */
  label?: string;
};

/**
 * Tone selector matching the v2 bucket-pressure bands:
 *   <70%  ok (green)
 *   70-90% caution (amber)
 *   90-110% warn (amber-red boundary)
 *   ≥110%  danger (red, over ceiling)
 */
export function pressureTone(value: number): PressureTone {
  if (value < 0.7) return "ok";
  if (value < 0.9) return "caution";
  if (value < 1.1) return "warn";
  return "danger";
}

export function PressureMeter({
  value,
  marks,
  tone,
  height,
  style,
  ariaLabel,
}: {
  /** Current pressure expressed as a fraction of ceiling. 1.0 = at ceiling. */
  value: number;
  /** Optional reference marks rendered as vertical ticks. */
  marks?: PressureMark[];
  /** Override the auto-derived tone. */
  tone?: PressureTone;
  /** SVG viewport height — defaults to 16. */
  height?: number;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const H = height && height > 0 ? height : DEFAULT_H;
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
  const fillTone = tone ?? pressureTone(safeValue);
  const fillColor = TONE_VAR[fillTone];

  // Meter scale: 0..1.0 is the "in-bounds" zone (the full meter width).
  // Anything above 1.0 renders as a danger-coloured "over" stripe stacked
  // to the right edge so an overshoot is clearly visible.
  const inBoundsPct = Math.min(1, safeValue);
  const overPct = Math.max(0, safeValue - 1);
  const overTone = TONE_VAR.danger;
  const usableW = W - 2 * PAD;
  const inBoundsW = inBoundsPct * usableW;
  // Over-ceiling stripe: visually capped at 30% extra so an extreme value
  // does not eat the rest of the layout.
  const overW = Math.min(0.3, overPct) * usableW;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel ?? `pressure meter at ${(safeValue * 100).toFixed(0)}% of ceiling`}
      data-testid="pressure-meter"
      style={{ width: "100%", height: H, display: "block", ...style }}
    >
      {/* Track */}
      <rect
        x={PAD}
        y={PAD}
        width={usableW}
        height={H - 2 * PAD}
        rx={H / 4}
        fill="var(--cp-surface-soft)"
        data-testid="pressure-meter-track"
      />
      {/* In-bounds fill */}
      {inBoundsW > 0 && (
        <rect
          x={PAD}
          y={PAD}
          width={inBoundsW}
          height={H - 2 * PAD}
          rx={H / 4}
          fill={fillColor}
          data-testid="pressure-meter-fill"
        />
      )}
      {/* Over-ceiling stripe (offset to the right of the in-bounds fill) */}
      {overW > 0 && (
        <rect
          x={PAD + inBoundsW}
          y={PAD}
          width={overW}
          height={H - 2 * PAD}
          fill={overTone}
          data-testid="pressure-meter-over"
        />
      )}
      {/* Reference marks */}
      {(marks ?? []).map((m, i) => {
        const x = PAD + Math.max(0, Math.min(1, m.at)) * usableW;
        return (
          <line
            key={i}
            x1={x}
            x2={x}
            y1={PAD}
            y2={H - PAD}
            stroke={m.color ?? "var(--cp-border-strong)"}
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
            data-testid="pressure-meter-mark"
          >
            {m.label ? <title>{m.label}</title> : null}
          </line>
        );
      })}
    </svg>
  );
}
