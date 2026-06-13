"use client";

/**
 * Visual plate-per-side breakdown rendered next to the target weight
 * inside `<MovementFocusView>`. Pure render — the maths lives in
 * `plate-math.ts` so it's directly testable.
 *
 * Plates are computed and shown in the user's unit against a REAL plate set:
 *   - metric → the user's kg inventory + kg bar (IWF colours: 25 red, 20 blue,
 *     15 yellow, 10 green, 5 white).
 *   - imperial → a standard US lb set (45/35/25/10/5/2.5 lb) on a ~45 lb bar,
 *     so a US lifter sees the actual plates they'd load (not lb-converted kg
 *     plates). Colours mirror the IWF weight classes.
 * Colours are fixed real-world hues, intentionally theme-independent.
 */

import { computePlateBreakdown, type PlateInventoryItem } from "./plate-math";
import {
  type WeightUnit,
  displayWeight,
  roundDisplayWeight,
  weightUnitLabel,
} from "@/lib/stats/units";

export type PlateViewProps = {
  targetWeightKg: number;
  barWeightKg: number;
  inventory: PlateInventoryItem[];
  units?: WeightUnit;
  /** When imperial and false, build the lb plate set from the user's
   *  actual inventory (converted to lb) instead of the standard US set.
   *  Defaults to true (standard US set for preset users). */
  preferStandardLbPlates?: boolean;
};

// Standard US lb plate set + Olympic bar — used when the user is imperial so
// the breakdown reflects real pounds, not lb-converted kg plates.
const LB_PLATE_SET = [45, 35, 25, 10, 5, 2.5];

type PlateColor = { max: number; bg: string; fg: string };

// IWF / Rogue calibrated kg plate colours.
const PLATE_COLORS_KG: PlateColor[] = [
  { max: 25, bg: "#ce1126", fg: "#fff" },
  { max: 20, bg: "#0a5fb4", fg: "#fff" },
  { max: 15, bg: "#f4c20d", fg: "#111" },
  { max: 10, bg: "#1aa64b", fg: "#fff" },
  { max: 5, bg: "#ececec", fg: "#111" },
  { max: 2.5, bg: "#ce1126", fg: "#fff" },
  // Chrome wedge for sub-2.5 micros (1.25, 0.5).
  { max: 1.25, bg: "#aeb4bc", fg: "#111" },
];

// US lb plate colours — mirror the IWF weight-class hues (55≈25kg red,
// 45≈20kg blue, 35≈15kg yellow, 25≈10kg green, 10≈5kg white). The small
// change plates (5 / 2.5 lb) are iron / chrome.
const PLATE_COLORS_LB: PlateColor[] = [
  { max: 55, bg: "#ce1126", fg: "#fff" },
  { max: 45, bg: "#0a5fb4", fg: "#fff" },
  { max: 35, bg: "#f4c20d", fg: "#111" },
  { max: 25, bg: "#1aa64b", fg: "#fff" },
  { max: 10, bg: "#ececec", fg: "#111" },
  { max: 5, bg: "#3a3f45", fg: "#fff" },
  { max: 2.5, bg: "#aeb4bc", fg: "#111" },
];

function plateStyle(value: number, units: WeightUnit): { bg: string; fg: string } {
  const palette = units === "imperial" ? PLATE_COLORS_LB : PLATE_COLORS_KG;
  // Anything at/above the heaviest anchor falls back to the heaviest colour.
  if (value >= palette[0]!.max) return palette[0]!;
  for (const c of palette) {
    if (Math.abs(value - c.max) < 0.01) return c;
  }
  return palette[palette.length - 1]!;
}

function plateSize(value: number, units: WeightUnit): { width: number; height: number } {
  // Visual ramp: heavier plates render wider AND taller. Thresholds are scaled
  // per unit so the lb set ramps like the kg set.
  const t = units === "imperial"
    ? [55, 45, 35, 25, 10, 5]
    : [25, 20, 15, 10, 5, 2.5];
  if (value >= t[0]!) return { width: 22, height: 64 };
  if (value >= t[1]!) return { width: 20, height: 58 };
  if (value >= t[2]!) return { width: 18, height: 50 };
  if (value >= t[3]!) return { width: 17, height: 42 };
  if (value >= t[4]!) return { width: 16, height: 34 };
  if (value >= t[5]!) return { width: 16, height: 26 };
  return { width: 16, height: 20 };
}

function fmtPlate(value: number): string {
  // Plate values are already exact in their unit; trim a trailing .0.
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

export function PlateView({ targetWeightKg, barWeightKg, inventory, units = "metric", preferStandardLbPlates = true }: PlateViewProps) {
  const isImperial = units === "imperial";
  const unitLabel = weightUnitLabel(units);

  // Everything below is computed in the user's PLATE unit (kg or lb).
  const dispTarget = roundDisplayWeight(displayWeight(targetWeightKg, units), units);
  const dispBar = isImperial
    ? Math.max(0, Math.round(displayWeight(barWeightKg, units) / 5) * 5)
    : roundDisplayWeight(barWeightKg, units);

  let calcPlates: { weightKg: number }[];
  if (isImperial) {
    if (preferStandardLbPlates) {
      calcPlates = LB_PLATE_SET.map((w) => ({ weightKg: w }));
    } else {
      // Build from user's real inventory (kg→lb, rounded, dedupe, desc, drop ≤0)
      const lbSet = Array.from(
        new Set(
          inventory.map((p) =>
            roundDisplayWeight(displayWeight(p.weightKg, "imperial"), "imperial"),
          ),
        ),
      )
        .filter((v) => v > 0)
        .sort((a, b) => b - a);
      calcPlates = lbSet.length > 0
        ? lbSet.map((w) => ({ weightKg: w }))
        : LB_PLATE_SET.map((w) => ({ weightKg: w }));
    }
  } else {
    calcPlates = inventory.map((p) => ({ weightKg: p.weightKg }));
  }

  // `computePlateBreakdown` is unit-agnostic numeric maths; we feed it values
  // already in the plate unit. The kg-only 25 kg gate is disabled for lb (its
  // 45 lb top plate is always available).
  const { perSide, remainderKg } = computePlateBreakdown(
    isImperial ? dispTarget : targetWeightKg,
    isImperial ? dispBar : barWeightKg,
    calcPlates,
    { disableHeavyGate: isImperial },
  );
  const dispRemainder = isImperial
    ? Math.round(remainderKg)
    : roundDisplayWeight(displayWeight(remainderKg, units), units);
  // perSide is ordered heaviest → lightest; render heaviest closest
  // to the bar (centre) and lighter ones outward.
  const leftStack = [...perSide].reverse();
  const rightStack = [...perSide];

  const empty = perSide.length === 0;
  const perSideDisplay = perSide.map((p) => fmtPlate(p));

  return (
    <div
      data-testid="plate-view"
      data-remainder={remainderKg > 0 ? "true" : "false"}
      aria-label={
        empty
          ? remainderKg > 0
            ? `Plate breakdown — target ${dispTarget} ${unitLabel} is below bar weight ${dispBar} ${unitLabel}`
            : `Plate breakdown — bar only, ${dispBar} ${unitLabel}`
          : `Plate breakdown — per side ${perSideDisplay.join(", ")} ${unitLabel}`
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
          const { bg, fg } = plateStyle(p, units);
          const { width, height } = plateSize(p, units);
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
              {fmtPlate(p)}
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
          const { bg, fg } = plateStyle(p, units);
          const { width, height } = plateSize(p, units);
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
              {fmtPlate(p)}
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
            <>target below bar ({dispBar} {unitLabel})</>
          ) : (
            <>bar only · {dispBar} {unitLabel}</>
          )
        ) : (
          <>
            per side: {perSideDisplay.join(" + ")} {unitLabel}
            {remainderKg > 0 && (
              <span
                data-testid="plate-view-remainder"
                style={{ marginLeft: 6, color: "var(--cp-warning)" }}
              >
                · short {dispRemainder} {unitLabel}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
