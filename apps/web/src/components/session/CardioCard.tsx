/**
 * Shared cardio card rendered on both the read-only Session Preview
 * page (`/app/plan/preview/[plannedId]`) and the live in-progress
 * Session detail page (`/app/sessions/[id]`).
 *
 * Renders, in order:
 *   1. An eyebrow ("CARDIO").
 *   2. A heading — hidden when redundant with the page title (see
 *      `lib/session/heading-dedup`).
 *   3. The educational "how to execute" description (open `<details>`
 *      by default so it's visible without an extra tap).
 *   4. Structured key/value protocol rows from `cardioPreviewRows`.
 *
 * Pure presentational. Both surfaces import this directly so visual
 * drift between the preview and the in-session cardio card stays
 * obvious in review.
 */

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
};

export function CardioCard({
  item,
  hideDurationRow,
  hideHeading,
  testId,
  rowTestIdPrefix,
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

  return (
    <section data-testid={testId} style={cardStyle}>
      <div className="mono" style={eyebrowStyle}>
        CARDIO
      </div>
      {!hideHeading && <h3 style={movementHeadingStyle}>{name}</h3>}

      <details
        data-testid={
          rowTestIdPrefix ? `${rowTestIdPrefix}-description` : undefined
        }
        open
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--cp-text-muted)",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontSize: 11,
            letterSpacing: "0.08em",
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            fontWeight: 600,
            listStyle: "none",
            userSelect: "none",
            padding: "2px 0",
          }}
        >
          How to do it
        </summary>
        <p style={{ margin: "6px 0 0" }}>{description}</p>
      </details>

      {rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
