"use client";

/**
 * Timeline — chronological week-by-week stack of plan + log items.
 *
 * Groups items by ISO-week Monday. Past weeks render collapsed by
 * default with a "N done · M missed" summary chip; clicking expands.
 * The current week and future weeks render expanded. A small "today"
 * marker sits at the top of the current week's panel.
 *
 * Items are rendered as horizontal mini-cards (chip + title + meta +
 * link arrow). Past-unfulfilled cards open the MatchUnfulfilledModal
 * instead of routing.
 */
import Link from "next/link";
import { useState, useMemo } from "react";
import type { CalendarItem } from "@/lib/plan/calendar-data";
import { mondayOfYmd, addDaysToYmd } from "@/lib/dates";
import { chipPaint } from "./calendar-paint";

export type TimelineProps = {
  items: CalendarItem[];
  today: string;
  onMatchUnfulfilled?: (plannedId: string) => void;
};

type Week = {
  monday: string;
  sunday: string;
  items: CalendarItem[];
};

export function Timeline({ items, today, onMatchUnfulfilled }: TimelineProps) {
  const weeks = useMemo(() => bucketByWeek(items), [items]);
  const todayMonday = mondayOfYmd(today);

  return (
    <section
      data-testid="plan-timeline"
      style={{ display: "grid", gap: 12 }}
    >
      {weeks.length === 0 && (
        <div
          className="cp-card"
          style={{
            padding: 18,
            fontSize: 13,
            color: "var(--cp-text-muted)",
            textAlign: "center",
          }}
        >
          No items in the current window.
        </div>
      )}
      {weeks.map((w) => (
        <WeekPanel
          key={w.monday}
          week={w}
          today={today}
          isCurrent={w.monday === todayMonday}
          isFuture={w.monday > todayMonday}
          onMatchUnfulfilled={onMatchUnfulfilled}
        />
      ))}
    </section>
  );
}

function bucketByWeek(items: CalendarItem[]): Week[] {
  const byMonday = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const mon = mondayOfYmd(it.date);
    const bucket = byMonday.get(mon);
    if (bucket) bucket.push(it);
    else byMonday.set(mon, [it]);
  }
  return [...byMonday.entries()]
    .map(([monday, weekItems]) => ({
      monday,
      sunday: addDaysToYmd(monday, 6),
      items: weekItems,
    }))
    .sort((a, b) => a.monday.localeCompare(b.monday));
}

function WeekPanel({
  week,
  today,
  isCurrent,
  isFuture,
  onMatchUnfulfilled,
}: {
  week: Week;
  today: string;
  isCurrent: boolean;
  isFuture: boolean;
  onMatchUnfulfilled?: (plannedId: string) => void;
}) {
  const collapsedByDefault = !isCurrent && !isFuture;
  const [expanded, setExpanded] = useState(!collapsedByDefault);

  const stats = countStats(week.items);
  const label = `Week of ${formatRange(week.monday, week.sunday)}`;

  return (
    <div
      className="cp-card"
      data-testid={`plan-timeline-week-${week.monday}`}
      data-current={isCurrent ? "true" : undefined}
      style={{
        padding: 14,
        borderColor: isCurrent ? "var(--cp-accent)" : undefined,
        background: isCurrent ? "var(--cp-accent-soft)" : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={`tl-body-${week.monday}`}
        style={{
          display: "flex",
          width: "100%",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          background: "transparent",
          border: 0,
          padding: 0,
          cursor: "pointer",
          color: "inherit",
          textAlign: "left",
        }}
      >
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {isCurrent ? "This week · " : isFuture ? "Upcoming · " : "Past · "}
            {label}
          </span>
          <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{summaryText(stats)}</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }} aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div id={`tl-body-${week.monday}`} style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {isCurrent && (
            <div
              data-testid="plan-timeline-today-marker"
              style={{
                fontSize: 10,
                color: "var(--cp-accent)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              ⚡ Today · {today}
            </div>
          )}
          {week.items.map((it, i) => (
            <MiniCard
              key={`${it.kind}-${it.sessionId ?? it.eventId ?? i}`}
              item={it}
              onMatchUnfulfilled={onMatchUnfulfilled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function countStats(items: CalendarItem[]): { done: number; missed: number; planned: number; events: number } {
  let done = 0;
  let missed = 0;
  let planned = 0;
  let events = 0;
  for (const it of items) {
    if (it.kind === "logged_strength" || it.kind === "logged_cardio") done++;
    else if (it.kind === "past_unfulfilled") missed++;
    else if (it.kind === "planned_strength" || it.kind === "planned_cardio") planned++;
    else if (it.kind === "event") events++;
  }
  return { done, missed, planned, events };
}

function summaryText(s: { done: number; missed: number; planned: number; events: number }): string {
  const parts: string[] = [];
  if (s.done) parts.push(`${s.done} done`);
  if (s.planned) parts.push(`${s.planned} planned`);
  if (s.missed) parts.push(`${s.missed} missed`);
  if (s.events) parts.push(`${s.events} event${s.events === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Nothing scheduled";
}

function formatRange(monday: string, sunday: string): string {
  const m = new Date(monday + "T00:00:00Z");
  const s = new Date(sunday + "T00:00:00Z");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${m.toLocaleDateString("en-US", opts)} – ${s.toLocaleDateString("en-US", opts)}`;
}

function MiniCard({
  item,
  onMatchUnfulfilled,
}: {
  item: CalendarItem;
  onMatchUnfulfilled?: (plannedId: string) => void;
}) {
  const paint = chipPaint(item.kind, item.priority);
  const body = (
    <>
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: item.kind === "event" ? 2 : 999,
          background: paint.background === "transparent" ? "transparent" : paint.background,
          border: paint.border,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</span>
      {item.meta && (
        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>· {item.meta}</span>
      )}
      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--cp-text-muted)" }}>
        {formatShort(item.date)}
      </span>
    </>
  );
  const style: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 8,
    background: "var(--cp-surface)",
    border: "1px solid var(--cp-border)",
    color: "var(--cp-text)",
    textDecoration: "none",
    cursor: "pointer",
  };
  if (item.kind === "past_unfulfilled" && onMatchUnfulfilled) {
    return (
      <button
        type="button"
        data-testid={`plan-timeline-row-${item.kind}`}
        data-kind={item.kind}
        onClick={() => item.sessionId && onMatchUnfulfilled(item.sessionId)}
        style={{ ...style, textAlign: "left", borderStyle: "dashed", borderColor: "var(--cp-warning)" }}
      >
        {body}
      </button>
    );
  }
  return (
    <Link href={item.href} data-testid={`plan-timeline-row-${item.kind}`} data-kind={item.kind} style={style}>
      {body}
    </Link>
  );
}

function formatShort(date: string): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
