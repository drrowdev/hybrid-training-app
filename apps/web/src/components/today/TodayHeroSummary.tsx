/**
 * Compact "at-a-glance" workout preview rendered inside the Today
 * hero card, between the title/duration block and the Start / Preview
 * buttons. Replaces the older single-line "VO2 · 35 min" summary.
 *
 * Goal: tell the user what they're actually about to do — main lifts
 * with their top-set protocol, then any cardio block, then a count of
 * accessories — without growing as dense as the read-only Preview
 * page. Maximum 5 rows; anything beyond truncates to "… and N more"
 * and relies on the Preview button to surface the rest.
 *
 * Reuses the same prescription helpers the preview page uses
 * (`groupByMovementThenKind` + `cardioPreviewRows` +
 * `formatPrescriptionItem`) so the hero and the preview never drift
 * apart on what's emphasised. Cardio rows deliberately drop the
 * Duration sub-row (it's already shown in the hero topline) and the
 * "HR cap" row (per cardio-preview-rows.ts — Intensity covers it).
 */
import type { PrescriptionItem } from "@hta/db";
import { groupByMovementThenKind } from "@/lib/plan/prescription-grouping";
import { formatPrescriptionItem } from "@/lib/planner/archetypes";
import { cardioPreviewRows } from "@/components/session/cardio-preview-rows";

const MAX_ROWS = 5;

type SummaryRow = { name: string; protocol: string };

function strengthProtocol(
  section: import("@/lib/plan/prescription-grouping").MovementPrescriptionSection,
): string {
  // Prefer the marked top set; fall back to the first main set, then
  // the first set of any kind. Renders as the one-line protocol shown
  // on the right of the row (e.g. "3 × 5 @ 80%").
  const topSet =
    section.sets.find((s) => s.isTopSet) ??
    section.sets.find((s) => s.item.kind === "main") ??
    section.sets[0];
  if (!topSet) return "";

  const item = topSet.item;
  // When several main rows share the same %TM, treat that as the
  // working-set count for the "{N} × {reps} @ {pct}%" shape that
  // matches the hero spec ("Front Squat · 3 × 5 @ 80%").
  if (item.kind === "main" && item.percentTm != null && item.reps != null) {
    const sameTopSets = section.sets.filter(
      (s) => s.item.kind === "main" && s.item.percentTm === item.percentTm,
    ).length;
    const setCount = Math.max(sameTopSets, 1);
    return `${setCount} × ${item.reps} @ ${item.percentTm}%`;
  }

  return formatPrescriptionItem(item);
}

function cardioRowProtocol(item: PrescriptionItem): string {
  // Reuse the same parser the preview page uses, then drop "Duration"
  // (already in the hero topline) and join the rest with " · ".
  return cardioPreviewRows(item)
    .filter((r) => r.label !== "Duration")
    .map((r) => r.value)
    .filter(Boolean)
    .join(" · ");
}

function cardioName(item: PrescriptionItem): string {
  return item.movementName ?? "Cardio";
}

export function buildTodayHeroSummary(items: PrescriptionItem[]): {
  rows: SummaryRow[];
  overflow: number;
  accessoryCount: number;
} {
  const sections = groupByMovementThenKind(items);
  const all: SummaryRow[] = [];

  // Strength movements first. Spec calls for "max 4 main movements"
  // shown, but that's subsumed by the hard 5-row cap below — when
  // strength alone exceeds the cap, the overflow line communicates the
  // rest. Don't pre-slice here or the overflow count would lie.
  for (const sec of sections.movements) {
    all.push({ name: sec.movementName, protocol: strengthProtocol(sec) });
  }

  // Cardio after strength so hybrid (strength + cardio same day)
  // sessions read top-down "lift, lift, …, then cardio".
  for (const item of sections.cardio) {
    all.push({ name: cardioName(item), protocol: cardioRowProtocol(item) });
  }

  // Count distinct accessory movements rather than raw rows so a
  // 3-set accessory doesn't inflate to "+ 3 accessories".
  const accessoryCount = sections.accessories.length;

  // When the list overflows, reserve the last visible slot for the
  // "… and N more" line so the total rendered lines never exceed
  // MAX_ROWS. Overflow is then "everything that didn't fit in the
  // remaining visible slots".
  const wantsOverflow = all.length > MAX_ROWS;
  const visible = wantsOverflow ? all.slice(0, MAX_ROWS - 1) : all;
  const overflow = wantsOverflow ? all.length - visible.length : 0;
  return { rows: visible, overflow, accessoryCount };
}

export function TodayHeroSummary({
  items,
  testId = "today-hero-summary",
}: {
  items: PrescriptionItem[];
  testId?: string;
}) {
  const { rows, overflow, accessoryCount } = buildTodayHeroSummary(items);
  if (rows.length === 0 && accessoryCount === 0 && overflow === 0) return null;

  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        fontSize: 13,
      }}
    >
      {rows.map((row, i) => (
        <div
          key={`${row.name}-${i}`}
          data-testid={`${testId}-row`}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
          }}
        >
          <span
            style={{
              fontWeight: 500,
              color: "var(--cp-text)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.name}
          </span>
          <span
            className="mono"
            style={{
              color: "var(--cp-text-muted)",
              textAlign: "right",
              flex: "0 1 auto",
            }}
          >
            {row.protocol || "—"}
          </span>
        </div>
      ))}
      {overflow > 0 && (
        <div
          data-testid={`${testId}-overflow`}
          style={{
            color: "var(--cp-text-muted)",
            fontStyle: "italic",
          }}
        >
          … and {overflow} more
        </div>
      )}
      {accessoryCount > 0 && (
        <div
          data-testid={`${testId}-accessories`}
          style={{
            color: "var(--cp-text-muted)",
            fontStyle: "italic",
          }}
        >
          + {accessoryCount} accessor{accessoryCount === 1 ? "y" : "ies"}
        </div>
      )}
    </div>
  );
}
