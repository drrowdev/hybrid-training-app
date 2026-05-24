"use client";

/**
 * PlanList — flat chronological list of plan + log items.
 *
 * The simplest of the three views: one card per item in date order
 * with day-of-week dividers. Provides parity with the pre-revamp
 * /app/plan experience while reading from the same `CalendarItem[]`
 * input so filter chips work uniformly across all three modes.
 *
 * The existing block-driven "day card" rendering with prescription
 * details still lives in `apps/web/src/app/app/plan/page.tsx` because
 * it carries Start/Skip server actions tied to planner row IDs. This
 * component is the lightweight summary list used inside the calendar
 * view system; deeper interactions live one click away on the session
 * detail / start surfaces.
 */
import Link from "next/link";
import type { CalendarItem } from "@/lib/plan/calendar-data";
import { chipPaint } from "./calendar-paint";

export type PlanListProps = {
  items: CalendarItem[];
  today: string;
  onMatchUnfulfilled?: (plannedId: string) => void;
};

export function PlanList({ items, today, onMatchUnfulfilled }: PlanListProps) {
  if (items.length === 0) {
    return (
      <div
        className="cp-card"
        data-testid="plan-list-empty"
        style={{ padding: 18, fontSize: 13, color: "var(--cp-text-muted)", textAlign: "center" }}
      >
        No items in the current window.
      </div>
    );
  }

  // Group by date so consecutive items on the same day read as one
  // block. The wider `CalendarItem[]` is already sorted by date.
  const groups: { date: string; items: CalendarItem[] }[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === it.date) last.items.push(it);
    else groups.push({ date: it.date, items: [it] });
  }

  return (
    <section data-testid="plan-list" style={{ display: "grid", gap: 8 }}>
      {groups.map((g) => (
        <DayGroup
          key={g.date}
          date={g.date}
          items={g.items}
          isToday={g.date === today}
          isPast={g.date < today}
          onMatchUnfulfilled={onMatchUnfulfilled}
        />
      ))}
    </section>
  );
}

function DayGroup({
  date,
  items,
  isToday,
  isPast,
  onMatchUnfulfilled,
}: {
  date: string;
  items: CalendarItem[];
  isToday: boolean;
  isPast: boolean;
  onMatchUnfulfilled?: (plannedId: string) => void;
}) {
  const d = new Date(date + "T00:00:00Z");
  const label = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return (
    <div
      className="cp-card"
      data-testid={`plan-list-day-${date}`}
      data-today={isToday ? "true" : undefined}
      style={{
        padding: 12,
        borderColor: isToday ? "var(--cp-accent)" : undefined,
        background: isToday ? "var(--cp-accent-soft)" : undefined,
        opacity: isPast && !isToday ? 0.85 : 1,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: isToday ? "var(--cp-accent)" : "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {label}
        {isToday && " · today"}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {items.map((it, i) => (
          <Row
            key={`${it.kind}-${it.sessionId ?? it.eventId ?? i}`}
            item={it}
            onMatchUnfulfilled={onMatchUnfulfilled}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  item,
  onMatchUnfulfilled,
}: {
  item: CalendarItem;
  onMatchUnfulfilled?: (plannedId: string) => void;
}) {
  const paint = chipPaint(item.kind, item.priority);
  const swatch = (
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
  );
  const body = (
    <>
      {swatch}
      {item.slotBadge && (
        <span
          aria-label={item.slotBadge === "am" ? "two-a-day morning session" : "two-a-day evening session"}
          title="Two-a-day · tap the AM/PM badge on the day card for details"
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--cp-accent)",
          }}
        >
          {item.slotBadge}
        </span>
      )}
      <span style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</span>
      {item.meta && (
        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>· {item.meta}</span>
      )}
      {item.kind === "past_unfulfilled" && (
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--cp-warning)" }}>
          Match →
        </span>
      )}
    </>
  );
  const style: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    borderRadius: 6,
    background: "var(--cp-surface)",
    border: "1px solid var(--cp-border)",
    color: "var(--cp-text)",
    textDecoration: "none",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  };
  if (item.kind === "past_unfulfilled" && onMatchUnfulfilled) {
    return (
      <button
        type="button"
        data-testid={`plan-list-row-${item.kind}`}
        data-kind={item.kind}
        onClick={() => item.sessionId && onMatchUnfulfilled(item.sessionId)}
        style={{ ...style, borderStyle: "dashed", borderColor: "var(--cp-warning)" }}
      >
        {body}
      </button>
    );
  }
  return (
    <Link href={item.href} data-testid={`plan-list-row-${item.kind}`} data-kind={item.kind} style={style}>
      {body}
    </Link>
  );
}
