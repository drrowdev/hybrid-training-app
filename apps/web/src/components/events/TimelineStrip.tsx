"use client";

/**
 * TimelineStrip — horizontal 12-month strip showing the next year of
 * priority events. Each event is a coloured dot positioned
 * proportionally to its time-to-event, with month gridlines under it.
 *
 * Keyboard accessibility (DC-Q6 constraint): dots are focusable
 * <button>s rendered in chronological order. Enter / Space fires the
 * `onSelect` callback so a parent can scroll the matching row into
 * view and expand it.
 */
import type { ReactElement } from "react";
import { useMemo } from "react";
import { daysBetweenYmd, addDaysToYmd } from "@/lib/dates";
import {
  modalityLabel,
  priorityColor,
  priorityLabel,
} from "@/lib/events/format";
import type { EventRowView } from "./types";

const WIDTH = 720;
const HEIGHT = 80;
const PAD_LEFT = 28;
const PAD_RIGHT = 12;
const TRACK_Y = 36;
const SPAN_DAYS = 365;

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type TimelineStripProps = {
  todayYmd: string;
  events: EventRowView[];
  onSelect?: (id: string) => void;
};

export function TimelineStrip({
  todayYmd,
  events,
  onSelect,
}: TimelineStripProps): ReactElement {
  const trackWidth = WIDTH - PAD_LEFT - PAD_RIGHT;

  // Only events within the 12-month window are shown as dots; the rest
  // get an aggregate ">N more" chip at the right edge.
  const { inWindow, overflow } = useMemo(() => {
    const inWin: EventRowView[] = [];
    let extra = 0;
    for (const e of events) {
      const d = daysBetweenYmd(todayYmd, e.eventDate);
      if (d >= 0 && d <= SPAN_DAYS) inWin.push(e);
      else if (d > SPAN_DAYS) extra += 1;
    }
    inWin.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    return { inWindow: inWin, overflow: extra };
  }, [events, todayYmd]);

  // Month tick positions: from today's month forwards.
  const months = useMemo(() => {
    const out: { label: string; x: number }[] = [];
    for (let m = 0; m <= 12; m++) {
      const ymd = addDaysToYmd(todayYmd, m * 30);
      const monthIdx = Number.parseInt(ymd.slice(5, 7), 10) - 1;
      const days = daysBetweenYmd(todayYmd, ymd);
      const x = PAD_LEFT + (days / SPAN_DAYS) * trackWidth;
      out.push({ label: MONTH_LABELS[monthIdx]!, x });
    }
    return out;
  }, [todayYmd, trackWidth]);

  function xFor(eventDate: string): number {
    const d = daysBetweenYmd(todayYmd, eventDate);
    const clamped = Math.max(0, Math.min(SPAN_DAYS, d));
    return PAD_LEFT + (clamped / SPAN_DAYS) * trackWidth;
  }

  if (events.length === 0) {
    return (
      <div
        data-testid="timeline-strip"
        data-empty="true"
        style={{
          height: HEIGHT,
          border: "1px solid var(--cp-border)",
          borderRadius: 12,
          background: "var(--cp-surface-soft, var(--cp-surface))",
          display: "grid",
          placeItems: "center",
          fontSize: 12,
          color: "var(--cp-text-muted)",
        }}
      >
        No events scheduled
      </div>
    );
  }

  return (
    <div
      data-testid="timeline-strip"
      style={{
        position: "relative",
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        background: "var(--cp-surface-soft, var(--cp-surface))",
        padding: "6px 8px 4px",
        overflowX: "auto",
      }}
    >
      <svg
        role="img"
        aria-label="12-month event timeline"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        style={{ display: "block", overflow: "visible" }}
      >
        {/* Base track */}
        <line
          x1={PAD_LEFT}
          x2={WIDTH - PAD_RIGHT}
          y1={TRACK_Y}
          y2={TRACK_Y}
          stroke="var(--cp-border)"
          strokeWidth={1}
        />

        {/* Month ticks + labels */}
        {months.map((m, i) => (
          <g key={i}>
            <line
              x1={m.x}
              x2={m.x}
              y1={TRACK_Y - 4}
              y2={TRACK_Y + 4}
              stroke="var(--cp-border)"
              strokeWidth={1}
            />
            <text
              x={m.x}
              y={HEIGHT - 6}
              fontSize={10}
              textAnchor="middle"
              fill="var(--cp-text-muted)"
            >
              {m.label}
            </text>
          </g>
        ))}

        {/* "Today" marker */}
        <line
          x1={PAD_LEFT}
          x2={PAD_LEFT}
          y1={TRACK_Y - 14}
          y2={TRACK_Y + 14}
          stroke="var(--cp-accent, var(--cp-text))"
          strokeWidth={2}
        />
        <text
          x={PAD_LEFT}
          y={TRACK_Y - 18}
          fontSize={9}
          textAnchor="middle"
          fill="var(--cp-accent, var(--cp-text))"
          fontWeight={600}
        >
          today
        </text>
      </svg>

      {/* Dots rendered as positioned buttons so they're keyboard-
          focusable in chronological order (the SVG dots underneath
          would be much harder to focus and announce). Positioned as
          an overlay absolutely inside the strip container; the SVG
          drives layout, the buttons just sit on top of it. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          padding: "6px 8px 4px",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            // The dot's visual centre lands at TRACK_Y inside an
            // HEIGHT-tall viewBox that's responsively scaled — use the
            // viewBox ratio so the overlay stays aligned at any width.
            paddingTop: `calc(${(TRACK_Y / WIDTH) * 100}% )`,
            height: 0,
          }}
        >
          {inWindow.map((e) => {
            const x = (xFor(e.eventDate) / WIDTH) * 100;
            return (
              <button
                key={e.id}
                type="button"
                data-testid={`timeline-dot-${e.id}`}
                onClick={() => onSelect?.(e.id)}
                aria-label={`${e.name} — ${priorityLabel(e.priority)} — ${modalityLabel(e.modality)} — ${e.eventDate}`}
                title={`${e.name}\n${e.eventDate} · ${priorityLabel(e.priority)} · ${modalityLabel(e.modality)}`}
                style={{
                  position: "absolute",
                  left: `calc(${x}% - 6px)`,
                  bottom: -6,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  border: "2px solid var(--cp-bg-elevated, var(--cp-surface))",
                  background: priorityColor(e.priority),
                  cursor: "pointer",
                  pointerEvents: "auto",
                  padding: 0,
                }}
              />
            );
          })}
          {overflow > 0 && (
            <span
              data-testid="timeline-overflow"
              style={{
                position: "absolute",
                right: 4,
                top: -10,
                fontSize: 10,
                color: "var(--cp-text-muted)",
                pointerEvents: "auto",
              }}
              title={`${overflow} event(s) beyond 12 months`}
            >
              +{overflow} later
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
