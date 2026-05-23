"use client";
/**
 * MusclePicker — compact, interactive version of the 16-muscle grid
 * used by /app/recovery/injuries' AddLimitationModal.
 *
 * Shares geometry with the read-only MuscleGrid16 (same silhouette
 * path, same tile coordinates) but is intentionally decoupled: we
 * don't pass MuscleFreshnessRow rows in. The picker's only job is to
 * surface which of the 16 MuscleGroup values the user has tapped.
 *
 * Tiles are rendered as native <button> elements wrapped in
 * <foreignObject> for accessibility (real focus ring, real click
 * targets, real keyboard handling). Selected tiles get an accent fill
 * so they're obvious against the muted silhouette.
 *
 * The shape data is kept in this file rather than imported from
 * MuscleGrid16 because that component is "use client" with its own
 * hover state — pulling its TILES export would couple two surfaces
 * we want to evolve independently. Both files trace back to the same
 * canonical 16-muscle catalog in lib/muscle/muscle-groups.ts.
 */
import type { CSSProperties, ReactElement } from "react";
import {
  ALL_MUSCLE_GROUPS,
  MUSCLE_LABELS,
  type MuscleGroup,
} from "@/lib/muscle/muscle-groups";

type TileShape = "rect" | "ellipse";

type Tile = {
  muscle: MuscleGroup;
  view: "front" | "back";
  shape: TileShape;
  geom: number[];
};

const TILES: Tile[] = [
  // Front
  { muscle: "shoulders", view: "front", shape: "ellipse", geom: [70, 96, 18, 14] },
  { muscle: "shoulders", view: "front", shape: "ellipse", geom: [150, 96, 18, 14] },
  { muscle: "chest", view: "front", shape: "rect", geom: [78, 108, 28, 30, 6] },
  { muscle: "chest", view: "front", shape: "rect", geom: [114, 108, 28, 30, 6] },
  { muscle: "core", view: "front", shape: "rect", geom: [94, 144, 32, 50, 5] },
  { muscle: "obliques", view: "front", shape: "rect", geom: [78, 148, 14, 42, 4] },
  { muscle: "obliques", view: "front", shape: "rect", geom: [128, 148, 14, 42, 4] },
  { muscle: "biceps", view: "front", shape: "ellipse", geom: [54, 130, 12, 22] },
  { muscle: "biceps", view: "front", shape: "ellipse", geom: [166, 130, 12, 22] },
  { muscle: "forearms", view: "front", shape: "ellipse", geom: [48, 170, 10, 22] },
  { muscle: "forearms", view: "front", shape: "ellipse", geom: [172, 170, 10, 22] },
  { muscle: "adductors", view: "front", shape: "rect", geom: [95, 215, 13, 50, 4] },
  { muscle: "adductors", view: "front", shape: "rect", geom: [112, 215, 13, 50, 4] },
  { muscle: "quads", view: "front", shape: "rect", geom: [76, 210, 19, 70, 8] },
  { muscle: "quads", view: "front", shape: "rect", geom: [125, 210, 19, 70, 8] },
  { muscle: "calves", view: "front", shape: "rect", geom: [80, 292, 17, 50, 6] },
  { muscle: "calves", view: "front", shape: "rect", geom: [123, 292, 17, 50, 6] },
  // Back
  { muscle: "traps", view: "back", shape: "rect", geom: [90, 90, 40, 26, 6] },
  { muscle: "shoulders", view: "back", shape: "ellipse", geom: [70, 100, 18, 14] },
  { muscle: "shoulders", view: "back", shape: "ellipse", geom: [150, 100, 18, 14] },
  { muscle: "back", view: "back", shape: "rect", geom: [86, 118, 48, 26, 5] },
  { muscle: "lats", view: "back", shape: "rect", geom: [76, 144, 24, 46, 6] },
  { muscle: "lats", view: "back", shape: "rect", geom: [120, 144, 24, 46, 6] },
  { muscle: "erectors", view: "back", shape: "rect", geom: [100, 144, 20, 56, 4] },
  { muscle: "triceps", view: "back", shape: "ellipse", geom: [54, 134, 12, 22] },
  { muscle: "triceps", view: "back", shape: "ellipse", geom: [166, 134, 12, 22] },
  { muscle: "forearms", view: "back", shape: "ellipse", geom: [48, 172, 10, 22] },
  { muscle: "forearms", view: "back", shape: "ellipse", geom: [172, 172, 10, 22] },
  { muscle: "glutes", view: "back", shape: "rect", geom: [78, 200, 30, 30, 8] },
  { muscle: "glutes", view: "back", shape: "rect", geom: [112, 200, 30, 30, 8] },
  { muscle: "hamstrings", view: "back", shape: "rect", geom: [78, 232, 28, 60, 6] },
  { muscle: "hamstrings", view: "back", shape: "rect", geom: [114, 232, 28, 60, 6] },
  { muscle: "calves", view: "back", shape: "rect", geom: [80, 296, 17, 52, 6] },
  { muscle: "calves", view: "back", shape: "rect", geom: [123, 296, 17, 52, 6] },
];

const SILHOUETTE_PATH = [
  "M110 38",
  "C 122 38 132 50 132 64",
  "C 132 78 122 90 110 90",
  "C 98 90 88 78 88 64",
  "C 88 50 98 38 110 38 Z",
  "M104 86 L116 86 L 130 96 L 168 110 L 184 174 L 174 200 L 162 200 L 154 174 L 144 130 L 144 200",
  "L 144 280",
  "L 148 354 L 124 354 L 122 300 L 110 232 L 98 300 L 96 354 L 72 354",
  "L 76 280",
  "L 76 200",
  "L 76 130 L 66 174 L 58 200 L 46 200 L 36 174 L 52 110 L 90 96 L 104 86 Z",
].join(" ");

export type MusclePickerProps = {
  selected: ReadonlyArray<MuscleGroup>;
  onChange: (next: MuscleGroup[]) => void;
  /** Hide the muscle chip list below the silhouettes (modal-tight mode). */
  hideChipList?: boolean;
};

export function MusclePicker({
  selected,
  onChange,
  hideChipList = false,
}: MusclePickerProps): ReactElement {
  const selSet = new Set(selected);

  const toggle = (m: MuscleGroup) => {
    const next = new Set(selSet);
    if (next.has(m)) next.delete(m);
    else next.add(m);
    onChange(Array.from(next));
  };

  const renderTile = (tile: Tile, index: number) => {
    const isOn = selSet.has(tile.muscle);
    const fill = isOn ? "var(--cp-accent)" : "var(--cp-surface-soft, #27272a)";
    const stroke = isOn ? "var(--cp-accent-hover, var(--cp-accent))" : "var(--cp-border, #3f3f46)";
    const common = {
      fill,
      stroke,
      strokeWidth: 1,
      style: { cursor: "pointer", transition: "fill 120ms" } as CSSProperties,
      role: "checkbox" as const,
      "aria-checked": isOn,
      "aria-label": `${MUSCLE_LABELS[tile.muscle]} (${tile.view})`,
      "data-testid": `muscle-pick-${tile.muscle}-${tile.view}-${index}`,
      "data-muscle": tile.muscle,
      "data-selected": isOn ? "true" : "false",
      tabIndex: 0,
      onClick: () => toggle(tile.muscle),
      onKeyDown: (e: React.KeyboardEvent<SVGElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle(tile.muscle);
        }
      },
    };
    if (tile.shape === "rect") {
      const [x, y, w, h, rx] = tile.geom;
      return <rect key={index} x={x} y={y} width={w} height={h} rx={rx ?? 4} {...common} />;
    }
    const [cx, cy, rx, ry] = tile.geom;
    return <ellipse key={index} cx={cx} cy={cy} rx={rx} ry={ry} {...common} />;
  };

  const renderView = (view: "front" | "back") => (
    <svg
      viewBox="0 0 220 360"
      role="img"
      aria-label={`${view === "front" ? "Front" : "Back"} muscle picker`}
      data-testid={`muscle-picker-${view}`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <path
        d={SILHOUETTE_PATH}
        fill="var(--cp-bg, #0a0a0a)"
        stroke="var(--cp-border, #27272a)"
        strokeWidth={1.5}
      />
      {TILES.filter((t) => t.view === view).map(renderTile)}
    </svg>
  );

  return (
    <div data-testid="muscle-picker" style={{ display: "grid", gap: 10 }}>
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
          <figcaption
            style={{
              textAlign: "center",
              fontSize: 11,
              color: "var(--cp-text-muted)",
              marginTop: 4,
            }}
          >
            Front
          </figcaption>
        </figure>
        <figure style={{ margin: 0 }}>
          {renderView("back")}
          <figcaption
            style={{
              textAlign: "center",
              fontSize: 11,
              color: "var(--cp-text-muted)",
              marginTop: 4,
            }}
          >
            Back
          </figcaption>
        </figure>
      </div>
      {!hideChipList && (
        <div
          data-testid="muscle-picker-chip-list"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          {ALL_MUSCLE_GROUPS.map((m) => {
            const isOn = selSet.has(m);
            return (
              <button
                key={m}
                type="button"
                data-testid={`muscle-pick-chip-${m}`}
                data-selected={isOn ? "true" : "false"}
                onClick={() => toggle(m)}
                style={{
                  border: "1px solid var(--cp-border)",
                  borderRadius: 999,
                  padding: "4px 10px",
                  fontSize: 12,
                  background: isOn ? "var(--cp-accent-soft, var(--cp-accent))" : "transparent",
                  color: isOn ? "var(--cp-accent, var(--cp-text))" : "var(--cp-text-muted)",
                  cursor: "pointer",
                }}
              >
                {MUSCLE_LABELS[m]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
