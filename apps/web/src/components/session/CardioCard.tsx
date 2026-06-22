/**
 * Shared cardio card — Mockup B design.
 *
 * Used on both the read-only Session Preview page and the live in-progress
 * Session detail page.
 *
 * Mockup B layout (top-to-bottom):
 *   1. Header row — movement heading (optional, suppressed when the page
 *      title already carries it) + modality chip with an accent leading
 *      dot + optional `headerActions` slot (the swap icon button).
 *   2. Description paragraph — kind-specific educational copy, rendered
 *      with a 2 px accent left-border. NO "How to do it" eyebrow label
 *      (the visual border replaces the textual cue at small widths).
 *   3. Stats — 2×2 grid of structured key/value cells from
 *      `cardioPreviewRows`. Cells span the row when the count is odd.
 *
 * Pure presentational. The eyebrow "CARDIO" line and the "How to do it"
 * label that used to sit above the description were removed for Mockup B
 * — the section header on the page already disambiguates the card type,
 * and the accent border on the description block carries the affordance
 * that something is annotation, not data.
 */

import type { ReactNode } from "react";
import type { PrescriptionItem } from "@hta/db";
import { cardioPreviewRows } from "./cardio-preview-rows";
import {
  describeCardioKind,
  type CardioDescriptionKind,
} from "@/lib/session/cardio-descriptions";
import { stripShorthandSuffix } from "@/lib/session/heading-dedup";

export type CardioCardOptions = {
  /** Drop the Duration row (preview surface shows it in the page meta). */
  hideDurationRow?: boolean;
  /** Suppress the inner heading (heading-dedup matched). */
  hideHeading?: boolean;
  /** Custom test id for the card root. */
  testId?: string;
  /** Optional test-id prefix for per-row data-testids. */
  rowTestIdPrefix?: string;
  /**
   * Optional modality label (e.g. "Run", "Bike", "Row"). Rendered as
   * a small chip with a leading accent dot in the card header.
   */
  modalityLabel?: string | null;
  /**
   * Optional slot rendered on the right side of the header row (used
   * by the live session page for the inline Swap icon button).
   */
  headerActions?: ReactNode;
};

export function CardioCard({
  item,
  hideDurationRow,
  hideHeading,
  testId,
  rowTestIdPrefix,
  modalityLabel,
  headerActions,
}: CardioCardOptions & { item: PrescriptionItem }) {
  const rawName = item.movementName ?? "Cardio";
  const name = stripShorthandSuffix(rawName);
  // Prefer the item's own prescription note (the engine's "what to do" copy —
  // HYROX intervals/circuits/compromised runs, Green's LSD, etc.) over the
  // generic kind-based description. Falls back to the educational kind copy for
  // structured cardio (Z2 / VO2 / threshold) that carries no per-item note.
  const itemNote = item.notes?.trim();
  const description =
    itemNote && itemNote.length > 0
      ? itemNote
      : describeCardioKind(item.kind as CardioDescriptionKind | string);
  const allRows = cardioPreviewRows(item);
  const rows = hideDurationRow
    ? allRows.filter((r) => r.label !== "Duration")
    : allRows;
  const trimmedModality = (modalityLabel ?? "").trim();
  const showModality = trimmedModality.length > 0;
  const hasHeader = !hideHeading || showModality || headerActions != null;

  return (
    <section data-testid={testId} style={cardStyle}>
      {hasHeader && (
        <div style={headerRowStyle}>
          {!hideHeading && <h3 style={movementHeadingStyle}>{name}</h3>}
          {showModality && (
            <span
              data-testid={
                rowTestIdPrefix
                  ? `${rowTestIdPrefix}-modality`
                  : "cardio-card-modality"
              }
              data-modality={trimmedModality.toLowerCase()}
              style={modalityChipStyle}
            >
              <span aria-hidden style={modalityDotStyle} />
              {trimmedModality}
            </span>
          )}
          {headerActions != null && (
            <div style={headerActionsStyle}>{headerActions}</div>
          )}
        </div>
      )}

      <p
        data-testid={
          rowTestIdPrefix ? `${rowTestIdPrefix}-description` : undefined
        }
        style={descriptionBlockStyle}
      >
        {description}
      </p>

      {rows.length > 0 && (
        <div style={statsGridStyle}>
          {rows.map((row, i) => (
            <div
              key={i}
              data-testid={
                rowTestIdPrefix
                  ? `${rowTestIdPrefix}-row-${row.label
                      .toLowerCase()
                      .replace(/\s+/g, "-")}`
                  : undefined
              }
              style={{
                ...statCellStyle,
                ...(rows.length % 2 === 1 && i === rows.length - 1
                  ? { gridColumn: "1 / -1" }
                  : null),
              }}
            >
              <span style={statLabelStyle}>{row.label}</span>
              <span style={statValueStyle}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  background: "var(--cp-surface)",
  border: "1px solid var(--cp-border)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const movementHeadingStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: "var(--cp-text)",
  margin: 0,
};

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
};

const headerActionsStyle: React.CSSProperties = {
  marginLeft: "auto",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const modalityChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  padding: "2px 10px",
  borderRadius: 999,
  border: "1px solid var(--cp-border)",
  color: "var(--cp-text-muted)",
  background: "color-mix(in oklab, var(--cp-surface) 80%, transparent)",
  letterSpacing: "0.04em",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const modalityDotStyle: React.CSSProperties = {
  display: "inline-block",
  width: 6,
  height: 6,
  borderRadius: 999,
  background: "var(--cp-accent)",
};

const descriptionBlockStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--cp-text-muted)",
  borderLeft: "2px solid var(--cp-accent)",
  paddingLeft: 12,
};

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const statCellStyle: React.CSSProperties = {
  background: "var(--cp-surface-soft, color-mix(in oklab, var(--cp-surface) 92%, transparent))",
  borderRadius: 10,
  padding: "10px 12px",
  display: "grid",
  gap: 2,
  minWidth: 0,
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 600,
};

const statValueStyle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--cp-text)",
  fontWeight: 500,
  overflowWrap: "anywhere",
};
