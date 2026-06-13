"use client";

/**
 * Visual plate-per-side breakdown rendered next to the target weight
 * inside `<MovementFocusView>`. Pure render — the maths lives in
 * `plate-math.ts` so it's directly testable.
 *
 * Each plate weight gets its real-world IWF / Rogue calibrated colour
 * (25 = red, 20 = blue, 15 = yellow, 10 = green, 5 = white) so the
 * stack reads like an actual loaded bar and the user builds an
 * associative memory ("the blue ones are 20s") across sessions. These
 * are physical-standard colours, intentionally theme-independent.
 */

import { computePlateBreakdown, type PlateInventoryItem } from "./plate-math";

export type PlateViewProps = {
  targetWeightKg: number;
  barWeightKg: number;
  inventory: PlateInventoryItem[];
};

// IWF / Rogue calibrated plate colours. Fixed real-world hues (not theme
// tokens) so a 20 always reads blue, a 15 yellow, etc. The change plates
// (5 = white, 2.5 = red, 1.25 = chrome) follow the same IWF convention.
const PLATE_COLORS: Array<{ max: number; bg: string; fg: string }> = [
  { max: 25, bg: "#ce1126", fg: "#fff" },
  { max: 20, bg: "#0a5fb4", fg: "#fff" },
  { max: 15, bg: "#f4c20d", fg: "#111" },
  { max: 10, bg: "#1aa64b", fg: "#fff" },
  { max: 5, bg: "#ececec", fg: "#111" },
  { max: 2.5, bg: "#ce1126", fg: "#fff" },
  // Chrome wedge for sub-2.5 micros (1.25, 0.5).
  { max: 1.25, bg: "#aeb4bc", fg: "#111" },
];

function plateStyle(weightKg: number): { bg: string; fg: string } {
  // Pick the first colour whose anchor matches the plate weight.
  // Anything heavier than 25 falls back to the heavy red.
  if (weightKg >= 25) return PLATE_COLORS[0]!;
  for (const c of PLATE_COLORS) {
    if (Math.abs(weightKg - c.max) < 0.01) return c;
  }
  // Unknown intermediate (e.g., 0.5) — reuse the lightest wedge.
  return PLATE_COLORS[PLATE_COLORS.length - 1]!;
}

function plateSize(weightKg: number): { width: number; height: number } {
  // Visual ramp: heavier plates render wider AND taller so the stack
  // reads like a real bar from a distance. Minimum width is 16 px so
  // even the smallest plate ("2.5", "1.25") can fit its label legibly.
  if (weightKg >= 25) return { width: 22, height: 64 };
  if (weightKg >= 20) return { width: 20, height: 58 };
  if (weightKg >= 15) return { width: 18, height: 50 };
  if (weightKg >= 10) return { width: 17, height: 42 };
  if (weightKg >= 5) return { width: 16, height: 34 };
  if (weightKg >= 2.5) return { width: 16, height: 26 };
  return { width: 16, height: 20 };
}

function formatPlateLabel(weightKg: number): string {
  // Strip a trailing .0 so 20 renders as "20", but keep 2.5 / 1.25.
  return weightKg % 1 === 0 ? String(weightKg) : String(weightKg);
}

export function PlateView({ targetWeightKg, barWeightKg, inventory }: PlateViewProps) {
  const { perSide, remainderKg } = computePlateBreakdown(
    targetWeightKg,
    barWeightKg,
    inventory.map((p) => ({ weightKg: p.weightKg })),
  );
  // perSide is ordered heaviest → lightest; render heaviest closest
  // to the bar (centre) and lighter ones outward.
  const leftStack = [...perSide].reverse();
  const rightStack = [...perSide];

  const empty = perSide.length === 0;

  return (
    <div
      data-testid="plate-view"
      data-remainder={remainderKg > 0 ? "true" : "false"}
      aria-label={
        empty
          ? remainderKg > 0
            ? `Plate breakdown — target ${targetWeightKg} kg is below bar weight ${barWeightKg} kg`
            : `Plate breakdown — bar only, ${barWeightKg} kg`
          : `Plate breakdown — per side ${perSide.join(", ")} kg`
      }
      style={{
        display: "grid",
        gap: 4,
        justifyItems: "center",
        padding: "6px 4px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          minHeight: 64,
        }}
      >
        {leftStack.map((p, i) => {
          const { bg, fg } = plateStyle(p);
          const { width, height } = plateSize(p);
          // Tiny labels (2.5, 1.25) need smaller text to fit; bigger
          // plates take a bolder readable size.
          const fontSize = p < 5 ? 8 : 10;
          return (
            <span
              key={`l-${i}-${p}`}
              data-testid={`plate-left-${i}`}
              data-weight={p}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width,
                height,
                borderRadius: 3,
                background: bg,
                color: fg,
                fontSize,
                fontWeight: 700,
                fontFamily: "var(--cp-font-mono)",
                lineHeight: 1,
              }}
            >
              {formatPlateLabel(p)}
            </span>
          );
        })}
        {/* Bar centrepiece. */}
        <span
          aria-hidden
          data-testid="plate-view-bar"
          style={{
            display: "inline-block",
            width: 56,
            height: 6,
            borderRadius: 2,
            background: "var(--cp-text-muted)",
            margin: "0 1px",
          }}
        />
        {rightStack.map((p, i) => {
          const { bg, fg } = plateStyle(p);
          const { width, height } = plateSize(p);
          const fontSize = p < 5 ? 8 : 10;
          return (
            <span
              key={`r-${i}-${p}`}
              data-testid={`plate-right-${i}`}
              data-weight={p}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width,
                height,
                borderRadius: 3,
                background: bg,
                color: fg,
                fontSize,
                fontWeight: 700,
                fontFamily: "var(--cp-font-mono)",
                lineHeight: 1,
              }}
            >
              {formatPlateLabel(p)}
            </span>
          );
        })}
      </div>
      <div
        data-testid="plate-view-summary"
        style={{
          fontSize: 11,
          color: "var(--cp-text-muted)",
          fontFamily: "var(--cp-font-mono)",
          textAlign: "center",
        }}
      >
        {empty ? (
          remainderKg > 0 ? (
            <>target below bar ({barWeightKg} kg)</>
          ) : (
            <>bar only · {barWeightKg} kg</>
          )
        ) : (
          <>
            per side: {perSide.join(" + ")} kg
            {remainderKg > 0 && (
              <span
                data-testid="plate-view-remainder"
                style={{ marginLeft: 6, color: "var(--cp-warning)" }}
              >
                · short {remainderKg} kg
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
