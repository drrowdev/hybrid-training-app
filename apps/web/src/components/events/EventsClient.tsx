"use client";

/**
 * Page-level client wrapper for /app/settings/events.
 *
 * Combines:
 *   - the "Add event" trigger + the EventFormModal in create mode
 *   - the TimelineStrip (which can scroll a row into view + open it)
 *   - the upcoming + history lists rendered as EventRow components
 *
 * Kept as one file (instead of two more wrappers) because the
 * timeline → row-expand cross-talk needs shared state. The page
 * server component hands us all the data; we don't fetch.
 */
import { useCallback, useRef, useState } from "react";
import type { ReactElement } from "react";
import { EventFormModal } from "./EventFormModal";
import { EventRow } from "./EventRow";
import { TimelineStrip } from "./TimelineStrip";
import type { EventRowView } from "./types";

export type EventsClientProps = {
  todayYmd: string;
  upcoming: EventRowView[];
  past: EventRowView[];
};

export function EventsClient({ todayYmd, upcoming, past }: EventsClientProps): ReactElement {
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const upcomingRef = useRef<HTMLUListElement>(null);

  const onSelect = useCallback((id: string) => {
    setExpandedId(id);
    // Defer to the next frame so the row has the chance to mount its
    // expanded panel before we scroll it into view.
    requestAnimationFrame(() => {
      const el = document.getElementById(`event-${id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", maxWidth: 480 }}>
          Mark the races, comps, meets and tests you&apos;re peaking for. The planner
          uses A and B events to suggest a taper inside the final 14 days.
        </p>
        <button
          type="button"
          data-testid="add-event-button"
          onClick={() => setAdding(true)}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--cp-accent, var(--cp-text))",
            background: "var(--cp-accent, var(--cp-text))",
            color: "var(--cp-accent-fg, var(--cp-bg))",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Add event
        </button>
      </div>

      <TimelineStrip todayYmd={todayYmd} events={upcoming} onSelect={onSelect} />

      <section data-testid="upcoming-section" style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
          Upcoming{" "}
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--cp-text-muted)" }}>
            ({upcoming.length})
          </span>
        </h2>
        {upcoming.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
            Nothing scheduled — add one with the button above.
          </p>
        ) : (
          <ul ref={upcomingRef} style={{ padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {upcoming.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                todayYmd={todayYmd}
                defaultOpen={expandedId === e.id}
              />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <details data-testid="history-section" style={{ borderTop: "1px solid var(--cp-border)", paddingTop: 16 }}>
          <summary
            data-testid="history-toggle"
            style={{
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 700,
              listStyle: "none",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            History{" "}
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--cp-text-muted)" }}>
              ({past.length})
            </span>
          </summary>
          <ul style={{ padding: 0, margin: "12px 0 0", display: "grid", gap: 8 }}>
            {past.map((e) => (
              <EventRow key={e.id} event={e} todayYmd={todayYmd} />
            ))}
          </ul>
        </details>
      )}

      <EventFormModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
