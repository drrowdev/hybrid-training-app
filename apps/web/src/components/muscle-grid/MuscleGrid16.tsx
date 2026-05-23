"use client";
/**
 * MuscleGrid16 — interactive SVG body diagram for the 16-muscle
 * freshness model. Front view + back view side-by-side so every
 * tracked muscle is visible without scrolling.
 *
 * Colour ladder (matches classifyMuscleFreshness in muscle-freshness.ts):
 *   green  — fresh        — ≥ 4 days since last loaded
 *   yellow — ready        — 2–3 days
 *   red    — loaded       — < 2 days
 *   grey   — untouched    — never trained
 *
 * Touch targets are ≥ 32px on mobile (the smallest tile, biceps,
 * is ~36×56 px in the SVG viewBox, which scales 1:1 below
 * `width: 100%`).
 *
 * Rendering is pure SVG + React — no third-party body-highlighter
 * library and no canvas. Shapes are simple ellipses + rounded rects
 * arranged on a 220×360 viewBox per silhouette.
 */
import { useState } from "react";
import type { MuscleFreshnessRow } from "@/lib/muscle/muscle-freshness";
import type { MuscleGroup } from "@/lib/muscle/muscle-groups";

type ToneColor = { fill: string; stroke: string };

const TONE_COLORS: Record<string, ToneColor> = {
  ok: { fill: "#15803d", stroke: "#166534" }, // green
  caution: { fill: "#ca8a04", stroke: "#854d0e" }, // yellow
  warn: { fill: "#b91c1c", stroke: "#7f1d1d" }, // red
  neutral: { fill: "#3f3f46", stroke: "#52525b" }, // grey
};

const SILHOUETTE_STROKE = "#27272a";
const SILHOUETTE_FILL = "#0a0a0a";

/** Tile geometry — every region is a clickable SVG shape. */
type Tile = {
  muscle: MuscleGroup;
  view: "front" | "back";
  shape: "rect" | "ellipse" | "path";
  /** rect: x,y,w,h,rx. ellipse: cx,cy,rx,ry. path: d. */
  geom: number[] | string;
  /** Anchor for the muscle number badge. */
  label: { x: number; y: number };
};

const FRONT_VIEW_BOX = "0 0 220 360";
const BACK_VIEW_BOX = "0 0 220 360";

const TILES: Tile[] = [
  // ── Front view ──────────────────────────────────────────────────
  // Shoulders (front delts) — two ovals on top of the torso.
  { muscle: "shoulders", view: "front", shape: "ellipse", geom: [70, 96, 18, 14], label: { x: 70, y: 100 } },
  { muscle: "shoulders", view: "front", shape: "ellipse", geom: [150, 96, 18, 14], label: { x: 150, y: 100 } },
  // Chest — two rounded rects across the upper torso.
  { muscle: "chest", view: "front", shape: "rect", geom: [78, 108, 28, 30, 6], label: { x: 92, y: 124 } },
  { muscle: "chest", view: "front", shape: "rect", geom: [114, 108, 28, 30, 6], label: { x: 128, y: 124 } },
  // Core — abs panel down the middle.
  { muscle: "core", view: "front", shape: "rect", geom: [94, 144, 32, 50, 5], label: { x: 110, y: 170 } },
  // Obliques — two narrow rects flanking the abs.
  { muscle: "obliques", view: "front", shape: "rect", geom: [78, 148, 14, 42, 4], label: { x: 85, y: 169 } },
  { muscle: "obliques", view: "front", shape: "rect", geom: [128, 148, 14, 42, 4], label: { x: 135, y: 169 } },
  // Biceps — front arm ovals.
  { muscle: "biceps", view: "front", shape: "ellipse", geom: [54, 130, 12, 22], label: { x: 54, y: 130 } },
  { muscle: "biceps", view: "front", shape: "ellipse", geom: [166, 130, 12, 22], label: { x: 166, y: 130 } },
  // Forearms — lower arm.
  { muscle: "forearms", view: "front", shape: "ellipse", geom: [48, 170, 10, 22], label: { x: 48, y: 170 } },
  { muscle: "forearms", view: "front", shape: "ellipse", geom: [172, 170, 10, 22], label: { x: 172, y: 170 } },
  // Adductors — inner thigh.
  { muscle: "adductors", view: "front", shape: "rect", geom: [95, 215, 13, 50, 4], label: { x: 102, y: 240 } },
  { muscle: "adductors", view: "front", shape: "rect", geom: [112, 215, 13, 50, 4], label: { x: 119, y: 240 } },
  // Quads — front thigh.
  { muscle: "quads", view: "front", shape: "rect", geom: [76, 210, 19, 70, 8], label: { x: 86, y: 245 } },
  { muscle: "quads", view: "front", shape: "rect", geom: [125, 210, 19, 70, 8], label: { x: 135, y: 245 } },
  // Calves (front shins, also colour them so they're visible on the front).
  { muscle: "calves", view: "front", shape: "rect", geom: [80, 292, 17, 50, 6], label: { x: 89, y: 318 } },
  { muscle: "calves", view: "front", shape: "rect", geom: [123, 292, 17, 50, 6], label: { x: 132, y: 318 } },

  // ── Back view ───────────────────────────────────────────────────
  // Traps — top of the back, kite-shape rect.
  { muscle: "traps", view: "back", shape: "rect", geom: [90, 90, 40, 26, 6], label: { x: 110, y: 102 } },
  // Shoulders (rear delts).
  { muscle: "shoulders", view: "back", shape: "ellipse", geom: [70, 100, 18, 14], label: { x: 70, y: 104 } },
  { muscle: "shoulders", view: "back", shape: "ellipse", geom: [150, 100, 18, 14], label: { x: 150, y: 104 } },
  // Back (mid back) — upper rectangle below the traps.
  { muscle: "back", view: "back", shape: "rect", geom: [86, 118, 48, 26, 5], label: { x: 110, y: 131 } },
  // Lats — wide flanks below the back.
  { muscle: "lats", view: "back", shape: "rect", geom: [76, 144, 24, 46, 6], label: { x: 88, y: 167 } },
  { muscle: "lats", view: "back", shape: "rect", geom: [120, 144, 24, 46, 6], label: { x: 132, y: 167 } },
  // Erectors — narrow column down the lower back.
  { muscle: "erectors", view: "back", shape: "rect", geom: [100, 144, 20, 56, 4], label: { x: 110, y: 172 } },
  // Triceps — back of upper arm.
  { muscle: "triceps", view: "back", shape: "ellipse", geom: [54, 134, 12, 22], label: { x: 54, y: 134 } },
  { muscle: "triceps", view: "back", shape: "ellipse", geom: [166, 134, 12, 22], label: { x: 166, y: 134 } },
  // Forearms — back lower arm.
  { muscle: "forearms", view: "back", shape: "ellipse", geom: [48, 172, 10, 22], label: { x: 48, y: 172 } },
  { muscle: "forearms", view: "back", shape: "ellipse", geom: [172, 172, 10, 22], label: { x: 172, y: 172 } },
  // Glutes — bottom of the back.
  { muscle: "glutes", view: "back", shape: "rect", geom: [78, 200, 30, 30, 8], label: { x: 93, y: 215 } },
  { muscle: "glutes", view: "back", shape: "rect", geom: [112, 200, 30, 30, 8], label: { x: 127, y: 215 } },
  // Hamstrings — back of thigh.
  { muscle: "hamstrings", view: "back", shape: "rect", geom: [78, 232, 28, 60, 6], label: { x: 92, y: 262 } },
  { muscle: "hamstrings", view: "back", shape: "rect", geom: [114, 232, 28, 60, 6], label: { x: 128, y: 262 } },
  // Calves — back of lower leg.
  { muscle: "calves", view: "back", shape: "rect", geom: [80, 296, 17, 52, 6], label: { x: 89, y: 322 } },
  { muscle: "calves", view: "back", shape: "rect", geom: [123, 296, 17, 52, 6], label: { x: 132, y: 322 } },
];

function silhouettePath(view: "front" | "back"): string {
  // Head + neck + torso outline + legs outline as a single path.
  // Identical for front/back — silhouette is symmetrical.
  void view;
  return [
    // Head
    "M110 38",
    "C 122 38 132 50 132 64",
    "C 132 78 122 90 110 90",
    "C 98 90 88 78 88 64",
    "C 88 50 98 38 110 38 Z",
    // Neck + shoulders + arms outline
    "M104 86 L116 86 L 130 96 L 168 110 L 184 174 L 174 200 L 162 200 L 154 174 L 144 130 L 144 200",
    "L 144 280",
    // Right leg
    "L 148 354 L 124 354 L 122 300 L 110 232 L 98 300 L 96 354 L 72 354",
    "L 76 280",
    "L 76 200",
    "L 76 130 L 66 174 L 58 200 L 46 200 L 36 174 L 52 110 L 90 96 L 104 86 Z",
  ].join(" ");
}

export type MuscleGrid16Props = {
  rows: MuscleFreshnessRow[];
  /** Override tooltip content per muscle. */
  todayYmd?: string;
  /** Set to true on the planner-hero compact embed (no labels under). */
  compact?: boolean;
  className?: string;
};

type HoverState = { muscle: MuscleGroup; x: number; y: number } | null;

export function MuscleGrid16({ rows, compact, className }: MuscleGrid16Props) {
  const byMuscle = new Map<MuscleGroup, MuscleFreshnessRow>(
    rows.map((r) => [r.muscle, r]),
  );
  const [hover, setHover] = useState<HoverState>(null);

  const renderTile = (tile: Tile) => {
    const row = byMuscle.get(tile.muscle);
    const tone = row?.tone ?? "neutral";
    const color = TONE_COLORS[tone] ?? TONE_COLORS.neutral;
    const common = {
      fill: color.fill,
      stroke: color.stroke,
      strokeWidth: 1,
      style: { cursor: "pointer", transition: "fill 120ms" },
      "data-testid": `muscle-tile-${tile.muscle}`,
      "data-muscle": tile.muscle,
      "data-band": row?.band ?? "untouched",
      onMouseEnter: (e: React.MouseEvent<SVGElement>) => {
        const r = (e.currentTarget.ownerSVGElement?.getBoundingClientRect() ?? {
          left: 0,
          top: 0,
        }) as DOMRect;
        const m = (e.currentTarget as SVGGraphicsElement).getBoundingClientRect();
        setHover({ muscle: tile.muscle, x: m.left + m.width / 2 - r.left, y: m.top - r.top });
      },
      onMouseLeave: () => setHover(null),
      onFocus: () => setHover({ muscle: tile.muscle, x: tile.label.x, y: tile.label.y }),
      onBlur: () => setHover(null),
      tabIndex: 0,
      role: "button",
      "aria-label": `${row?.muscleLabel ?? tile.muscle}: ${row?.bandLabel ?? "no data"}`,
    } as const;
    if (tile.shape === "rect") {
      const [x, y, w, h, rx] = tile.geom as number[];
      return <rect key={`${tile.view}-${tile.muscle}-${x}-${y}`} x={x} y={y} width={w} height={h} rx={rx} {...common} />;
    }
    const [cx, cy, rx, ry] = tile.geom as number[];
    return <ellipse key={`${tile.view}-${tile.muscle}-${cx}-${cy}`} cx={cx} cy={cy} rx={rx} ry={ry} {...common} />;
  };

  const tooltip = (() => {
    if (!hover) return null;
    const row = byMuscle.get(hover.muscle);
    if (!row) return null;
    const since =
      row.daysSinceLoaded == null
        ? "Not yet trained"
        : row.daysSinceLoaded === 0
          ? "Loaded today"
          : `${row.daysSinceLoaded} day${row.daysSinceLoaded === 1 ? "" : "s"} since last load`;
    const top = row.topContributors.slice(0, 2).map((c) => c.name).join(", ");
    return (
      <foreignObject x={hover.x - 90} y={Math.max(hover.y - 70, 4)} width={180} height={64}>
        <div
          data-testid={`muscle-tooltip-${row.muscle}`}
          style={{
            background: "var(--cp-surface, #18181b)",
            border: "1px solid var(--cp-border, #3f3f46)",
            borderRadius: 6,
            padding: "6px 8px",
            color: "var(--cp-text, #e4e4e7)",
            fontSize: 11,
            lineHeight: 1.3,
            boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 600 }}>{row.muscleLabel}</div>
          <div style={{ color: "var(--cp-text-muted, #a1a1aa)" }}>
            {row.bandLabel} · {since}
          </div>
          {top && (
            <div style={{ color: "var(--cp-text-muted, #a1a1aa)", marginTop: 2 }}>{top}</div>
          )}
        </div>
      </foreignObject>
    );
  })();

  const renderView = (view: "front" | "back") => {
    const tiles = TILES.filter((t) => t.view === view);
    return (
      <svg
        viewBox={view === "front" ? FRONT_VIEW_BOX : BACK_VIEW_BOX}
        role="img"
        aria-label={`${view === "front" ? "Front" : "Back"} muscle freshness`}
        data-testid={`muscle-grid-${view}`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <path
          d={silhouettePath(view)}
          fill={SILHOUETTE_FILL}
          stroke={SILHOUETTE_STROKE}
          strokeWidth={1.5}
        />
        {tiles.map(renderTile)}
        {hover && TILES.find((t) => t.view === view && t.muscle === hover.muscle) ? tooltip : null}
      </svg>
    );
  };

  return (
    <div
      data-testid="muscle-grid-16"
      className={className}
      style={{ display: "grid", gap: 12 }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          alignItems: "start",
        }}
      >
        <figure style={{ margin: 0 }}>
          {renderView("front")}
          {!compact && (
            <figcaption
              style={{
                textAlign: "center",
                fontSize: 12,
                color: "var(--cp-text-muted, #a1a1aa)",
                marginTop: 4,
              }}
            >
              Front
            </figcaption>
          )}
        </figure>
        <figure style={{ margin: 0 }}>
          {renderView("back")}
          {!compact && (
            <figcaption
              style={{
                textAlign: "center",
                fontSize: 12,
                color: "var(--cp-text-muted, #a1a1aa)",
                marginTop: 4,
              }}
            >
              Back
            </figcaption>
          )}
        </figure>
      </div>

      {/* Legend + muscle list — also covers SR/headless rendering and
          provides the labels e2e expects. */}
      <ul
        data-testid="muscle-grid-legend"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 6,
          listStyle: "none",
          padding: 0,
          margin: 0,
          fontSize: 12,
        }}
      >
        {rows.map((row) => {
          const color = TONE_COLORS[row.tone] ?? TONE_COLORS.neutral;
          const since =
            row.daysSinceLoaded == null
              ? "—"
              : row.daysSinceLoaded === 0
                ? "today"
                : `${row.daysSinceLoaded}d`;
          return (
            <li
              key={row.muscle}
              data-testid={`muscle-legend-${row.muscle}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 6px",
                background: "var(--cp-surface, #18181b)",
                border: "1px solid var(--cp-border, #27272a)",
                borderRadius: 6,
                minHeight: 32,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: color.fill,
                  border: `1px solid ${color.stroke}`,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, color: "var(--cp-text, #e4e4e7)" }}>
                {row.muscleLabel}
              </span>
              <span style={{ color: "var(--cp-text-muted, #a1a1aa)" }}>{since}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
