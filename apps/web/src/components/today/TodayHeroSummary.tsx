/**
 * Compact "at-a-glance" workout preview rendered inside the Today
 * hero card, between the title/duration block and the Start / Preview
 * buttons. Replaces the older single-line "VO2 · 35 min" summary and
 * the buggy "+ N assistance" chip row.
 *
 * Layout:
 *   - Strength rows render the movement name on its own line followed
 *     by an indented, muted protocol line (good for "Front Squat" + "3
 *     × 5 @ 80%" where the protocol is short and dense).
 *   - Cardio expands into a structured block — one row per labelled
 *     parameter — so EVERY cardio kind reads consistently regardless
 *     of how rich its `protocolNote` is. Order: Description, Intervals
 *     (if parsed), Intensity (always), Recovery (if parsed), Total
 *     (always). Z2 sessions with just an `hrCap` end up looking
 *     structurally identical to a VO2 session with a full interval
 *     description; the only difference is the values.
 *   - When the session has exactly ONE cardio item AND no strength
 *     work, the cardio movement name is suppressed — the Today hero
 *     already shows `planned.title` (the same string) directly above.
 *     Hybrid sessions and multi-cardio days keep the name so the
 *     reader can tell which block they're looking at.
 *
 * Cardio rows reuse the shared `cardioPreviewRows` parser so the hero
 * and the read-only Preview page never drift apart on what gets
 * emphasised — and so the kind-based Intensity fallback added there
 * benefits both surfaces.
 */
import type { PrescriptionItem } from "@hta/db";
import { groupByMovementThenKind } from "@/lib/plan/prescription-grouping";
import { formatPrescriptionItem } from "@/lib/planner/archetypes";
import { cardioPreviewRows } from "@/components/session/cardio-preview-rows";
import { cardioOneLinerForKind } from "@/lib/session/cardio-descriptions";

const MAX_ROWS = 5;

/**
 * Discriminated union for everything that can appear inside the hero
 * summary. `strength` keeps the old stacked name+protocol shape;
 * cardio expands into a small ordered block of `cardio-header`
 * (optional movement name when not deduped), `cardio-description`
 * (one-liner), and `cardio-detail` ("Label: value") rows.
 */
export type SummaryRow =
  | { variant: "strength"; name: string; protocol: string }
  | { variant: "cardio-header"; name: string }
  | { variant: "cardio-description"; text: string }
  | { variant: "cardio-detail"; label: string; value: string };

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

function cardioName(item: PrescriptionItem): string {
  return item.movementName ?? "Cardio";
}

/**
 * Expand a single cardio prescription into the ordered list of detail
 * rows the hero renders below the description. We deliberately swap
 * cardioPreviewRows' "Duration" row for a "Total" row at the end (the
 * hero spec uses "Total" as the trailing summary label) and drop any
 * unrecognised "Protocol" segments because they're typically long and
 * better suited to the Preview page.
 *
 * Truncation: callers pass a budget; when there isn't room for every
 * row, "Recovery" is dropped first (per spec). If still too many,
 * "Intervals" is dropped next to preserve the Intensity + Total
 * baseline that every cardio kind must show.
 */
function buildCardioDetailRows(
  item: PrescriptionItem,
  budget: number,
): Array<{ label: string; value: string }> {
  const parsed = cardioPreviewRows(item);
  // Pull out individual rows by label; cardioPreviewRows emits at
  // most one of each.
  const intervals = parsed.find((r) => r.label === "Intervals");
  const intensity = parsed.find((r) => r.label === "Intensity");
  const recovery = parsed.find((r) => r.label === "Recovery");

  const detail: Array<{ label: string; value: string }> = [];
  if (intervals) detail.push(intervals);
  // Intensity is always present thanks to the kind-based fallback in
  // cardio-preview-rows.ts, but guard defensively in case the parser
  // changes contract.
  if (intensity) detail.push(intensity);
  if (recovery) detail.push(recovery);
  if (item.durationMin != null) {
    detail.push({ label: "Total", value: `${item.durationMin} min` });
  }

  if (detail.length <= budget) return detail;

  // Over budget. Drop Recovery first, then Intervals — preserve
  // Intensity + Total as the irreducible cardio summary.
  const droppable = ["Recovery", "Intervals"];
  for (const label of droppable) {
    const i = detail.findIndex((r) => r.label === label);
    if (i >= 0) detail.splice(i, 1);
    if (detail.length <= budget) return detail;
  }
  return detail.slice(0, budget);
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
  // strength alone exceeds the cap, the overflow line communicates
  // the rest. Don't pre-slice here or the overflow count would lie.
  for (const sec of sections.movements) {
    all.push({
      variant: "strength",
      name: sec.movementName,
      protocol: strengthProtocol(sec),
    });
  }

  // Suppress the cardio name when the session is a single cardio
  // item with no strength rows — the hero topline already shows the
  // same string (e.g. "Long Z2") immediately above. Hybrid sessions
  // and multi-cardio days keep the name as a header so the reader
  // can tell which block they're looking at.
  const includeCardioHeaders =
    sections.movements.length > 0 || sections.cardio.length > 1;

  // Cardio after strength so hybrid (strength + cardio same day)
  // sessions read top-down "lift, lift, …, then cardio".
  for (const item of sections.cardio) {
    if (includeCardioHeaders) {
      all.push({ variant: "cardio-header", name: cardioName(item) });
    }
    all.push({
      variant: "cardio-description",
      text: cardioOneLinerForKind(item.kind),
    });
    // Detail-row budget = whatever's left of the 5-row cap after the
    // rows already queued (strength, prior cardio blocks, this
    // block's header + description). Floor at 2 so Intensity + Total
    // can always fit — overflow is communicated by the "… and N
    // more" marker below.
    const used = all.length;
    const budget = Math.max(MAX_ROWS - used, 2);
    for (const row of buildCardioDetailRows(item, budget)) {
      all.push({
        variant: "cardio-detail",
        label: row.label,
        value: row.value,
      });
    }
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
        gap: 8,
        fontSize: 13,
      }}
    >
      {rows.map((row, i) => {
        if (row.variant === "cardio-header") {
          return (
            <div
              key={`row-${i}`}
              data-testid={`${testId}-row`}
              data-variant="cardio-header"
              style={{
                fontWeight: 600,
                color: "var(--cp-text)",
                lineHeight: 1.35,
              }}
            >
              {row.name}
            </div>
          );
        }
        if (row.variant === "cardio-description") {
          return (
            <div
              key={`row-${i}`}
              data-testid={`${testId}-row`}
              data-variant="cardio-description"
              style={{
                color: "var(--cp-text-muted)",
                lineHeight: 1.4,
              }}
            >
              {row.text}
            </div>
          );
        }
        if (row.variant === "cardio-detail") {
          return (
            <div
              key={`row-${i}`}
              data-testid={`${testId}-row`}
              data-variant="cardio-detail"
              style={{
                color: "var(--cp-text-muted)",
                lineHeight: 1.4,
                paddingLeft: 12,
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--cp-text)" }}>
                {row.label}:
              </span>{" "}
              <span className="mono">{row.value}</span>
            </div>
          );
        }
        // Strength: stacked. Movement name bold on its own line,
        // protocol on the next line at 13px muted, indented 12px.
        return (
          <div
            key={`row-${i}`}
            data-testid={`${testId}-row`}
            data-variant="strength"
            style={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            <span
              style={{
                fontWeight: 600,
                color: "var(--cp-text)",
                lineHeight: 1.35,
              }}
            >
              {row.name}
            </span>
            <span
              className="mono"
              style={{
                color: "var(--cp-text-muted)",
                paddingLeft: 12,
                lineHeight: 1.35,
              }}
            >
              {row.protocol || "—"}
            </span>
          </div>
        );
      })}
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
