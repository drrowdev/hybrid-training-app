/**
 * BodyweightSparkline — pure SVG, server-renderable. ~280×60 by default.
 *
 * Draws the raw points as a polyline plus a faint 7-day rolling-mean
 * curve underneath so the trend is visible regardless of daily noise.
 * Renders nothing when fewer than 2 points are supplied — callers
 * should render the EmptyState above instead.
 */

import type { ReactElement } from "react";
import type { BodyweightPoint } from "@/lib/profile/queries";

export type BodyweightSparklineProps = {
  points: BodyweightPoint[];
  width?: number;
  height?: number;
};

function rollingMean(values: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    out.push(sum / slice.length);
  }
  return out;
}

export function BodyweightSparkline({
  points,
  width = 280,
  height = 60,
}: BodyweightSparklineProps): ReactElement | null {
  if (points.length < 2) return null;

  const PAD_X = 4;
  const PAD_Y = 6;
  const innerW = width - PAD_X * 2;
  const innerH = height - PAD_Y * 2;

  const kgs = points.map((p) => p.kg);
  const min = Math.min(...kgs);
  const max = Math.max(...kgs);
  // Guard against a flat line (min == max) — keeps the curve centred.
  const span = max - min || 1;

  const xFor = (i: number) =>
    PAD_X + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yFor = (kg: number) =>
    PAD_Y + (1 - (kg - min) / span) * innerH;

  const rawPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.kg).toFixed(1)}`)
    .join(" ");

  const smoothed = rollingMean(kgs, 7);
  const smoothPath = smoothed
    .map((kg, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(kg).toFixed(1)}`)
    .join(" ");

  const lastIdx = points.length - 1;

  return (
    <svg
      data-testid="bodyweight-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Bodyweight ${min.toFixed(1)} – ${max.toFixed(1)} kg across the last 90 days`}
      style={{ display: "block" }}
    >
      <path
        d={smoothPath}
        fill="none"
        stroke="var(--cp-text-muted)"
        strokeOpacity={0.4}
        strokeWidth={1.5}
      />
      <path
        d={rawPath}
        fill="none"
        stroke="var(--cp-accent, var(--cp-text))"
        strokeWidth={1.5}
      />
      <circle
        cx={xFor(lastIdx)}
        cy={yFor(points[lastIdx]!.kg)}
        r={2.5}
        fill="var(--cp-accent, var(--cp-text))"
      />
    </svg>
  );
}
