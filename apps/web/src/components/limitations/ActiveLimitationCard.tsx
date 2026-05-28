"use client";
/**
 * ActiveLimitationCard — one card per active limitation on
 * /app/recovery/injuries.
 *
 * Top row: severity badge, kind, "started 3 days ago".
 * Body: affected muscles as chips, affected movements as links.
 * Expand: notes, engine-action summary, Resolve + Edit + Delete.
 */
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ReactElement } from "react";
import { MUSCLE_LABELS } from "@/lib/muscle/muscle-groups";
import {
  deleteLimitationById,
  resolveLimitationById,
} from "@/lib/limitations/actions";
import { AddLimitationModal } from "./AddLimitationModal";
import type { LimitationRow, MovementRef } from "./types";
import { relativeFromNow, severityBadgeStyle } from "./utils";
import { formatDateTime, type ProfileForFormat } from "@/lib/format/datetime";

export type ActiveLimitationCardProps = {
  row: LimitationRow;
  movements: MovementRef[];
  /** User's date/time preferences for the absolute-time tooltip. */
  formatProfile?: ProfileForFormat;
};

function engineActionSummary(action: Record<string, unknown>): string | null {
  if (!action || Object.keys(action).length === 0) return null;
  const parts: string[] = [];
  const cap = action.cap_pct ?? action.capPct;
  if (typeof cap === "number") parts.push(`Cap ${cap}%`);
  const sub = action.substitute ?? action.substituteSlug;
  if (typeof sub === "string") parts.push(`Sub → ${sub}`);
  if (action.skip === true) parts.push("Skipping affected days");
  if (parts.length === 0) {
    try {
      return JSON.stringify(action);
    } catch {
      return null;
    }
  }
  return parts.join(" · ");
}

export function ActiveLimitationCard({
  row,
  movements,
  formatProfile = null,
}: ActiveLimitationCardProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const engineSummary = engineActionSummary(row.engineAction);

  return (
    <article
      data-testid="active-limitation-card"
      data-id={row.id}
      style={{
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        padding: 16,
        background: "var(--cp-surface)",
        display: "grid",
        gap: 12,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={severityBadgeStyle(row.severity)}>{row.severity}</span>
            <strong style={{ fontSize: 15 }}>{row.kind ?? "Limitation"}</strong>
          </div>
          <span
            title={formatDateTime(row.startedAt, formatProfile)}
            style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
          >
            Started {relativeFromNow(row.startedAt)}
            {row.affectedSide && row.affectedSide !== "bilateral"
              ? ` · ${row.affectedSide} side`
              : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-testid="active-card-toggle"
          aria-expanded={expanded}
          style={{
            background: "transparent",
            border: "1px solid var(--cp-border)",
            color: "var(--cp-text-muted)",
            borderRadius: 8,
            padding: "4px 10px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {expanded ? "Hide" : "Details"}
        </button>
      </header>

      {row.affectedMuscles.length > 0 && (
        <div
          data-testid="active-card-muscles"
          style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
        >
          {row.affectedMuscles.map((m) => (
            <span
              key={m}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                borderRadius: 999,
                background: "var(--cp-surface-soft)",
                border: "1px solid var(--cp-border)",
                color: "var(--cp-text-muted)",
              }}
            >
              {MUSCLE_LABELS[m] ?? m}
            </span>
          ))}
        </div>
      )}

      {movements.length > 0 && (
        <div
          data-testid="active-card-movements"
          style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
        >
          {movements.map((m) => (
            <Link
              key={m.id}
              href={`/app/stats/movements/${m.slug}`}
              style={{
                fontSize: 12,
                color: "var(--cp-accent, var(--cp-link))",
                textDecoration: "none",
                padding: "2px 8px",
                border: "1px solid var(--cp-border)",
                borderRadius: 999,
              }}
            >
              {m.displayName}
            </Link>
          ))}
        </div>
      )}

      {expanded && (
        <div style={{ display: "grid", gap: 10 }}>
          {row.notes ? (
            <div
              data-testid="active-card-notes"
              style={{
                fontSize: 13,
                color: "var(--cp-text)",
                whiteSpace: "pre-wrap",
                padding: 10,
                background: "var(--cp-surface-soft)",
                borderRadius: 8,
                border: "1px solid var(--cp-border)",
              }}
            >
              {row.notes}
            </div>
          ) : null}
          {engineSummary && (
            <div
              data-testid="active-card-engine"
              style={{
                fontSize: 12,
                color: "var(--cp-text-muted)",
                fontStyle: "italic",
              }}
            >
              Engine: {engineSummary}
            </div>
          )}
          {error && (
            <div
              role="alert"
              style={{
                fontSize: 12,
                color: "var(--cp-danger, #ef4444)",
              }}
            >
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid="active-card-resolve"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const r = await resolveLimitationById(row.id);
                  if (!r.ok) setError(r.error);
                });
              }}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid var(--cp-ok, #22c55e)",
                background: "transparent",
                color: "var(--cp-ok, #22c55e)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Resolve
            </button>
            <button
              type="button"
              data-testid="active-card-edit"
              onClick={() => setEditing(true)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid var(--cp-border)",
                background: "transparent",
                color: "var(--cp-text-muted)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Edit
            </button>
            <button
              type="button"
              data-testid="active-card-delete"
              disabled={pending}
              onClick={() => {
                if (!confirm("Delete this limitation? It will be removed without an audit trail.")) {
                  return;
                }
                setError(null);
                startTransition(async () => {
                  const r = await deleteLimitationById(row.id);
                  if (!r.ok) setError(r.error);
                });
              }}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid transparent",
                background: "transparent",
                color: "var(--cp-text-muted)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <AddLimitationModal
        open={editing}
        onClose={() => setEditing(false)}
        initial={row}
        initialMovements={movements}
      />
    </article>
  );
}
