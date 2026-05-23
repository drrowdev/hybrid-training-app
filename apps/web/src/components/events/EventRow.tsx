"use client";

/**
 * EventRow — one row in the upcoming or history list on /app/races.
 *
 * Compact bar by default (name + relative date + chips + status);
 * click anywhere on the bar (or press Enter when focused) to expand
 * into the details panel with notes, target/result, and the
 * Edit / Delete / Capture-result actions.
 */
import { useState, useTransition } from "react";
import type { ReactElement } from "react";
import { deleteEvent, toggleCompleted } from "@/lib/events/actions";
import {
  eventStatus,
  formatPerformance,
  formatRelativeEventDate,
  modalityLabel,
  priorityColor,
  priorityLabel,
} from "@/lib/events/format";
import { EventFormModal } from "./EventFormModal";
import { CaptureResultModal } from "./CaptureResultModal";
import type { EventRowView } from "./types";

export type EventRowProps = {
  event: EventRowView;
  todayYmd: string;
  /** When true, the row mounts open. Used by the timeline-dot click. */
  defaultOpen?: boolean;
};

function StatusPill({ status }: { status: ReturnType<typeof eventStatus> }) {
  if (status === "upcoming" || status === "past") return null;
  const label = status === "today" ? "Today" : "Tapering";
  const color =
    status === "today" ? "var(--cp-danger, #ef4444)" : "var(--cp-warning, #d97706)";
  return (
    <span
      data-testid={`status-${status}`}
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 6px",
        borderRadius: 4,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color,
        border: `1px solid ${color}`,
        background: "transparent",
      }}
    >
      {label}
    </span>
  );
}

export function EventRow({ event, todayYmd, defaultOpen = false }: EventRowProps): ReactElement {
  const [expanded, setExpanded] = useState<boolean>(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [pending, startTransition] = useTransition();

  const status = eventStatus(event.eventDate, todayYmd, event.priority);
  const relative = formatRelativeEventDate(event.eventDate, todayYmd);
  const isPast = status === "past";
  const needsResult = isPast && !event.completed && event.result == null;

  const targetStr = formatPerformance(event.modality, event.targetPerformance);
  const resultStr = formatPerformance(event.modality, event.result);

  function onDelete() {
    if (!confirm(`Delete "${event.name}"?`)) return;
    startTransition(async () => {
      await deleteEvent(event.id);
    });
  }

  function onToggleComplete() {
    startTransition(async () => {
      await toggleCompleted(event.id, !event.completed);
    });
  }

  return (
    <li
      id={`event-${event.id}`}
      data-testid={`event-row-${event.id}`}
      data-completed={event.completed ? "true" : "false"}
      style={{
        listStyle: "none",
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        background: "var(--cp-surface)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        data-testid="event-row-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          width: "100%",
          padding: "12px 14px",
          background: "transparent",
          border: "none",
          color: "var(--cp-text)",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{event.name}</span>
            {event.completed && (
              <span
                data-testid="completed-badge"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 4,
                  color: "var(--cp-accent, var(--cp-text))",
                  border: "1px solid var(--cp-accent, var(--cp-text))",
                  textTransform: "uppercase",
                }}
              >
                Done
              </span>
            )}
            <StatusPill status={status} />
            {needsResult && (
              <span
                data-testid="needs-result"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 4,
                  color: "var(--cp-warning, #d97706)",
                  border: "1px solid var(--cp-warning, #d97706)",
                  textTransform: "uppercase",
                }}
              >
                Result?
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--cp-text-muted)", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span data-testid="event-relative">{relative}</span>
            <span aria-hidden>·</span>
            <span className="mono">{event.eventDate}</span>
            <span aria-hidden>·</span>
            <span style={{ color: priorityColor(event.priority), fontWeight: 600 }}>
              {priorityLabel(event.priority)}
            </span>
            <span aria-hidden>·</span>
            <span>{modalityLabel(event.modality)}</span>
          </div>
        </div>
        <span aria-hidden style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <div
          data-testid="event-row-expanded"
          style={{
            padding: "0 14px 14px",
            display: "grid",
            gap: 8,
            borderTop: "1px solid var(--cp-border)",
            paddingTop: 12,
          }}
        >
          {targetStr && (
            <div style={{ fontSize: 13, color: "var(--cp-text)" }}>
              <strong style={{ color: "var(--cp-text-muted)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Target —{" "}
              </strong>
              {targetStr}
            </div>
          )}
          {resultStr && (
            <div style={{ fontSize: 13, color: "var(--cp-text)" }}>
              <strong style={{ color: "var(--cp-text-muted)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Result —{" "}
              </strong>
              {resultStr}
            </div>
          )}
          {event.notes && (
            <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", whiteSpace: "pre-wrap" }}>
              {event.notes}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <button
              type="button"
              data-testid="event-edit"
              onClick={() => setEditing(true)}
              disabled={pending}
              style={ghostBtn}
            >
              Edit
            </button>
            {isPast && (
              <button
                type="button"
                data-testid="event-capture-result"
                onClick={() => setCapturing(true)}
                disabled={pending}
                style={ghostBtn}
              >
                {event.result ? "Update result" : "Capture result"}
              </button>
            )}
            <button
              type="button"
              data-testid="event-toggle-completed"
              onClick={onToggleComplete}
              disabled={pending}
              style={ghostBtn}
            >
              {event.completed ? "Mark as not done" : "Mark as done"}
            </button>
            <button
              type="button"
              data-testid="event-delete"
              onClick={onDelete}
              disabled={pending}
              style={{ ...ghostBtn, color: "var(--cp-danger, #ef4444)", borderColor: "var(--cp-danger, #ef4444)" }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <EventFormModal open={editing} onClose={() => setEditing(false)} initial={event} />
      <CaptureResultModal open={capturing} onClose={() => setCapturing(false)} event={event} />
    </li>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "transparent",
  color: "var(--cp-text)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
