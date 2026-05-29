/**
 * Shared cardio card rendered on both the read-only Session Preview
 * page (`/app/plan/preview/[plannedId]`) and the live in-progress
 * Session detail page (`/app/sessions/[id]`).
 *
 * Renders, in order:
 *   1. An eyebrow ("CARDIO").
 *   2. A header row: heading (hidden when redundant with the page
 *      title — see `lib/session/heading-dedup`), an optional modality
 *      chip (Run / Bike / Row / …), and a slot for header actions
 *      (e.g. the inline Swap button on the live session page).
 *   3. The educational "how to execute" description rendered as a
 *      static paragraph block above the protocol rows (Fix 2 of the
 *      active-session UX overhaul — was previously a collapsible
 *      `<details>` that visually competed with the structured rows).
 *   4. Structured key/value protocol rows from `cardioPreviewRows`.
 *
 * Pure presentational. Both surfaces import this directly so visual
 * drift between the preview and the in-session cardio card stays
 * obvious in review.
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
   * Optional modality label (e.g. "Run", "Bike", "Row"). Rendered as a
   * subtle pill in the card header next to the heading. The session
   * page derives this from the planned movement's `metadata.modality`.
   */
  modalityLabel?: string | null;
  /**
   * Optional slot rendered on the same row as the heading + modality
   * chip. The live session page uses this to inline the Swap button
   * with the movement title instead of floating it at the card bottom.
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
  const description = describeCardioKind(
    item.kind as CardioDescriptionKind | string,
  );
  const allRows = cardioPreviewRows(item);
  const rows = hideDurationRow
    ? allRows.filter((r) => r.label !== "Duration")
    : allRows;
  const trimmedModality = (modalityLabel ?? "").trim();
  const showModality = trimmedModality.length > 0;
  const hasHeader = !hideHeading || showModality || headerActions != null;

  return (
    <section data-testid={testId} style={cardStyle}>
      <div className="mono" style={eyebrowStyle}>
        CARDIO
      </div>
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
              {trimmedModality}
            </span>
          )}
          {headerActions != null && (
            <div style={headerActionsStyle}>{headerActions}</div>
          )}
        </div>
      )}

      <div
        data-testid={
          rowTestIdPrefix ? `${rowTestIdPrefix}-description` : undefined
        }
        style={descriptionBlockStyle}
      >
        <div style={descriptionLabelStyle}>How to do it</div>
        <p style={descriptionParagraphStyle}>{description}</p>
      </div>

      {rows.length > 0 && (
        <div style={rowsBlockStyle}>
          {rows.map((row, i) => (
            <div
              key={i}
              data-testid={
                rowTestIdPrefix
                  ? `${rowTestIdPrefix}-row-${row.label.toLowerCase().replace(/\s+/g, "-")}`
                  : undefined
              }
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(96px, max-content) 1fr",
                gap: 12,
                alignItems: "baseline",
                padding: "4px 0",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
                {row.label}
              </span>
              <span style={{ fontSize: 14, color: "var(--cp-text)" }}>
                {row.value}
              </span>
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

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
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

const descriptionBlockStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  paddingBottom: 12,
  borderBottom: "1px solid var(--cp-border)",
};

const descriptionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  fontWeight: 600,
};

const descriptionParagraphStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--cp-text-muted)",
};

const rowsBlockStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
