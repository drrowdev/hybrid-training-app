"use client";
/**
 * HistorySection — collapsed accordion of resolved limitations,
 * sorted by `resolvedAt` desc. Each row is single-line until
 * expanded; expand shows notes if present.
 */
import { useState } from "react";
import type { ReactElement } from "react";
import type { LimitationRow } from "./types";
import { durationDays, relativeFromNow, severityBadgeStyle } from "./utils";

export type HistorySectionProps = {
  rows: LimitationRow[];
};

export function HistorySection({ rows }: HistorySectionProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  return (
    <section data-testid="history-section" style={{ display: "grid", gap: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="history-toggle"
        style={{
          textAlign: "left",
          background: "transparent",
          border: "none",
          color: "var(--cp-text)",
          fontSize: 15,
          fontWeight: 700,
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span aria-hidden style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          {open ? "▾" : "▸"}
        </span>
        History
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--cp-text-muted)" }}>
          ({rows.length})
        </span>
      </button>
      {open && (
        <ul
          data-testid="history-list"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 8,
          }}
        >
          {rows.map((r) => (
            <HistoryRow key={r.id} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({ row }: { row: LimitationRow }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const days = durationDays(row.startedAt, row.resolvedAt);
  return (
    <li
      data-testid="history-row"
      style={{
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        padding: 12,
        background: "var(--cp-surface)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          background: "transparent",
          border: "none",
          color: "var(--cp-text)",
          cursor: "pointer",
          padding: 0,
        }}
        aria-expanded={expanded}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={severityBadgeStyle(row.severity)}>{row.severity}</span>
          <strong style={{ fontSize: 13 }}>{row.kind ?? "Limitation"}</strong>
          <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            · {days} day{days === 1 ? "" : "s"} ·{" "}
            {row.resolvedAt ? `resolved ${relativeFromNow(row.resolvedAt)}` : "resolved"}
          </span>
        </span>
        <span aria-hidden style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && row.notes ? (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: "var(--cp-text-muted)",
            whiteSpace: "pre-wrap",
          }}
        >
          {row.notes}
        </div>
      ) : null}
    </li>
  );
}
